import test from 'node:test';
import assert from 'node:assert/strict';
import { setEnvironmentContext } from '@netlify/blobs';
import { createStrongStore, StorageError } from '../netlify/lib/storage';

// The production factory consumes the same automatic context as Netlify's
// runtime. No networking or server/emulator is needed to inspect SDK contracts.
setEnvironmentContext({ siteID: 'storage-test-site', token: 'storage-test-only', edgeURL: 'https://cache.invalid', uncachedEdgeURL: 'https://strong.invalid' });

test('checked Blobs writes reject 403, 429 and 5xx instead of acknowledging a lost update', async () => {
  for (const status of [403, 429, 500, 503]) for (const condition of [{ onlyIfNew: true }, { onlyIfMatch: 'previous-etag' }]) {
    let requests = 0;
    const store = createStrongStore('storage-tests', { fetch: async () => { requests++; return new Response('private infrastructure details', { status }); } });
    await assert.rejects(store.setJSON('room', { score: 1 }, condition), error => error instanceof StorageError && error.status === status && !error.message.includes('private'));
    assert.equal(requests, status === 403 ? 1 : 3, 'retries must be bounded and must not enter the SDK five-second retry loop');
  }
});

test('strong reads and conditional-write headers are retained with automatic runtime credentials', async () => {
  const seen: { url: string; method: string; headers: Headers }[] = [];
  const store = createStrongStore('storage-tests', { fetch: async (url, options) => {
    seen.push({ url: String(url), method: options!.method!, headers: new Headers(options!.headers) });
    return options?.method === 'get' ? Response.json({ score: 2 }, { headers: { etag: 'room-etag' } }) : new Response(null, { headers: { etag: 'next-etag' } });
  } });
  const read = await store.getWithMetadata('room', { type: 'json' });
  assert.equal(read?.data.score, 2); assert.equal(read?.etag, 'room-etag');
  assert.deepEqual(await store.setJSON('room', { score: 3 }, { onlyIfMatch: 'room-etag' }), { modified: true, etag: 'next-etag' });
  assert.deepEqual(await store.setJSON('new-room', {}, { onlyIfNew: true }), { modified: true, etag: 'next-etag' });
  assert.ok(seen.every(request => request.url.startsWith('https://strong.invalid/')));
  assert.ok(seen.every(request => request.headers.get('authorization') === 'Bearer storage-test-only'));
  assert.equal(seen[1].headers.get('if-match'), 'room-etag'); assert.equal(seen[2].headers.get('if-none-match'), '*');
});

test('expected 404 reads and 412 conditional conflicts retain their SDK meanings', async () => {
  const store = createStrongStore('storage-tests', { fetch: async (_, options) => new Response(null, { status: options?.method === 'put' ? 412 : 404 }) });
  assert.equal(await store.getWithMetadata('missing', { type: 'json' }), null);
  assert.equal(await store.get('missing'), null);
  assert.deepEqual(await store.setJSON('existing', {}, { onlyIfNew: true }), { modified: false });
  assert.deepEqual(await store.setJSON('changed', {}, { onlyIfMatch: 'old-etag' }), { modified: false });
});

test('unexpected 404 writes and 412 reads cannot be mistaken for success', async () => {
  const write = createStrongStore('storage-tests', { fetch: async () => new Response(null, { status: 404 }) });
  await assert.rejects(write.setJSON('room', {}, { onlyIfNew: true }), error => error instanceof StorageError && error.status === 404);
  const read = createStrongStore('storage-tests', { fetch: async () => new Response(null, { status: 412 }) });
  await assert.rejects(read.getWithMetadata('room', { type: 'json' }), error => error instanceof StorageError && error.status === 412);
});

test('network failures have bounded conditional retries with no SDK retry delay', async () => {
  let requests = 0;
  const store = createStrongStore('storage-tests', { fetch: async () => { requests++; throw new Error('private backend address'); } });
  await assert.rejects(store.setJSON('room', {}, { onlyIfNew: true }), error => error instanceof StorageError && error.status === 503 && !error.timedOut);
  assert.equal(requests, 3);
});

