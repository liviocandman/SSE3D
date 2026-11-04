import https from 'node:https';
import { createWriteStream } from 'node:fs';
import { mkdir, copyFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { requireValue, verifyFile } from './contract.mjs';

class Retryable extends Error {}
// Request errors after headers do not reject the already-resolved response
// promise. Retain timeout causes for the consumer even if Node reports a reset.
const responseTimeouts = new WeakMap();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export function getResponse(url, signal, redirects = 0, request = https.get) {
  const u = new URL(url);
  requireValue(u.protocol === 'https:' && !u.username && !u.password && !u.hash, 'HTTPS without credentials required');
  return new Promise((resolve, reject) => {
    let incoming, socket, connectTimer;
    const connected = () => clearTimeout(connectTimer);
    const req = request(u, { signal, timeout: 60_000, rejectUnauthorized: true }, res => {
      incoming = res;
      connected();
      res.once('error', reject);
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        if (redirects >= 5 || !res.headers.location) return reject(new Error('redirect limit/missing location'));
        try { resolve(getResponse(new URL(res.headers.location, u), signal, redirects + 1, request)); } catch (e) { reject(e); }
      } else if (res.statusCode === 429 || (res.statusCode >= 500 && res.statusCode < 600)) {
        res.resume(); reject(new Retryable(`HTTP ${res.statusCode}`));
      } else if (res.statusCode !== 200) {
        res.resume(); reject(new Error(`HTTP ${res.statusCode}`));
      } else resolve(res);
    });
    const failTimeout = error => {
      if (incoming) {
        responseTimeouts.set(incoming, error);
        incoming.destroy(error);
      }
      req.destroy(error);
    };
    connectTimer = setTimeout(() => failTimeout(new Retryable('connect timeout')), 15_000);
    req.once('socket', assigned => {
      socket = assigned;
      // Agent reuse has no second secureConnect event. A socket may also have
      // completed TLS before assignment, so check its negotiated protocol.
      if (req.reusedSocket || (!socket.connecting && socket.getProtocol?.())) connected();
      else socket.once('secureConnect', connected);
    });
    req.on('timeout', () => failTimeout(new Retryable('read timeout')));
    req.on('error', reject);
    req.once('close', () => {
      connected();
      socket?.removeListener('secureConnect', connected);
    });
  });
}
export async function downloadPinned(spec, destination, { response = getResponse, budgetMs = 300_000, backoffMs = 500 } = {}) {
  const deadline = Date.now() + budgetMs;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
    let res;
    try {
      res = await response(spec.url, controller.signal);
      let bytes = 0;
      const limiter = new Transform({ transform(chunk, enc, cb) {
        bytes += chunk.length;
        cb(bytes > spec.bytes ? new Error('download exceeds pinned bytes') : null, chunk);
      } });
      await pipeline(res, limiter, createWriteStream(destination, { flags: 'wx' }), { signal: controller.signal });
      await verifyFile(destination, spec);
      return;
    } catch (e) {
      await rm(destination, { force: true });
      const error = responseTimeouts.get(res) ?? e;
      const retry = error instanceof Retryable || ['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(error.code);
      if (!retry || controller.signal.aborted || attempt === 3 || Date.now() >= deadline) throw error;
      await pause(Math.min(backoffMs * 2 ** (attempt - 1), Math.max(0, deadline - Date.now())));
    } finally { clearTimeout(timer); }
  }
}
export async function cachedArtifact(spec, cacheDir, localFile, options = {}) {
  await mkdir(cacheDir, { recursive: true });
  const target = join(cacheDir, spec.sha256);
  try { await verifyFile(target, spec); return target; } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`corrupt cache; preserve/remove explicitly: ${target}`, { cause: e });
  }
  const temporary = join(cacheDir, `${spec.sha256}.${randomUUID()}.part`);
  try {
    if (localFile) { await verifyFile(localFile, spec); await copyFile(localFile, temporary); }
    else await downloadPinned(spec, temporary, options);
    await verifyFile(temporary, spec);
    // Content addressed concurrent writers may publish identical verified bytes.
    await mkdir(dirname(target), { recursive: true });
    await copyFile(temporary, target, 1).catch(async e => { if (e.code !== 'EEXIST') throw e; await verifyFile(target, spec); });
    return target;
  } finally { await rm(temporary, { force: true }); }
}
