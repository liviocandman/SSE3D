#!/usr/bin/env node
import { mkdir, readFile, writeFile, rename, rm, mkdtemp, readdir, open, lstat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import lockfile from 'proper-lockfile';
import { validateLock, validateManifest, verifyFile, verifyKtx, requireValue } from './assets/contract.mjs';
import { cachedArtifact } from './assets/transport.mjs';
import { extractTextures } from './assets/extract.mjs';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const receiptFor = d => ({ schemaVersion: 1, version: d.version, manifestSha256: d.manifest.sha256, archiveSha256: d.archive.sha256, validatorVersion: '1' });
async function exists(path) { try { await lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
async function verifyContents(destination, manifest) {
  const names = (await readdir(destination)).filter(n => !['manifest.json', 'installation.json'].includes(n)).sort();
  requireValue(JSON.stringify(names) === JSON.stringify(manifest.files.map(f => f.path.slice(9)).sort()), `installed inventory mismatch: ${destination}`);
  for (const entry of manifest.files) {
    const file = join(destination, entry.path.slice(9));
    await verifyFile(file, entry);
    const handle = await open(file, 'r');
    try { const header = Buffer.alloc(80); const { bytesRead } = await handle.read(header, 0, 80, 0); verifyKtx(header.subarray(0, bytesRead), manifest.ktx2[entry.path]); }
    finally { await handle.close(); }
  }
}
export async function verifyInstallation(destination, descriptor, { verifyOnly = true } = {}) {
  requireValue(!(await lstat(destination)).isSymbolicLink(), 'installation must not be a symlink');
  const manifestFile = join(destination, 'manifest.json');
  await verifyFile(manifestFile, descriptor.manifest);
  const manifest = validateManifest(JSON.parse(await readFile(manifestFile, 'utf8')), descriptor.version);
  await verifyContents(destination, manifest);
  const receiptFile = join(destination, 'installation.json');
  const receipt = receiptFor(descriptor);
  let valid = false;
  try { const saved = JSON.parse(await readFile(receiptFile, 'utf8')); valid = Object.keys(receipt).every(k => saved[k] === receipt[k]); } catch { /* Recreate only in ensure mode, after validating every byte. */ }
  if (!valid) {
    requireValue(!verifyOnly, `missing/incompatible receipt: ${destination}`);
    const temporary = join(destination, `.receipt-${process.pid}.tmp`);
    try { await writeFile(temporary, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, receiptFile); }
    finally { await rm(temporary, { force: true }); }
  }
  return manifest;
}
export async function prepareTextures(options = {}) {
  const lock = validateLock(JSON.parse(await readFile(options.lock ?? join(projectRoot, 'assets/textures.lock.json'), 'utf8')));
  const output = resolve(options.output ?? join(projectRoot, 'public'));
  const basisRoot = options.basisRoot ?? projectRoot;
  for (const f of lock.basis) await verifyFile(join(basisRoot, f.path), f);
  const texturesRoot = join(output, 'textures');
  if (!options.verifyOnly) await mkdir(texturesRoot, { recursive: true });
  let release = () => {};
  if (!options.verifyOnly) release = await lockfile.lock(texturesRoot, {
    realpath: false, lockfilePath: join(texturesRoot, '.install.lock'), stale: 30_000, update: 5_000,
    retries: { retries: 70, factor: 1, minTimeout: 1_000, maxTimeout: 1_000, randomize: false },
  });
  try {
    for (const d of [lock.current, ...lock.retained]) {
      const destination = join(texturesRoot, d.version);
      if (await exists(destination)) {
        try { await verifyInstallation(destination, d, { verifyOnly: Boolean(options.verifyOnly) }); }
        catch (e) { throw new Error(`installed version ${d.version} invalid; preserved at ${destination}: ${e.message}`, { cause: e }); }
      } else {
        requireValue(!options.verifyOnly, `installation missing: ${d.version}`);
        const cache = options.cacheDir ?? join(projectRoot, '.cache/assets');
        const source = options.sourceDir;
        const manifestPath = await cachedArtifact(d.manifest, cache, source && join(source, `${d.version}.manifest.json`), { budgetMs: 30_000 });
        const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')), d.version);
        const archive = await cachedArtifact(d.archive, cache, source && join(source, `${d.version}.zip`));
        const staging = await mkdtemp(join(texturesRoot, '.staging-'));
        try {
          await extractTextures(archive, staging, manifest);
          await verifyContents(staging, manifest);
          await writeFile(join(staging, 'manifest.json'), await readFile(manifestPath), { flag: 'wx' });
          await writeFile(join(staging, 'installation.json'), JSON.stringify(receiptFor(d), null, 2) + '\n', { flag: 'wx' });
          await rename(staging, destination);
        } finally { await rm(staging, { recursive: true, force: true }); }
      }
      console.log(`[textures] verified version=${d.version} sha256=${d.archive.sha256} files=57`);
    }
  } finally { await release(); }
  return lock;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    'verify-only': { type: 'boolean', default: false }, lock: { type: 'string' }, output: { type: 'string' },
    'cache-dir': { type: 'string' }, 'source-dir': { type: 'string' },
  } });
  prepareTextures({ lock: values.lock, output: values.output, cacheDir: values['cache-dir'], sourceDir: values['source-dir'], verifyOnly: values['verify-only'] })
    .catch(e => { console.error(`[textures] ${e.message}`); process.exitCode = 1; });
}
