import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { Readable } from 'node:stream';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { validateDescriptor, validateLock, validateManifest, texturePaths } from './contract.mjs';
import { extractTextures } from './extract.mjs';
import { downloadPinned, getResponse } from './transport.mjs';
import { prepareTextures } from '../prepare-textures.mjs';

const digest = b => createHash('sha256').update(b).digest('hex');
const fileSpec = b => ({ bytes: b.length, sha256: digest(b) });
export function crc32(b) {
  let crc = 0xffffffff;
  for (const byte of b) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
export function zip(entries) {
  const chunks = [], directory = []; let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name), body = e.body ?? Buffer.from('fixture'), compressed = deflateRawSync(body);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc32(body), 14); h.writeUInt32LE(compressed.length, 18); h.writeUInt32LE(e.bytes ?? body.length, 22); h.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(0x0314, 4); h.copy(c, 6, 4, 30); c.writeUInt32LE(((e.mode ?? 0o100644) << 16) >>> 0, 38); c.writeUInt32LE(offset, 42);
    chunks.push(h, name, compressed); directory.push(c, name); offset += h.length + name.length + compressed.length;
  }
  const cd = Buffer.concat(directory); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cd, end]);
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'sse3d-textures-')); t.after(() => rm(root, { recursive: true, force: true }));
  const body = Buffer.alloc(80); Buffer.from('ab4b5458203230bb0d0a1a0a', 'hex').copy(body); for (const offset of [20, 24, 40]) body.writeUInt32LE(1, offset);
  const manifest = { schemaVersion: 1, kind: 'textures', version: 'fixture-1', files: texturePaths.map(path => ({ path, ...fileSpec(body) })), ktx2: Object.fromEntries(texturePaths.map(p => [p, { identifier: 'KTX2', width: 1, height: 1, levels: 1 }])) };
  const entries = texturePaths.map(name => ({ name, body }));
  const manifestBytes = Buffer.from(JSON.stringify(manifest)); const archive = zip(entries);
  const descriptor = { version: manifest.version, archive: { url: 'https://fixture.invalid/a.zip', ...fileSpec(archive) }, manifest: { url: 'https://fixture.invalid/m.json', ...fileSpec(manifestBytes) } };
  const basis = ['basis_transcoder.js', 'basis_transcoder.wasm'].map(n => ({ path: `public/basis/${n}`, ...fileSpec(body) }));
  const lock = { schemaVersion: 1, kind: 'textures', current: descriptor, retained: [], basis };
  await mkdir(join(root, 'source')); await mkdir(join(root, 'public/basis'), { recursive: true });
  for (const f of basis) await writeFile(join(root, f.path), body);
  await writeFile(join(root, 'source/fixture-1.zip'), archive); await writeFile(join(root, 'source/fixture-1.manifest.json'), manifestBytes);
  const lockPath = join(root, 'lock.json'); await writeFile(lockPath, JSON.stringify(lock));
  const options = { lock: lockPath, basisRoot: root, output: join(root, 'public'), sourceDir: join(root, 'source'), cacheDir: join(root, 'cache'), verifyOnly: false };
  return { root, body, manifest, entries, archive, descriptor, lock, lockPath, options };
}

