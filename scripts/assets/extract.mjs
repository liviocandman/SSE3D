import yauzl from 'yauzl';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { requireValue, safePath } from './contract.mjs';

export async function extractTextures(archive, destination, manifest) {
  const files = new Map(manifest.files.map(f => [f.path, f]));
  const allowedDirs = new Set(['textures/']);
  const seen = new Set();
  const zip = await new Promise((resolve, reject) => yauzl.open(archive, { lazyEntries: true, autoClose: false, decodeStrings: true, strictFileNames: true, validateEntrySizes: true }, (err, file) => err ? reject(err) : resolve(file)));
  try {
    await new Promise((resolve, reject) => {
      zip.on('error', reject);
      zip.on('end', () => { try { requireValue([...files.keys()].every(f => seen.has(f)), 'ZIP missing required files'); resolve(); } catch (e) { reject(e); } });
      zip.on('entry', entry => { (async () => {
        const name = entry.fileName;
        const directory = name.endsWith('/');
        requireValue(safePath(directory ? name.slice(0, -1) : name), `unsafe ZIP path: ${name}`);
        requireValue(!seen.has(name.toLowerCase()), `duplicate/colliding ZIP path: ${name}`);
        seen.add(name.toLowerCase());
        const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
        requireValue(mode === 0 || mode === (directory ? 0x4000 : 0x8000), `ZIP symlink/special: ${name}`);
        requireValue(!(entry.generalPurposeBitFlag & 1), 'encrypted ZIP not allowed');
        if (directory) { requireValue(allowedDirs.has(name) && entry.uncompressedSize === 0, 'unexpected directory'); zip.readEntry(); return; }
        const expected = files.get(name);
        requireValue(expected && entry.uncompressedSize === expected.bytes, `ZIP inventory/size mismatch: ${name}`);
        const output = join(destination, name.slice('textures/'.length));
        await mkdir(dirname(output), { recursive: true });
        const input = await new Promise((res, rej) => zip.openReadStream(entry, (err, stream) => err ? rej(err) : res(stream)));
        let count = 0;
        const digest = createHash('sha256');
        const limiter = new Transform({ transform(chunk, encoding, callback) {
          count += chunk.length;
          if (count > expected.bytes) return callback(new Error(`extracted bytes exceed manifest: ${name}`));
          digest.update(chunk); callback(null, chunk);
        } });
        await pipeline(input, limiter, createWriteStream(output, { flags: 'wx', mode: 0o644 }));
        requireValue(count === expected.bytes && digest.digest('hex') === expected.sha256, `extracted checksum/size mismatch: ${name}`);
        zip.readEntry();
      })().catch(reject); });
      zip.readEntry();
    });
  } finally { zip.close(); }
}
