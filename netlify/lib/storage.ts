import { AsyncLocalStorage } from 'node:async_hooks';
import { getStore, type Store } from '@netlify/blobs';
import { setTimeout as delay } from 'node:timers/promises';

export const STORAGE_TIMEOUT_MS = 4000;
// One tracker for the module. Per-invocation instances remain registered in
// Node's async hook list until disabled and make long-lived warm functions
// progressively slower. run() still isolates each concurrent operation.
const operations = new AsyncLocalStorage<{ failure?: StorageError }>();
export class StorageError extends Error {
  constructor(public status: number, public timedOut = false, public retryAfterMs = 0) {
    super(timedOut ? 'Station storage timed out.' : `Station storage failed (${status}).`);
    this.name = 'StorageError';
  }
}

// The Blobs SDK retries every thrown fetch error, and its conditional-write
// path treats every HTTP status except 412 as a successful write. Validate at
// the Store boundary instead, before an action can acknowledge unwritten state.
// A neutral 422 prevents the SDK's unbounded-for-gameplay retry loop; the real
// error is retained per operation and thrown to the authority immediately.
export function createStrongStore(name: string, options: { fetch?: typeof fetch; timeoutMs?: number } = {}): Store {
  const transport = options.fetch ?? globalThis.fetch;
  const deadline = Date.now() + (options.timeoutMs ?? STORAGE_TIMEOUT_MS);
  const budget = AbortSignal.timeout(options.timeoutMs ?? STORAGE_TIMEOUT_MS);
  const checkedFetch: typeof fetch = async (input, init) => {
    const operation = operations.getStore();
    if (!operation) throw new Error('Storage fetch must run inside a checked operation.');
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : null);
    const signal = requestSignal ? AbortSignal.any([budget, requestSignal]) : budget;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    // Reads and conditional writes can be retried without overwriting a newer
    // room. Keep every retry inside this invocation's total storage deadline.
    const canRetry = method === 'GET' || method === 'HEAD' || (method === 'PUT' && (headers.has('if-match') || headers.has('if-none-match')));
    for (let attempt = 0; attempt < 3; attempt++) {
      let stop: (() => void) | undefined;
      let retryAfterMs = 0;
      try {
      const aborted = new Promise<never>((_, reject) => {
        const onAbort = () => reject(signal.reason);
        if (signal.aborted) onAbort();
        else { signal.addEventListener('abort', onAbort, { once: true }); stop = () => signal.removeEventListener('abort', onAbort); }
      });
      const response = await Promise.race([transport(input, { ...init, signal }), aborted]);
      const missingRead = response.status === 404 && ['GET', 'HEAD', 'DELETE'].includes(method);
      const conflict = response.status === 412 && method === 'PUT' && (headers.has('if-match') || headers.has('if-none-match'));
      if (response.ok || missingRead || conflict) return response;
      const retryHeader = response.headers.get('retry-after');
      retryAfterMs = retryHeader === null ? 0 : Number.isFinite(Number(retryHeader)) ? Math.max(0, Number(retryHeader) * 1000) : Math.max(0, Date.parse(retryHeader) - Date.now()) || 0;
      operation.failure = new StorageError(response.status, false, retryAfterMs);
      await response.body?.cancel();
      if (![408, 429, 500, 502, 503, 504].includes(response.status)) break;
      } catch {
        operation.failure = new StorageError(503, budget.aborted || signal.aborted);
      } finally { stop?.(); }
      const pause = Math.max(retryAfterMs, 60 * (attempt + 1) + Math.random() * 60);
      if (!canRetry || attempt === 2 || signal.aborted || Date.now() + pause + 100 >= deadline) break;
      try { await delay(pause, undefined, { signal }); } catch { operation.failure = new StorageError(503, true); break; }
      // A successful retry must not inherit the previous attempt's error.
      operation.failure = undefined;
    }
    return new Response(null, { status: 422 });
  };
  // Site ID, credentials, and the uncached endpoint still come exclusively
  // from Netlify's automatic function context. Nothing is configured by users.
  const store = getStore({ name, consistency: 'strong', fetch: checkedFetch });
  return new Proxy(store, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== 'function' || property === 'constructor') return value;
      return async (...args: unknown[]) => {
        if (budget.aborted) throw new StorageError(503, true);
        const operation: { failure?: StorageError } = {};
        return operations.run(operation, async () => {
          try {
            const result = await value.apply(target, args);
            if (operation.failure) throw operation.failure;
            return result;
          } catch (error) { throw operation.failure ?? error; }
        });
      };
    },
  });
}
