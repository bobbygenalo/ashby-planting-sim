# Sharing API

Shared plans are read-only snapshots stored under an unguessable token. The app talks to this contract through `src/share/client.ts`.
The dev server implements it as files (`server/shareStore.ts`, `.share-data/`). The Cloudflare Worker in `worker/` implements the same four operations over Workers KV (see `cloud-deploy.md`); nothing in the app changes.

| Operation | Request | Success | Failure |
| --- | --- | --- | --- |
| Create | `POST /api/share` body `{ "snapshot": {...} }` | `201 { token, revokeKey }` | `400 invalid-json` or `invalid-snapshot`, `413 too-large` |
| Read | `GET /api/share/:token` | `200 { snapshot, updatedAt }` | `404 not-found`, `410 revoked` |
| Update | `PUT /api/share/:token`, header `x-revoke-key`, body `{ snapshot }` | `200 { ok: true }` | `403 forbidden`, `404`, `410`, `400`, `413` |
| Revoke | `DELETE /api/share/:token`, header `x-revoke-key` | `200 { ok: true }` | `403 forbidden`, `404 not-found` |

## Rules a host must keep

- **Token**: 128 random bits, base64url (22 characters). Generate it on the server. Reject anything that does not match `^[A-Za-z0-9_-]{22}$` before it touches storage.
- **Revoke key**: random, returned once at creation, stored only as a SHA-256 hash, compared in constant time. The owner's browser keeps it; it is never in the link.
- **Revoke deletes the snapshot** and keeps a tombstone so reads answer `410`, not `404`.
- **Snapshot**: the body must be an object with `format: "ashby-share/1"` and be at most 2 MB. The server does not need to understand the rest; the viewer validates it.
- **No auth for viewers.** Responses are `Cache-Control: no-store` so a revoked link stops working immediately.
- **CORS**: the dev setup is same-origin. If the API is on another origin, allow `GET` from the app's origin, and `POST`, `PUT`, `DELETE` with the `x-revoke-key` and `content-type` headers.

## Privacy

A snapshot contains the lot layout (the site), the scenario, any custom species it uses, soil entries, and the starting timeline date. It contains no name, email, or account. With "hide address" on, the snapshot's site has no name or address and its coordinates are rounded to 0.1 degree. The page that serves the app is a separate matter: a build that includes the owner's site file still contains it. Deploy a build without that file if the address must stay out of the public bundle.
