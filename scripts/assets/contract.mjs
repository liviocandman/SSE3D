import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';

export const texturePaths = 'callisto earth enceladus europa ganymede generic_moon io jupiter mars mercury moon neptune saturn sun titan triton uranus venus saturn_ring'.split(' ').flatMap(n => ['low', 'mid', 'high'].map(t => `textures/${n}_${t}.ktx2`)).sort();
export const basisPaths = ['public/basis/basis_transcoder.js', 'public/basis/basis_transcoder.wasm'];
export const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const integer = n => Number.isSafeInteger(n) && n > 0;
export const safePath = p => typeof p === 'string' && p.length > 0 && !/[\\:\x00-\x1f\x7f]/.test(p) && p.split('/').every(s => s && s !== '.' && s !== '..');
export function validateFile(f) {
  requireValue(f && safePath(f.path), 'unsafe file path');
  requireValue(integer(f.bytes), 'invalid file bytes');
  requireValue(typeof f.sha256 === 'string' && f.sha256.length === 64 && /^[0-9a-f]{64}$/.test(f.sha256), 'invalid file sha256');
}
export function validateDescriptor(d) {
  requireValue(d && typeof d.version === 'string' && /^[a-z0-9][a-z0-9._-]{0,79}$/.test(d.version) && !/\s/.test(d.version), 'invalid version');
  for (const [key, limit] of [['archive', 4 * 1024 ** 3], ['manifest', 2 * 1024 ** 2]]) {
    const f = d[key];
    requireValue(f && typeof f.url === 'string', `missing ${key}`);
    validateFile({ ...f, path: 'descriptor' });
    requireValue(f.bytes <= limit, `${key} exceeds limit`);
    const u = new URL(f.url);
    requireValue(u.protocol === 'https:' && u.hostname && !u.username && !u.password && !u.hash, `${key} URL must be HTTPS without credentials`);
  }
  return d;
}
export function validateLock(lock) {
  requireValue(lock?.schemaVersion === 1 && lock.kind === 'textures', 'invalid lock schema/kind');
  requireValue(Array.isArray(lock.retained) && Array.isArray(lock.basis), 'invalid retained/Basis');
  const versions = [lock.current, ...lock.retained].map(d => validateDescriptor(d).version);
  requireValue(new Set(versions).size === versions.length, 'duplicate versions');
  lock.basis.forEach(validateFile);
  requireValue(JSON.stringify(lock.basis.map(f => f.path).sort()) === JSON.stringify(basisPaths), 'invalid Basis inventory');
  return lock;
}
export function validateManifest(m, version) {
  requireValue(m?.schemaVersion === 1 && m.kind === 'textures' && m.version === version, 'manifest schema/kind/version mismatch');
  requireValue(Array.isArray(m.files), 'invalid files');
  m.files.forEach(validateFile);
  requireValue(JSON.stringify(m.files.map(f => f.path).sort()) === JSON.stringify(texturePaths), 'manifest inventory mismatch/duplicate');
  requireValue(m.ktx2 && JSON.stringify(Object.keys(m.ktx2).sort()) === JSON.stringify(texturePaths), 'missing KTX2 metadata');
  for (const v of Object.values(m.ktx2)) requireValue(v?.identifier === 'KTX2' && ['width', 'height', 'levels'].every(k => integer(v[k])), 'invalid KTX2 metadata');
  return m;
}
export async function verifyFile(path, f) {
  const info = await lstat(path);
  requireValue(info.isFile() && !info.isSymbolicLink() && info.size === f.bytes, `missing/size/unsafe file: ${path}`);
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk);
  requireValue(h.digest('hex') === f.sha256, `sha256 mismatch: ${path}`);
}
export function verifyKtx(header, metadata) {
  requireValue(header.length >= 80 && header.subarray(0, 12).equals(Buffer.from('ab4b5458203230bb0d0a1a0a', 'hex')), 'invalid KTX2 identifier');
  for (const [key, offset] of [['width', 20], ['height', 24], ['levels', 40]]) requireValue(header.readUInt32LE(offset) === metadata[key], `KTX2 ${key} mismatch`);
}
