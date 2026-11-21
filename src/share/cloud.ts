export type CloudErrorKind = 'conflict' | 'unauthorized' | 'too-large' | 'invalid' | 'network' | 'server';
export type CloudResult<T> = { ok: true; value: T } | { ok: false; kind: CloudErrorKind; updatedAt?: string | null };

/** A sync key is 22 URL-safe characters from 128 random bits. Whoever holds it can read and write that workspace. */
export function generateSyncKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const isSyncKey = (k: string) => /^[A-Za-z0-9_-]{22,64}$/.test(k);

/** The workspace store on the hosted API (worker/src/index.ts). `fetchFn` is injectable for tests. */
export function cloudClient(base: string, key: string, fetchFn: typeof fetch = (...a) => fetch(...a)) {
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  async function call(init: RequestInit): Promise<{ status: number; body: Record<string, unknown> } | null> {
    try {
      const res = await fetchFn(`${base}/api/workspace`, { ...init, headers, cache: 'no-store' });
      let body: Record<string, unknown> = {};
      try {
        body = (await res.json()) as Record<string, unknown>;
      } catch {
        /* an empty or non-JSON body is treated as no details */
      }
      return { status: res.status, body };
    } catch {
      return null;
    }
  }
  const kindFor = (status: number): CloudErrorKind => (status === 401 ? 'unauthorized' : status === 413 ? 'too-large' : status === 400 ? 'invalid' : 'server');
  return {
    /** The saved workspace, or null when nothing has been saved under this key yet. */
    async get(): Promise<CloudResult<{ workspace: unknown; updatedAt: string } | null>> {
      const r = await call({ method: 'GET' });
      if (!r) return { ok: false, kind: 'network' };
      if (r.status === 404) return { ok: true, value: null };
      if (r.status !== 200) return { ok: false, kind: kindFor(r.status) };
      return typeof r.body.updatedAt === 'string' ? { ok: true, value: { workspace: r.body.workspace, updatedAt: r.body.updatedAt } } : { ok: false, kind: 'server' };
    },
    /** Save. `expected` is the updatedAt this browser last saw (null for the first save); a different copy answers conflict. */
    async put(workspace: unknown, expected: string | null): Promise<CloudResult<{ updatedAt: string }>> {
      const r = await call({ method: 'PUT', body: JSON.stringify({ workspace, expected }) });
      if (!r) return { ok: false, kind: 'network' };
      if (r.status === 409) return { ok: false, kind: 'conflict', updatedAt: (r.body.updatedAt as string | null | undefined) ?? null };
      if (r.status !== 200 || typeof r.body.updatedAt !== 'string') return { ok: false, kind: kindFor(r.status) };
      return { ok: true, value: { updatedAt: r.body.updatedAt } };
    },
  };
}
