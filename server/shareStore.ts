import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** A share token is 16 random bytes (128 bits) in base64url: 22 characters. Nothing else is ever used as a file name. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export type GetResult = { state: 'ok'; snapshot: unknown; updatedAt: string } | { state: 'revoked' } | { state: 'missing' };

/**
 * Where shared snapshots live. The dev server uses the file-backed version below; a hosted deployment
 * implements the same four operations over a key-value store (see docs/sharing-api.md).
 */
export interface ShareStore {
  create(snapshot: unknown): Promise<{ token: string; revokeKey: string }>;
  get(token: string): Promise<GetResult>;
  update(token: string, revokeKey: string, snapshot: unknown): Promise<'ok' | 'missing' | 'revoked' | 'forbidden'>;
  revoke(token: string, revokeKey: string): Promise<'ok' | 'missing' | 'forbidden'>;
}

interface Record_ {
  revokeKeyHash: string;
  createdAt: string;
  updatedAt: string;
  revoked: boolean;
  /** Removed when the link is revoked, so a revoked plan does not stay on disk. */
  snapshot: unknown | null;
}

const hash = (key: string) => createHash('sha256').update(key).digest('hex');

function sameKey(key: string, expectedHash: string): boolean {
  const a = Buffer.from(hash(key), 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function fileShareStore(dir: string, now: () => Date = () => new Date()): ShareStore {
  const file = (token: string) => join(dir, `${token}.json`);

  async function read(token: string): Promise<Record_ | null> {
    if (!TOKEN_PATTERN.test(token)) return null;
    try {
      return JSON.parse(await readFile(file(token), 'utf8')) as Record_;
    } catch {
      return null;
    }
  }
  const write = async (token: string, rec: Record_) => {
    await mkdir(dir, { recursive: true });
    await writeFile(file(token), JSON.stringify(rec), 'utf8');
  };

  return {
    async create(snapshot) {
      const token = randomBytes(16).toString('base64url');
      const revokeKey = randomBytes(24).toString('base64url');
      const t = now().toISOString();
      await write(token, { revokeKeyHash: hash(revokeKey), createdAt: t, updatedAt: t, revoked: false, snapshot });
      return { token, revokeKey };
    },
    async get(token) {
      const rec = await read(token);
      if (!rec) return { state: 'missing' };
      if (rec.revoked) return { state: 'revoked' };
      return { state: 'ok', snapshot: rec.snapshot, updatedAt: rec.updatedAt };
    },
    async update(token, revokeKey, snapshot) {
      const rec = await read(token);
      if (!rec) return 'missing';
      if (!sameKey(revokeKey, rec.revokeKeyHash)) return 'forbidden';
      if (rec.revoked) return 'revoked';
      await write(token, { ...rec, snapshot, updatedAt: now().toISOString() });
      return 'ok';
    },
    async revoke(token, revokeKey) {
      const rec = await read(token);
      if (!rec) return 'missing';
      if (!sameKey(revokeKey, rec.revokeKeyHash)) return 'forbidden';
      await write(token, { ...rec, revoked: true, snapshot: null, updatedAt: now().toISOString() });
      return 'ok';
    },
  };
}

/** Delete a record outright. Used by tests; links are normally revoked, never deleted. */
export async function purge(dir: string, token: string): Promise<void> {
  if (TOKEN_PATTERN.test(token)) await rm(join(dir, `${token}.json`), { force: true });
}
