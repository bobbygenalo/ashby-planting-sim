import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_BODY_BYTES, shareMiddleware } from '../server/shareMiddleware';
import { fileShareStore, TOKEN_PATTERN } from '../server/shareStore';
import { SHARE_FORMAT } from '../src/share/format';
import { shareClient, shareUrl, tokenFromSearch } from '../src/share/client';

let dir: string;
let server: Server;
let base: string;
const snap = (name = 'Plan A') => ({ format: SHARE_FORMAT, name, marker: 'SECRET-PLAN-CONTENT' });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ashby-share-'));
  const handler = shareMiddleware(fileShareStore(dir));
  server = createServer((req, res) => {
    void handler(req, res, () => {
      res.statusCode = 404;
      res.end('not the api');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/share`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
});

const client = () => shareClient(base);
const raw = (path: string, init?: RequestInit) => fetch(`${base}${path}`, init);

describe('share API', () => {
  it('creates a link and reads the snapshot back with no login', async () => {
    const c = client();
    const made = await c.create(snap());
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.value.token).toMatch(TOKEN_PATTERN);
    expect(made.value.revokeKey.length).toBeGreaterThan(20);
    const got = await c.fetch(made.value.token);
    expect(got).toEqual({ ok: true, value: snap() });
  });

  it('makes tokens that cannot be guessed: 128 random bits, all different', async () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const r = await client().create(snap(`p${i}`));
      if (r.ok) tokens.add(r.value.token);
    }
    expect(tokens.size).toBe(60);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/);
    // Tokens carry no counter: consecutive ones share no long prefix.
    const list = [...tokens];
    expect(list.every((t, i) => i === 0 || t.slice(0, 6) !== list[i - 1].slice(0, 6))).toBe(true);
  });

  it('M7 acceptance: revoking the link blocks access, and the plan is gone from storage', async () => {
    const c = client();
    const made = await c.create(snap('To revoke'));
    if (!made.ok) throw new Error('create failed');
    const { token, revokeKey } = made.value;
    expect((await c.fetch(token)).ok).toBe(true);
    expect(await c.revoke(token, revokeKey)).toEqual({ ok: true, value: true });
    const after = await c.fetch(token);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error.kind).toBe('revoked');
    expect((await raw(`/${token}`)).status).toBe(410);
    // The snapshot is deleted, not just hidden.
    const onDisk = await readFile(join(dir, `${token}.json`), 'utf8');
    expect(onDisk).not.toContain('SECRET-PLAN-CONTENT');
    // Revoking again is harmless, and a revoked link cannot be updated.
    expect((await c.revoke(token, revokeKey)).ok).toBe(true);
    const upd = await c.update(token, revokeKey, snap());
    expect(upd.ok).toBe(false);
    if (!upd.ok) expect(upd.error.kind).toBe('revoked');
  });

  it('lets only the owner update or revoke: the key is required and compared exactly', async () => {
    const c = client();
    const made = await c.create(snap('Owned'));
    if (!made.ok) throw new Error('create failed');
    const { token, revokeKey } = made.value;
    for (const bad of ['', 'wrong', revokeKey.slice(0, -1), `${revokeKey}x`]) {
      const u = await c.update(token, bad, snap('Hacked'));
      expect(u.ok).toBe(false);
      if (!u.ok) expect(u.error.kind).toBe('forbidden');
      const r = await c.revoke(token, bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe('forbidden');
    }
    const still = await c.fetch(token);
    expect(still).toEqual({ ok: true, value: snap('Owned') });
    // The right key updates it; the same link now shows the new plan.
    expect((await c.update(token, revokeKey, snap('Updated'))).ok).toBe(true);
    expect(await c.fetch(token)).toEqual({ ok: true, value: snap('Updated') });
  });

  it('never stores the revoke key itself, only a hash', async () => {
    const made = await client().create(snap('Hash check'));
    if (!made.ok) throw new Error('create failed');
    const onDisk = await readFile(join(dir, `${made.value.token}.json`), 'utf8');
    expect(onDisk).not.toContain(made.value.revokeKey);
    expect(onDisk).toMatch(/"revokeKeyHash":"[0-9a-f]{64}"/);
  });

  it('answers 404 for unknown or malformed tokens without touching other files', async () => {
    const before = (await readdir(dir)).length;
    for (const t of ['AAAAAAAAAAAAAAAAAAAAAA', 'short', '..%2F..%2Fetc%2Fpasswd', '%2e%2e', 'a'.repeat(40)]) {
      expect((await raw(`/${t}`)).status).toBe(404);
      expect((await raw(`/${t}`, { method: 'DELETE', headers: { 'x-revoke-key': 'k' } })).status).toBe(404);
    }
    expect((await readdir(dir)).length).toBe(before);
  });

  it('rejects bad requests: invalid JSON, wrong format, too large, wrong method', async () => {
    const post = (body: string) => raw('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    expect((await post('not json')).status).toBe(400);
    expect((await post(JSON.stringify({ snapshot: { format: 'other/1' } }))).status).toBe(400);
    expect((await post(JSON.stringify({}))).status).toBe(400);
    const big = JSON.stringify({ snapshot: { format: SHARE_FORMAT, pad: 'x'.repeat(MAX_BODY_BYTES) } });
    expect((await post(big)).status).toBe(413);
    expect((await raw('', { method: 'GET' })).status).toBe(405);
    expect((await raw('/AAAAAAAAAAAAAAAAAAAAAA', { method: 'PATCH' })).status).toBe(405);
  });

  it('sends no-store so a revoked link stops working at once', async () => {
    const made = await client().create(snap());
    if (!made.ok) throw new Error('create failed');
    const res = await raw(`/${made.value.token}`);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('ignores requests outside its path', async () => {
    const res = await fetch(base.replace('/api/share', '/index.html'));
    expect(await res.text()).toBe('not the api');
  });

  it('reports network failure as its own error', async () => {
    const dead = shareClient('http://127.0.0.1:1/api/share');
    const r = await dead.fetch('AAAAAAAAAAAAAAAAAAAAAA');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('network');
  });
});

describe('share links', () => {
  it('builds a link and reads the token from a page URL, accepting only well-formed ones', () => {
    expect(shareUrl('https://x.test', 'AAAAAAAAAAAAAAAAAAAAAA')).toBe('https://x.test/?share=AAAAAAAAAAAAAAAAAAAAAA');
    expect(tokenFromSearch('?share=AAAAAAAAAAAAAAAAAAAAAA')).toBe('AAAAAAAAAAAAAAAAAAAAAA');
    expect(tokenFromSearch('?share=short')).toBeNull();
    expect(tokenFromSearch('?share=../../etc/passwd')).toBeNull();
    expect(tokenFromSearch('')).toBeNull();
  });
});
