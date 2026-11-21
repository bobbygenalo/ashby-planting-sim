import type { StoreApi } from 'zustand';
import { parseShareSnapshot, type ShareRecord } from '../engine/scenario';
import type { AppState } from '../store/store';
import type { shareClient, ShareError } from './client';

type Client = ReturnType<typeof shareClient>;
type Store = StoreApi<AppState>;

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: ShareError };

/** Publish the scenario as a new read-only link and remember its owner key in this browser (SH-1, SH-2). */
export async function publishShare(store: Store, client: Client, scenarioId: string, hideAddress: boolean): Promise<Outcome<ShareRecord>> {
  const s = store.getState();
  if (s.mode !== 'edit') return { ok: false, error: { kind: 'forbidden', message: 'Only the owner can share a plan.' } };
  const snapshot = s.buildSnapshot(scenarioId, hideAddress);
  if (!snapshot) return { ok: false, error: { kind: 'invalid', message: 'That scenario no longer exists.' } };
  const made = await client.create(snapshot);
  if (!made.ok) return made;
  const now = new Date().toISOString();
  const record: ShareRecord = { scenarioId, token: made.value.token, revokeKey: made.value.revokeKey, createdAt: now, updatedAt: now, hideAddress, revoked: false };
  store.getState().addShare(record);
  return { ok: true, value: record };
}

/** Replace what the link shows with the scenario as it is now. The link itself does not change. */
export async function republishShare(store: Store, client: Client, token: string): Promise<Outcome<ShareRecord>> {
  const rec = store.getState().shares.find((r) => r.token === token);
  if (!rec || rec.revoked) return { ok: false, error: { kind: 'revoked', message: 'This link has been turned off.' } };
  const snapshot = store.getState().buildSnapshot(rec.scenarioId, rec.hideAddress);
  if (!snapshot) return { ok: false, error: { kind: 'invalid', message: 'That scenario no longer exists.' } };
  const r = await client.update(token, rec.revokeKey, snapshot);
  if (!r.ok) {
    if (r.error.kind === 'revoked') store.getState().patchShare(token, { revoked: true });
    return r;
  }
  const updatedAt = new Date().toISOString();
  store.getState().patchShare(token, { updatedAt });
  return { ok: true, value: { ...rec, updatedAt } };
}

/** Turn a link off for good (SH-2). A link the server no longer knows is treated as already off. */
export async function revokeShare(store: Store, client: Client, token: string): Promise<Outcome<true>> {
  const rec = store.getState().shares.find((r) => r.token === token);
  if (!rec) return { ok: false, error: { kind: 'not-found', message: 'This browser does not have that link.' } };
  const r = await client.revoke(token, rec.revokeKey);
  if (r.ok || r.error.kind === 'not-found') {
    store.getState().patchShare(token, { revoked: true });
    return { ok: true, value: true };
  }
  return r;
}

export type LoadOutcome = { status: 'ready'; warnings: string[] } | { status: 'revoked' | 'not-found' | 'invalid' | 'network' | 'error'; message: string };

/** Viewer: fetch a shared plan, check it, and show it. Nothing is trusted from the server until it has been validated. */
export async function loadSharedPlan(store: Store, client: Client, token: string): Promise<LoadOutcome> {
  const got = await client.fetch(token);
  if (!got.ok) {
    const k = got.error.kind;
    return { status: k === 'revoked' || k === 'not-found' || k === 'network' ? k : 'error', message: got.error.message };
  }
  const s = store.getState();
  const parsed = parseShareSnapshot(got.value, {
    speciesIds: new Set(s.library.species.map((x) => x.id)), containers: new Set(Object.keys(s.engine.growth.containers)),
    hardscapeTypes: new Set(Object.keys(s.engine.hardscape.types)), materialIds: new Set(s.materials.map((m) => m.id)), zoneIds: new Set(s.site.zones.map((z) => z.id)),
  });
  if (!parsed.ok) return { status: 'invalid', message: parsed.errors[0] };
  store.getState().loadShared(parsed.snapshot);
  return { status: 'ready', warnings: parsed.warnings };
}
