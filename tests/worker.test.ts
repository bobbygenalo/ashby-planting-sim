import { describe, expect, it } from 'vitest';
import { handle, MAX_SHARE_BYTES, type Env, type KV } from '../worker/src/api';
import { SHARE_FORMAT } from '../src/share/format';

function fakeKv(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, put: async (k, v) => void data.set(k, v), delete: async (k) => void data.delete(k) };
}
const ORIGIN = 'https://bobbygenalo.com';
const mk = () => ({ PLANNER: fakeKv(), ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173` }) as Env & { PLANNER: ReturnType<typeof fakeKv> };
const call = (env: Env, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  handle(new Request(`https://api.test${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
const snap = { format: SHARE_FORMAT, scenario: { n: 1 } };
const KEY = 'k'.repeat(22);
const OWNER = { authorization: `Bearer ${KEY}` };
/** An owner with a saved workspace, who is the only one allowed to create shares. */
const withOwner = async <E extends Env>(env: E): Promise<E> => {
  await call(env, 'PUT', '/api/workspace', { workspace: { format: 'ashby-workspace/1' }, expected: null }, OWNER);
  return env;
};

describe('share links on KV', () => {
  it('creates, reads, updates and revokes, keeping a tombstone', async () => {
    const env = await withOwner(mk());
    const created = await call(env, 'POST', '/api/share', { snapshot: snap }, OWNER);
    expect(created.status).toBe(201);
    const { token, revokeKey } = (await created.json()) as { token: string; revokeKey: string };
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(created.headers.get('cache-control')).toBe('no-store');
    // the revoke key is stored only as a hash
    expect([...env.PLANNER.data.values()].join('')).not.toContain(revokeKey);

    const read = await call(env, 'GET', `/api/share/${token}`);
    expect(read.status).toBe(200);
    expect(((await read.json()) as { snapshot: typeof snap }).snapshot.scenario.n).toBe(1);

    expect((await call(env, 'PUT', `/api/share/${token}`, { snapshot: { ...snap, scenario: { n: 2 } } }, { 'x-revoke-key': 'wrong' })).status).toBe(403);
    expect((await call(env, 'PUT', `/api/share/${token}`, { snapshot: { ...snap, scenario: { n: 2 } } }, { 'x-revoke-key': revokeKey })).status).toBe(200);
    expect(((await (await call(env, 'GET', `/api/share/${token}`)).json()) as { snapshot: typeof snap }).snapshot.scenario.n).toBe(2);

    expect((await call(env, 'DELETE', `/api/share/${token}`, undefined, { 'x-revoke-key': 'wrong' })).status).toBe(403);
    expect((await call(env, 'DELETE', `/api/share/${token}`, undefined, { 'x-revoke-key': revokeKey })).status).toBe(200);
    expect((await call(env, 'GET', `/api/share/${token}`)).status).toBe(410);
    expect(env.PLANNER.data.get(`share:${token}`)).not.toContain('"n":2');
    expect((await call(env, 'PUT', `/api/share/${token}`, { snapshot: snap }, { 'x-revoke-key': revokeKey })).status).toBe(410);
  });

  it('lets only an owner with a saved workspace create shares', async () => {
    const env = mk();
    expect((await call(env, 'POST', '/api/share', { snapshot: snap })).status).toBe(401);
    expect((await call(env, 'POST', '/api/share', { snapshot: snap }, OWNER)).status).toBe(401); // key is well-formed but has no workspace
    expect((await call(env, 'POST', '/api/share', { snapshot: snap }, { authorization: 'Bearer short' })).status).toBe(401);
    await withOwner(env);
    expect((await call(env, 'POST', '/api/share', { snapshot: snap }, OWNER)).status).toBe(201);
  });

  it('rejects malformed tokens, bad bodies and oversized snapshots', async () => {
    const env = await withOwner(mk());
    expect((await call(env, 'GET', '/api/share/../../etc')).status).toBe(404);
    expect((await call(env, 'GET', '/api/share/short')).status).toBe(404);
    expect((await call(env, 'GET', `/api/share/${'a'.repeat(22)}`)).status).toBe(404);
    expect((await call(env, 'POST', '/api/share', { snapshot: { format: 'other' } }, OWNER)).status).toBe(400);
    const bad = await handle(new Request('https://api.test/api/share', { method: 'POST', body: '{nope', headers: OWNER }), env);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe('invalid-json');
    const big = { snapshot: { format: SHARE_FORMAT, pad: 'x'.repeat(MAX_SHARE_BYTES) } };
    expect((await call(env, 'POST', '/api/share', big, OWNER)).status).toBe(413);
    expect((await call(env, 'GET', '/api/share')).status).toBe(405);
  });
});

describe('workspace store', () => {
  const ws = (n: number) => ({ format: 'ashby-workspace/1', n });

  it('needs a well-formed sync key and stores only its hash', async () => {
    const env = mk();
    expect((await call(env, 'GET', '/api/workspace')).status).toBe(401);
    expect((await call(env, 'GET', '/api/workspace', undefined, { authorization: 'Bearer short' })).status).toBe(401);
    expect((await call(env, 'GET', '/api/workspace', undefined, { authorization: `Bearer ${KEY}` })).status).toBe(404);
    await call(env, 'PUT', '/api/workspace', { workspace: ws(1), expected: null }, { authorization: `Bearer ${KEY}` });
    expect([...env.PLANNER.data.keys()].join('')).not.toContain(KEY);
  });

  it('keeps workspaces apart by key', async () => {
    const env = mk();
    const A = { authorization: `Bearer ${KEY}` }, B = { authorization: `Bearer ${'z'.repeat(22)}` };
    await call(env, 'PUT', '/api/workspace', { workspace: ws(1), expected: null }, A);
    expect((await call(env, 'GET', '/api/workspace', undefined, B)).status).toBe(404);
    expect(((await (await call(env, 'GET', '/api/workspace', undefined, A)).json()) as { workspace: { n: number } }).workspace.n).toBe(1);
  });

  it('refuses a write made against a stale copy', async () => {
    const env = mk();
    const A = { authorization: `Bearer ${KEY}` };
    const first = await call(env, 'PUT', '/api/workspace', { workspace: ws(1), expected: null }, A);
    const { updatedAt } = (await first.json()) as { updatedAt: string };
    expect((await call(env, 'PUT', '/api/workspace', { workspace: ws(2), expected: null }, A)).status).toBe(409); // someone already created it
    const ok = await call(env, 'PUT', '/api/workspace', { workspace: ws(2), expected: updatedAt }, A);
    expect(ok.status).toBe(200);
    const stale = await call(env, 'PUT', '/api/workspace', { workspace: ws(3), expected: updatedAt }, A);
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: string }).error).toBe('conflict');
    expect((await call(env, 'PUT', '/api/workspace', { workspace: { format: 'nope' }, expected: updatedAt }, A)).status).toBe(400);
  });
});

describe('CORS', () => {
  it('answers preflight and echoes only listed origins', async () => {
    const env = mk();
    const pre = await handle(new Request('https://api.test/api/share', { method: 'OPTIONS', headers: { origin: ORIGIN } }), env);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(pre.headers.get('access-control-allow-headers')).toContain('x-revoke-key');
    expect(pre.headers.get('access-control-allow-headers')).toContain('authorization');
    const other = await handle(new Request('https://api.test/api/share/' + 'a'.repeat(22), { headers: { origin: 'https://evil.example' } }), env);
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    const ok = await handle(new Request('https://api.test/api/share/' + 'a'.repeat(22), { headers: { origin: ORIGIN } }), env);
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });
});
