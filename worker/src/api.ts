import { SHARE_FORMAT } from '../../src/share/format';

/**
 * The planner's hosted API on Cloudflare Workers + KV. It implements docs/sharing-api.md (read-only share links)
 * and a private workspace store so one owner's scenarios follow them between browsers.
 *
 *   POST   /api/share          create a share            (Authorization: Bearer <sync key> of a saved workspace) -> 201 { token, revokeKey }
 *   GET    /api/share/:token   read a share              -> 200 { snapshot, updatedAt } | 404 | 410
 *   PUT    /api/share/:token   update (x-revoke-key)
 *   DELETE /api/share/:token   revoke (x-revoke-key)
 *   GET    /api/workspace      read the workspace        (Authorization: Bearer <sync key>)
 *   PUT    /api/workspace      write it                  body { workspace, expected }; 409 when it changed elsewhere
 */

export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Env {
  PLANNER: KV;
  /** Comma-separated origins allowed to call the API from a browser, for example https://bobbygenalo.com */
  ALLOWED_ORIGINS?: string;
}

export const MAX_SHARE_BYTES = 2 * 1024 * 1024;
export const MAX_WORKSPACE_BYTES = 4 * 1024 * 1024;
export const WORKSPACE_FORMAT = 'ashby-workspace/1';
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;
/** A sync key is chosen by the app: at least 22 URL-safe characters (about 128 bits when random). */
export const SYNC_KEY_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const randomToken = (bytes: number) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('origin');
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-revoke-key, authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(req: Request, env: Env, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(req, env) },
  });
}

/** Read a JSON body, answering 413 before parsing when it is over the limit. */
async function readJson(req: Request, limit: number): Promise<{ ok: true; value: unknown } | { ok: false; status: 400 | 413; error: string }> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > limit) return { ok: false, status: 413, error: 'too-large' };
  const buf = await req.arrayBuffer();
  if (buf.byteLength > limit) return { ok: false, status: 413, error: 'too-large' };
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(buf)) };
  } catch {
    return { ok: false, status: 400, error: 'invalid-json' };
  }
}

interface ShareRecord {
  revokeKeyHash: string;
  createdAt: string;
  updatedAt: string;
  revoked: boolean;
  snapshot: unknown | null;
}

const isSnapshot = (v: unknown): v is { format: string } =>
  !!v && typeof v === 'object' && (v as { format?: unknown }).format === SHARE_FORMAT;

async function readShare(env: Env, token: string): Promise<ShareRecord | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const raw = await env.PLANNER.get(`share:${token}`);
  return raw ? (JSON.parse(raw) as ShareRecord) : null;
}

