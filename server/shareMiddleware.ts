import type { IncomingMessage, ServerResponse } from 'node:http';
import { SHARE_FORMAT } from '../src/share/format';
import type { ShareStore } from './shareStore';

/** Largest snapshot accepted. A busy plan is well under 200 KB. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

type Next = () => void;

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** Past this many bytes the connection is cut, so a runaway upload cannot tie the server up. */
const HARD_CAP_BYTES = 16 * MAX_BODY_BYTES;

/**
 * Read a request body. If it is larger than the limit it is thrown away as it arrives (not buffered), and the
 * caller still gets to answer 413 on a connection that is still open.
 */
function readBody(req: IncomingMessage): Promise<{ ok: true; text: string } | { ok: false; tooLarge: true }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > HARD_CAP_BYTES) {
        req.destroy();
        return;
      }
      if (size <= MAX_BODY_BYTES) chunks.push(c);
    });
    req.on('end', () => resolve(size > MAX_BODY_BYTES ? { ok: false, tooLarge: true } : { ok: true, text: Buffer.concat(chunks).toString('utf8') }));
    req.on('error', () => resolve({ ok: false, tooLarge: true }));
    req.on('close', () => resolve({ ok: false, tooLarge: true }));
  });
}

async function snapshotFrom(req: IncomingMessage, res: ServerResponse): Promise<unknown | undefined> {
  const body = await readBody(req);
  if (!body.ok) {
    send(res, 413, { error: 'too-large' });
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    send(res, 400, { error: 'invalid-json' });
    return undefined;
  }
  const snap = (parsed as { snapshot?: { format?: string } } | null)?.snapshot;
  if (!snap || typeof snap !== 'object' || snap.format !== SHARE_FORMAT) {
    send(res, 400, { error: 'invalid-snapshot' });
    return undefined;
  }
  return snap;
}

/**
 * The share API as Connect-style middleware (see docs/sharing-api.md):
 *   POST   /api/share          create        -> 201 { token, revokeKey }
 *   GET    /api/share/:token   read          -> 200 { snapshot } | 404 | 410 revoked
 *   PUT    /api/share/:token   update        (header x-revoke-key)
 *   DELETE /api/share/:token   revoke        (header x-revoke-key)
 */
export function shareMiddleware(store: ShareStore, prefix = '/api/share') {
  return async (req: IncomingMessage, res: ServerResponse, next: Next) => {
    const url = (req.url ?? '').split('?')[0];
    if (url !== prefix && !url.startsWith(`${prefix}/`)) return next();
    const token = url.slice(prefix.length + 1);
    const key = String(req.headers['x-revoke-key'] ?? '');
    try {
      if (url === prefix) {
        if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' });
        const snap = await snapshotFrom(req, res);
        if (snap === undefined) return;
        return send(res, 201, await store.create(snap));
      }
      if (req.method === 'GET') {
        const r = await store.get(token);
        if (r.state === 'ok') return send(res, 200, { snapshot: r.snapshot, updatedAt: r.updatedAt });
        return r.state === 'revoked' ? send(res, 410, { error: 'revoked' }) : send(res, 404, { error: 'not-found' });
      }
      if (req.method === 'PUT') {
        const snap = await snapshotFrom(req, res);
        if (snap === undefined) return;
        const r = await store.update(token, key, snap);
        return r === 'ok' ? send(res, 200, { ok: true }) : send(res, r === 'missing' ? 404 : r === 'revoked' ? 410 : 403, { error: r === 'forbidden' ? 'forbidden' : r === 'revoked' ? 'revoked' : 'not-found' });
      }
      if (req.method === 'DELETE') {
        const r = await store.revoke(token, key);
        return r === 'ok' ? send(res, 200, { ok: true }) : send(res, r === 'missing' ? 404 : 403, { error: r === 'forbidden' ? 'forbidden' : 'not-found' });
      }
      return send(res, 405, { error: 'method-not-allowed' });
    } catch {
      return send(res, 500, { error: 'server-error' });
    }
  };
}