test('shared descriptor contract fixtures', async () => {
  const cases = JSON.parse(await readFile(new URL('../../assets/test-fixtures/descriptors.json', import.meta.url), 'utf8'));
  for (const c of cases) { if (c.valid) assert.doesNotThrow(() => validateDescriptor(c.value), c.name); else assert.throws(() => validateDescriptor(c.value), undefined, c.name); }
});
test('lock and manifest reject schema/kind/version/missing/duplicate entries', async t => {
  const f = await fixture(t); validateLock(f.lock); validateManifest(f.manifest, 'fixture-1');
  for (const change of [{ schemaVersion: 2 }, { kind: 'kernels' }, { retained: [f.descriptor] }, { basis: [] }]) assert.throws(() => validateLock({ ...f.lock, ...change }));
  for (const change of [{ schemaVersion: 2 }, { kind: 'kernels' }, { version: 'other' }, { files: f.manifest.files.slice(1) }, { files: [...f.manifest.files, f.manifest.files[0]] }]) assert.throws(() => validateManifest({ ...f.manifest, ...change }, 'fixture-1'));
});
test('install, concurrent reuse, offline verify and missing receipt repair', async t => {
  const f = await fixture(t);
  await Promise.all([prepareTextures(f.options), prepareTextures(f.options)]);
  await rm(join(f.root, 'source'), { recursive: true }); await rm(join(f.root, 'cache'), { recursive: true });
  await prepareTextures({ ...f.options, verifyOnly: true });
  const receipt = join(f.root, 'public/textures/fixture-1/installation.json'); await rm(receipt);
  await assert.rejects(prepareTextures({ ...f.options, verifyOnly: true }), /receipt/);
  await prepareTextures(f.options);
  await prepareTextures({ ...f.options, verifyOnly: true });
});
test('verify-only makes no directories or network calls', async t => {
  const f = await fixture(t); const output = join(f.root, 'missing');
  await assert.rejects(prepareTextures({ ...f.options, output, verifyOnly: true }), /installation missing/);
  await assert.rejects(readFile(join(output, 'textures/.install.lock')), /ENOENT/);
});
test('corruption is preserved; invalid update never replaces previous version', async t => {
  const f = await fixture(t); await prepareTextures(f.options);
  const existing = join(f.root, 'public/textures/fixture-1/earth_low.ktx2'); await writeFile(existing, 'bad');
  await assert.rejects(prepareTextures(f.options), /preserved/); assert.equal(await readFile(existing, 'utf8'), 'bad');
  f.lock.current = { ...f.descriptor, version: 'fixture-2' }; await writeFile(f.lockPath, JSON.stringify(f.lock));
  await assert.rejects(prepareTextures(f.options)); assert.equal(await readFile(existing, 'utf8'), 'bad');
});
for (const name of ['../escape', '/escape', 'C:/escape', 'textures\\escape', 'textures/../escape', 'textures/EARTH_low.ktx2', 'textures/unexpected.ktx2']) {
  test(`ZIP rejects path ${name}`, async t => {
    const f = await fixture(t); const archivePath = join(f.root, 'malicious.zip'); await writeFile(archivePath, zip([{ name, body: f.body }]));
    const dest = join(f.root, 'stage'); await mkdir(dest);
    await assert.rejects(extractTextures(archivePath, dest, f.manifest)); assert.deepEqual(await readdir(dest), []);
  });
}
for (const mode of ['duplicate', 'symlink', 'missing', 'oversize', 'lying-size', 'truncated', 'wrong-hash']) {
  test(`ZIP rejects ${mode}`, async t => {
    const f = await fixture(t); let entries = f.entries.map(e => ({ ...e })); let archive;
    if (mode === 'duplicate') entries.push(entries[0]);
    if (mode === 'symlink') entries[0].mode = 0o120777;
    if (mode === 'missing') entries.pop();
    if (mode === 'oversize' || mode === 'lying-size') entries[0].body = Buffer.alloc(10000);
    if (mode === 'lying-size') entries[0].bytes = 80;
    if (mode === 'wrong-hash') entries[0].body = Buffer.alloc(80);
    archive = zip(entries); if (mode === 'truncated') archive = archive.subarray(0, archive.length - 8);
    const path = join(f.root, 'bad.zip'); await writeFile(path, archive); const dest = join(f.root, 'stage'); await mkdir(dest);
    await assert.rejects(extractTextures(path, dest, f.manifest));
  });
}
test('download limits, checksum, retry and deadline policy', async t => {
  const f = await fixture(t); const path = join(f.root, 'download'); const spec = { url: 'https://fixture.invalid/a', ...fileSpec(f.body) }; let calls = 0;
  await downloadPinned(spec, path, { response: async () => { calls++; return Readable.from([f.body]); } }); assert.equal(calls, 1); await rm(path);
  await assert.rejects(downloadPinned(spec, path, { response: async () => Readable.from([Buffer.alloc(81)]) }), /exceeds/);
  await assert.rejects(downloadPinned(spec, path, { response: async () => Readable.from([Buffer.alloc(80)]) }), /sha256/);
  for (const code of ['403', '404', 'CERT_HAS_EXPIRED']) {
    calls = 0; await assert.rejects(downloadPinned(spec, path, { response: async () => { calls++; throw Object.assign(new Error(code), { code }); }, backoffMs: 1 })); assert.equal(calls, 1);
  }
  calls = 0; await assert.rejects(downloadPinned(spec, path, { response: async () => { calls++; throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); }, backoffMs: 1 })); assert.equal(calls, 3);
  await assert.rejects(downloadPinned(spec, path, { budgetMs: 10, response: async (_, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('deadline')))) }), /deadline/);
});

test('real TLS verifies certificates; HTTP statuses retry only 429/5xx', async t => {
  const cert = await readFile(new URL('../../assets/test-fixtures/tls-cert.txt', import.meta.url));
  const key = await readFile(new URL('../../assets/test-fixtures/tls-key.txt', import.meta.url));
  let status = 200, calls = 0;
  const server = https.createServer({ cert, key }, (_, res) => { calls++; res.writeHead(status); res.end('ok'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `https://localhost:${server.address().port}/asset`;
  await assert.rejects(getResponse(url), /self-signed certificate/);
  const f = await fixture(t);
  const response = (u, signal) => getResponse(u, signal, 0, (a, b, cb) => https.get(a, { ...b, ca: cert, family: 4 }, cb));
  for (const [code, expected] of [[403, 1], [404, 1], [429, 3], [500, 3], [600, 1]]) {
    status = code; calls = 0;
    await assert.rejects(downloadPinned({ url, ...fileSpec(Buffer.from('ok')) }, join(f.root, 'part'), { response, backoffMs: 1 }));
    assert.equal(calls, expected);
  }
  status = 200; calls = 0;
  await downloadPinned({ url, ...fileSpec(Buffer.from('ok')) }, join(f.root, 'part'), { response }); assert.equal(calls, 1);
});
test('process interruption leaves no active partial version and lease is recoverable', async t => {
  const f = await fixture(t);
  const script = `import lockfile from 'proper-lockfile'; import { mkdir, writeFile } from 'node:fs/promises';
    const root = process.argv[1]; await mkdir(root, {recursive:true});
    await lockfile.lock(root, {realpath:false,lockfilePath:root+'/.install.lock',stale:2000,update:1000});
    await mkdir(root+'/.staging-interrupted'); await writeFile(root+'/.staging-interrupted/partial','partial');
    process.stdout.write('locked\\n'); setInterval(()=>{},1000);`;
  const root = join(f.root, 'public/textures');
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, root], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error('lock child exited early'); })]); child.kill('SIGKILL'); await once(child, 'exit');
  await prepareTextures(f.options);
  assert.equal(await readFile(join(root, '.staging-interrupted/partial'), 'utf8'), 'partial');
  await prepareTextures({ ...f.options, verifyOnly: true });
});
