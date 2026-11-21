export type ShareErrorKind = 'not-found' | 'revoked' | 'forbidden' | 'unauthorized' | 'too-large' | 'invalid' | 'network' | 'server';

export interface ShareError {
  kind: ShareErrorKind;
  message: string;
}

export type ShareResult<T> = { ok: true; value: T } | { ok: false; error: ShareError };

const MESSAGES: Record<ShareErrorKind, string> = {
  'not-found': 'This link does not exist.',
  revoked: 'The owner has turned this link off.',
  forbidden: 'This browser cannot change that link.',
  unauthorized: 'Turn on Cloud backup (and let it save once) before sharing.',
  'too-large': 'The plan is too large to share.',
  invalid: 'The server did not accept this plan.',
  network: 'Could not reach the sharing service. Check the connection and try again.',
  server: 'The sharing service had a problem. Try again in a moment.',
};
const fail = (kind: ShareErrorKind): { ok: false; error: ShareError } => ({ ok: false, error: { kind, message: MESSAGES[kind] } });

function kindFor(status: number): ShareErrorKind {
  if (status === 404) return 'not-found';
  if (status === 410) return 'revoked';
  if (status === 403) return 'forbidden';
  if (status === 401) return 'unauthorized';
  if (status === 413) return 'too-large';
  if (status === 400) return 'invalid';
  return 'server';
}

import { SHARE_BASE } from './config';

export const DEFAULT_BASE = SHARE_BASE;

/** Talks to the share API (docs/sharing-api.md). `base` and `fetchFn` are injectable for tests and hosting. */
export function shareClient(base: string = DEFAULT_BASE, fetchFn: typeof fetch = (...a) => fetch(...a), ownerKey: () => string | null = () => null) {
  async function call(path: string, init: RequestInit): Promise<ShareResult<unknown>> {
    let res: Response;
    try {
      res = await fetchFn(`${base}${path}`, init);
    } catch {
      return fail('network');
    }
    if (!res.ok) return fail(kindFor(res.status));
    try {
      return { ok: true, value: await res.json() };
    } catch {
      return fail('server');
    }
  }
  const json = (method: string, snapshot: unknown, key?: string): RequestInit => ({
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'x-revoke-key': key } : {}),
      // Creating a share on the hosted API proves you own a backed-up workspace.
      ...(method === 'POST' && ownerKey() ? { Authorization: `Bearer ${ownerKey()}` } : {}),
    },
    body: JSON.stringify({ snapshot }),
  });
  return {
    async create(snapshot: unknown): Promise<ShareResult<{ token: string; revokeKey: string }>> {
      const r = await call('', json('POST', snapshot));
      if (!r.ok) return r;
      const v = r.value as { token?: unknown; revokeKey?: unknown };
      return typeof v.token === 'string' && typeof v.revokeKey === 'string' ? { ok: true, value: { token: v.token, revokeKey: v.revokeKey } } : fail('server');
    },
    async fetch(token: string): Promise<ShareResult<unknown>> {
      const r = await call(`/${encodeURIComponent(token)}`, { method: 'GET', cache: 'no-store' });
      return r.ok ? { ok: true, value: (r.value as { snapshot?: unknown }).snapshot } : r;
    },
    async update(token: string, revokeKey: string, snapshot: unknown): Promise<ShareResult<true>> {
      const r = await call(`/${encodeURIComponent(token)}`, json('PUT', snapshot, revokeKey));
      return r.ok ? { ok: true, value: true } : r;
    },
    async revoke(token: string, revokeKey: string): Promise<ShareResult<true>> {
      const r = await call(`/${encodeURIComponent(token)}`, { method: 'DELETE', headers: { 'x-revoke-key': revokeKey } });
      return r.ok ? { ok: true, value: true } : r;
    },
  };
}

/** The link to a shared plan. `appPath` is where the app is served (a Pages site lives under /<repo>/). */
export const shareUrl = (origin: string, token: string, appPath: string = import.meta.env.BASE_URL ?? '/') => `${origin}${appPath}?share=${token}`;

/** The share token in a page URL, if there is a well-formed one. */
export function tokenFromSearch(search: string): string | null {
  const t = new URLSearchParams(search).get('share');
  return t && /^[A-Za-z0-9_-]{22}$/.test(t) ? t : null;
}
