// Keep abuse diagnostics useful without printing every held-fire tick or
// exposing private seat tokens. Deduplication also covers Function CAS retries.
const recent = new Map<string, number>();
export function logRejection(kind: 'shot' | 'leave', code: string, player: string, reason: string, now: number) {
  const key = `${kind}:${code}:${player}:${reason}`, previous = recent.get(key);
  if (previous !== undefined && now - previous < 1000) return;
  recent.delete(key); recent.set(key, now);
  while (recent.size > 2048) recent.delete(recent.keys().next().value!);
  console.warn(`[NEON BREACH] rejected ${kind}; room=${code}; operator=${player}; reason=${reason}`);
}