test('one storage deadline aborts stuck fetches and bounds all operations in an invocation', async () => {
  let signal: AbortSignal | null = null, requests = 0;
  const store = createStrongStore('storage-tests', { timeoutMs: 30, fetch: async (_, options) => { requests++; signal = options?.signal as AbortSignal; return new Promise<Response>(() => {}); } });
  // AbortSignal.timeout uses an unreferenced timer; keep this test alive even
  // when the deliberately stuck mock fetch owns no active I/O handles.
  const keepAlive = setTimeout(() => {}, 1000);
  const started = performance.now();
  try {
    await assert.rejects(store.setJSON('room', {}, { onlyIfNew: true }), error => error instanceof StorageError && error.timedOut);
    assert.ok(performance.now() - started < 500);
    assert.equal((signal as AbortSignal | null)?.aborted, true);
    await assert.rejects(store.getWithMetadata('room', { type: 'json' }), error => error instanceof StorageError && error.timedOut);
    assert.equal(requests, 1, 'an expired invocation cannot make another storage request');
  } finally { clearTimeout(keepAlive); }
});

test('concurrent SDK operations retain their own errors', async () => {
  const store = createStrongStore('storage-tests', { fetch: async (_, options) => options?.method === 'put' ? new Response(null, { status: 403 }) : Response.json({ score: 4 }, { headers: { etag: 'good-read' } }) });
  const [write, read] = await Promise.allSettled([store.setJSON('room', {}, { onlyIfNew: true }), store.getWithMetadata('room', { type: 'json' })]);
  assert.equal(write.status, 'rejected'); assert.ok(write.status === 'rejected' && write.reason instanceof StorageError);
  assert.equal(read.status, 'fulfilled'); assert.equal(read.status === 'fulfilled' && read.value?.data.score, 4);
});

test('separate warm-invocation stores isolate errors through the shared tracker', async () => {
  const failing = createStrongStore('storage-tests', { fetch: async () => { await new Promise(resolve => setTimeout(resolve, 5)); return new Response(null, { status: 503 }); } });
  const healthy = createStrongStore('storage-tests', { fetch: async () => { await new Promise(resolve => setTimeout(resolve, 10)); return Response.json({ score: 5 }, { headers: { etag: 'other-invocation' } }); } });
  const results = await Promise.allSettled([failing.setJSON('room', {}, { onlyIfMatch: 'old-etag' }), healthy.getWithMetadata('room', { type: 'json' })]);
  assert.equal(results[0].status, 'rejected');
  assert.ok(results[0].status === 'rejected' && results[0].reason instanceof StorageError);
  assert.equal(results[1].status, 'fulfilled');
  assert.equal(results[1].status === 'fulfilled' && results[1].value?.data.score, 5);
});

test('a transient upstream failure retries with the same condition and acknowledges only the successful write', async () => {
  const tags: (string | null)[] = [];
  const store = createStrongStore('storage-tests', { fetch: async (_, options) => {
    tags.push(new Headers(options?.headers).get('if-match'));
    return tags.length === 1 ? new Response(null, { status: 503 }) : new Response(null, { headers: { etag: 'confirmed' } });
  } });
  assert.deepEqual(await store.setJSON('room', { score: 1 }, { onlyIfMatch: 'previous' }), { modified: true, etag: 'confirmed' });
  assert.deepEqual(tags, ['previous', 'previous']);
});

test('an uncertain write followed by an ETag conflict never becomes a false success', async () => {
  let attempts = 0;
  const store = createStrongStore('storage-tests', { fetch: async () => {
    if (++attempts === 1) throw new Error('reply lost after write');
    return new Response(null, { status: 412 });
  } });
  assert.deepEqual(await store.setJSON('room', {}, { onlyIfMatch: 'previous' }), { modified: false });
  assert.equal(attempts, 2);
});

test('a provider Retry-After longer than the invocation budget is surfaced instead of retried early', async () => {
  let attempts = 0;
  const store = createStrongStore('storage-tests', { fetch: async () => {
    attempts++; return new Response(null, { status: 429, headers: { 'retry-after': '10' } });
  } });
  await assert.rejects(store.get('room'), error => error instanceof StorageError && error.status === 429 && error.retryAfterMs === 10_000);
  assert.equal(attempts, 1);
});
