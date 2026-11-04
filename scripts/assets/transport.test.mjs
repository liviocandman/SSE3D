import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { once } from 'node:events';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getResponse, downloadPinned } from './transport.mjs';

const cert = await readFile(new URL('../../assets/test-fixtures/tls-cert.txt', import.meta.url));
const key = await readFile(new URL('../../assets/test-fixtures/tls-key.txt', import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const specFor = (url, body = Buffer.from('ok')) => ({ url, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') });

async function fixture(t, handler, onResponse = () => {}) {
  const root = await mkdtemp(join(tmpdir(), 'sse3d-transport-'));
  const server = https.createServer({ cert, key }, handler);
  const agent = new https.Agent({ keepAlive: true, maxSockets: 1 });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const requests = [];
  const request = (url, options, callback) => {
    const req = https.get(url, { ...options, ca: cert, family: 4, agent }, res => {
      callback(res);
      // Let the awaiting consumer attach its pipeline before observing data;
      // a test listener must not put the response in flowing mode prematurely.
      queueMicrotask(() => onResponse(req, res));
    });
    req.on('socket', socket => requests.push({ path: url.pathname, reused: req.reusedSocket, connecting: socket.connecting }));
    return req;
  };
  t.after(async () => {
    agent.destroy();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  return {
    root, requests, url: `https://localhost:${server.address().port}`,
    response: (url, signal) => getResponse(url, signal, 0, request),
  };
}

test('reused TLS socket completes a streaming response beyond the 15s connection limit', { timeout: 25_000 }, async t => {
  const f = await fixture(t, (req, res) => {
    if (req.url === '/warm') return res.end('ok');
    res.writeHead(200);
    res.write('x');
    const tick = setInterval(() => res.write('x'), 100);
    const finish = setTimeout(() => res.end(), 16_000);
    res.once('close', () => { clearInterval(tick); clearTimeout(finish); });
  });
  const warm = await f.response(`${f.url}/warm`);
  let warmBody = '';
  for await (const chunk of warm) warmBody += chunk;
  assert.equal(warmBody, 'ok');
  await pause(10); // Return the consumed socket to the Agent's free pool.
  const started = performance.now();
  const response = await f.response(`${f.url}/slow`);
  let bytes = 0;
  for await (const chunk of response) bytes += chunk.length;
  const durationMs = performance.now() - started;
  assert.equal(response.complete, true);
  assert(bytes > 0);
  assert(durationMs >= 15_500, `transfer completed too early: ${durationMs} ms`);
  assert.deepEqual(f.requests.map(r => r.reused), [false, true]);
  assert.equal(f.requests[1].connecting, false);
  t.diagnostic(`reusedSocket=true; completed ${bytes} bytes in ${durationMs.toFixed(1)} ms`);
});

test('real body inactivity after headers/first chunk exhausts exactly three attempts and removes partial files', async t => {
  let calls = 0, chunks = 0;
  const f = await fixture(t, (_, res) => {
    calls++;
    res.writeHead(200);
    res.write('o');
    // Deliberately leave the body idle; the actual socket timeout must fire.
  }, (req, res) => {
    res.once('data', () => { chunks++; req.setTimeout(50); });
  });
  const destination = join(f.root, 'download.part');
  await assert.rejects(downloadPinned(specFor(`${f.url}/stall`), destination, { response: f.response, backoffMs: 1 }), /read timeout/);
  assert.equal(calls, 3);
  assert.equal(chunks, 3);
  await assert.rejects(readFile(destination), { code: 'ENOENT' });
  t.diagnostic(`HTTP requests=${calls}; received first chunks=${chunks}; partial removed`);
});

test('body timeout retries can finish with a verified clean third attempt', async t => {
  let calls = 0;
  const f = await fixture(t, (_, res) => {
    calls++;
    if (calls === 3) return res.end('ok');
    res.writeHead(200);
    res.write('o');
  }, (req, res) => res.once('data', () => req.setTimeout(50)));
  const destination = join(f.root, 'download.part');
  await downloadPinned(specFor(`${f.url}/eventual`), destination, { response: f.response, backoffMs: 1 });
  assert.equal(calls, 3);
  assert.equal(await readFile(destination, 'utf8'), 'ok');
});

test('a streaming body remains bounded by the total deadline without another attempt', async t => {
  let calls = 0;
  const f = await fixture(t, (_, res) => {
    calls++;
    res.writeHead(200);
    res.write('x');
    const tick = setInterval(() => res.write('x'), 10);
    res.once('close', () => clearInterval(tick));
  }, (req, res) => res.once('data', () => req.setTimeout(50)));
  const destination = join(f.root, 'download.part');
  const started = performance.now();
  await assert.rejects(downloadPinned(specFor(`${f.url}/endless`, Buffer.alloc(10000)), destination, { response: f.response, budgetMs: 150, backoffMs: 1 }), error => error.name === 'AbortError' || error.code === 'ECONNRESET');
  // Node platforms can surface cancellation of an open body as either error.
  // The observable contract is the deadline, no retry, and removal of the part.
  const durationMs = performance.now() - started;
  assert(durationMs >= 125 && durationMs < 2_000, `unexpected deadline duration: ${durationMs} ms`);
  assert.equal(calls, 1);
  await assert.rejects(readFile(destination), { code: 'ENOENT' });
});

test('a body reset without a timeout is preserved as a permanent transport failure', async t => {
  let calls = 0;
  const f = await fixture(t, (_, res) => {
    calls++;
    res.writeHead(200);
    res.write('o');
    const timer = setTimeout(() => res.destroy(), 20);
    res.once('close', () => clearTimeout(timer));
  });
  const destination = join(f.root, 'download.part');
  await assert.rejects(downloadPinned(specFor(`${f.url}/reset`), destination, { response: f.response, backoffMs: 1 }), { code: 'ECONNRESET' });
  assert.equal(calls, 1);
  await assert.rejects(readFile(destination), { code: 'ENOENT' });
});

test('real HTTPS integrity failures do not become timeout retries', async t => {
  let calls = 0;
  const f = await fixture(t, (_, res) => { calls++; res.end('no'); });
  const destination = join(f.root, 'download.part');
  await assert.rejects(downloadPinned(specFor(`${f.url}/bad-sha`), destination, { response: f.response, backoffMs: 1 }), /sha256/);
  assert.equal(calls, 1);
  await assert.rejects(readFile(destination), { code: 'ENOENT' });
});
