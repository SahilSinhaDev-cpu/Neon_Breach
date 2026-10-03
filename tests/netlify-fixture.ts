import { BlobsServer } from '@netlify/blobs/server';
import { getStore, setEnvironmentContext } from '@netlify/blobs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STORE_NAME, type StoredRoom } from '../netlify/lib/authority';

export async function blobFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'neon-netlify-'));
  const server = new BlobsServer({ directory, logger: () => {} });
  // SDK 11.1.3's filesystem emulator omits GET ETags and checks conditions
  // before asynchronous writes. Adapt these two gaps ONLY in the local fixture
  // to exercise the hosted Blobs contract. Production never uses this code.
  const implementation = server as unknown as {
    put(request: Request): Promise<Response>; get(request: Request): Promise<Response>;
    address: string; getLocalPaths(url: URL): { dataPath: string | null };
  };
  const put = implementation.put.bind(server);
  const get = implementation.get.bind(server);
  let writes: Promise<unknown> = Promise.resolve();
  implementation.put = request => {
    const result = writes.then(() => put(request));
    writes = result.catch(() => {}); return result;
  };
  implementation.get = request => {
    const result = writes.then(async () => {
      const response = await get(request);
      const { dataPath } = implementation.getLocalPaths(new URL(request.url, implementation.address));
      if (response.status !== 200 || !dataPath || response.headers.get('content-type')?.startsWith('application/json')) return response;
      const constructor = BlobsServer as unknown as { generateETag(path: string): Promise<string> };
      const headers = new Headers(response.headers); headers.set('etag', await constructor.generateETag(dataPath));
      return new Response(response.body, { status: response.status, headers });
    });
    writes = result.catch(() => {}); return result;
  };
  const { port } = await server.start();
  const url = `http://127.0.0.1:${port}`;
  const context = { siteID: 'neon-breach-test', token: 'local-fixture-only', apiURL: url, edgeURL: url, uncachedEdgeURL: url };
  setEnvironmentContext(context);
  const store = getStore({ name: STORE_NAME, consistency: 'strong' });
  return {
    store, context,
    async edit(code: string, edit: (data: StoredRoom) => void) {
      for (let i = 0; i < 20; i++) {
        const entry = await store.getWithMetadata(`rooms/${code}`, { type: 'json', consistency: 'strong' });
        if (!entry) throw new Error('Fixture room missing');
        edit(entry.data); entry.data.revision = crypto.randomUUID();
        if ((await store.setJSON(`rooms/${code}`, entry.data, { onlyIfMatch: entry.etag })).modified) return;
      }
      throw new Error('Fixture CAS busy');
    },
    async read(code: string): Promise<StoredRoom> { const data = await store.get(`rooms/${code}`, { type: 'json', consistency: 'strong' }); if (!data) throw new Error('Fixture room missing'); return data; },
    async close() { await server.stop(); await rm(directory, { recursive: true, force: true }); },
  };
}