async function handleShare(req: Request, env: Env, rest: string): Promise<Response> {
  const method = req.method;
  if (rest === '') {
    if (method !== 'POST') return json(req, env, 405, { error: 'method-not-allowed' });
    // Only an owner with a saved workspace can create shares, so a stranger cannot fill the store.
    const auth = req.headers.get('authorization') ?? '';
    const ownerKey = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!SYNC_KEY_PATTERN.test(ownerKey) || !(await env.PLANNER.get(`ws:${await sha256Hex(ownerKey)}`))) return json(req, env, 401, { error: 'unauthorized' });
    const body = await readJson(req, MAX_SHARE_BYTES);
    if (!body.ok) return json(req, env, body.status, { error: body.error });
    const snapshot = (body.value as { snapshot?: unknown } | null)?.snapshot;
    if (!isSnapshot(snapshot)) return json(req, env, 400, { error: 'invalid-snapshot' });
    const token = randomToken(16);
    const revokeKey = randomToken(24);
    const now = new Date().toISOString();
    const rec: ShareRecord = { revokeKeyHash: await sha256Hex(revokeKey), createdAt: now, updatedAt: now, revoked: false, snapshot };
    await env.PLANNER.put(`share:${token}`, JSON.stringify(rec));
    return json(req, env, 201, { token, revokeKey });
  }
  const token = rest.slice(1);
  const key = req.headers.get('x-revoke-key') ?? '';
  if (method === 'GET') {
    const rec = await readShare(env, token);
    if (!rec) return json(req, env, 404, { error: 'not-found' });
    if (rec.revoked) return json(req, env, 410, { error: 'revoked' });
    return json(req, env, 200, { snapshot: rec.snapshot, updatedAt: rec.updatedAt });
  }
  if (method === 'PUT') {
    const body = await readJson(req, MAX_SHARE_BYTES);
    if (!body.ok) return json(req, env, body.status, { error: body.error });
    const snapshot = (body.value as { snapshot?: unknown } | null)?.snapshot;
    if (!isSnapshot(snapshot)) return json(req, env, 400, { error: 'invalid-snapshot' });
    const rec = await readShare(env, token);
    if (!rec) return json(req, env, 404, { error: 'not-found' });
    if (!sameHex(await sha256Hex(key), rec.revokeKeyHash)) return json(req, env, 403, { error: 'forbidden' });
    if (rec.revoked) return json(req, env, 410, { error: 'revoked' });
    await env.PLANNER.put(`share:${token}`, JSON.stringify({ ...rec, snapshot, updatedAt: new Date().toISOString() }));
    return json(req, env, 200, { ok: true });
  }
  if (method === 'DELETE') {
    const rec = await readShare(env, token);
    if (!rec) return json(req, env, 404, { error: 'not-found' });
    if (!sameHex(await sha256Hex(key), rec.revokeKeyHash)) return json(req, env, 403, { error: 'forbidden' });
    // The snapshot goes; a tombstone stays so a revoked link answers 410, not 404.
    await env.PLANNER.put(`share:${token}`, JSON.stringify({ ...rec, revoked: true, snapshot: null, updatedAt: new Date().toISOString() }));
    return json(req, env, 200, { ok: true });
  }
  return json(req, env, 405, { error: 'method-not-allowed' });
}

interface WorkspaceRecord {
  workspace: unknown;
  updatedAt: string;
}

async function handleWorkspace(req: Request, env: Env): Promise<Response> {
  const auth = req.headers.get('authorization') ?? '';
  const syncKey = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!SYNC_KEY_PATTERN.test(syncKey)) return json(req, env, 401, { error: 'unauthorized' });
  // Only a hash of the key is used as the storage name, so the key itself is never stored.
  const storeKey = `ws:${await sha256Hex(syncKey)}`;
  const raw = await env.PLANNER.get(storeKey);
  const current = raw ? (JSON.parse(raw) as WorkspaceRecord) : null;
  if (req.method === 'GET') {
    if (!current) return json(req, env, 404, { error: 'not-found' });
    return json(req, env, 200, current);
  }
  if (req.method === 'PUT') {
    const body = await readJson(req, MAX_WORKSPACE_BYTES);
    if (!body.ok) return json(req, env, body.status, { error: body.error });
    const { workspace, expected } = (body.value ?? {}) as { workspace?: { format?: string }; expected?: string | null };
    if (!workspace || typeof workspace !== 'object' || workspace.format !== WORKSPACE_FORMAT) return json(req, env, 400, { error: 'invalid-workspace' });
    const have = current?.updatedAt ?? null;
    if ((expected ?? null) !== have) return json(req, env, 409, { error: 'conflict', updatedAt: have });
    // updatedAt doubles as the version a client must quote, so it must never repeat, even within one millisecond.
    const now = new Date();
    const next = have && now.toISOString() <= have ? new Date(Date.parse(have) + 1) : now;
    const rec: WorkspaceRecord = { workspace, updatedAt: next.toISOString() };
    await env.PLANNER.put(storeKey, JSON.stringify(rec));
    return json(req, env, 200, { ok: true, updatedAt: rec.updatedAt });
  }
  return json(req, env, 405, { error: 'method-not-allowed' });
}

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });
  const path = new URL(req.url).pathname;
  try {
    if (path === '/api/share' || path.startsWith('/api/share/')) return await handleShare(req, env, path.slice('/api/share'.length));
    if (path === '/api/workspace') return await handleWorkspace(req, env);
    if (path === '/' || path === '/api') return json(req, env, 200, { ok: true, service: 'ashby-planner-api' });
    return json(req, env, 404, { error: 'not-found' });
  } catch {
    return json(req, env, 500, { error: 'server-error' });
  }
}
