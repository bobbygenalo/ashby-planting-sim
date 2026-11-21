import { useSyncExternalStore } from 'react';
import { workspaceFromJson } from '../engine/scenario';
import { API_BASE, CLOUD_ENABLED } from '../share/config';
import { cloudClient, generateSyncKey, isSyncKey, type CloudErrorKind } from '../share/cloud';
import { browserStorage, WATCHED } from './persistence';
import { appStore } from './store';

export type CloudStatus = 'off' | 'idle' | 'syncing' | 'synced' | 'conflict' | 'error';
export interface CloudState {
  key: string | null;
  status: CloudStatus;
  message: string | null;
  syncedAt: string | null;
}

const KEY = 'ashby-planner/cloud/key';
const SYNCED = 'ashby-planner/cloud/synced';
const DIRTY = 'ashby-planner/cloud/dirty';
// KV's free plan allows 1,000 writes a day, so wait for a quiet half minute rather than saving every edit.
const PUSH_DELAY_MS = 30_000;

const read = (k: string) => {
  try {
    return browserStorage()?.getItem(k) ?? null;
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    const s = browserStorage();
    if (!s) return;
    if (v === null) s.removeItem(k);
    else s.setItem(k, v);
  } catch {
    /* storage blocked: sync still works for this session */
  }
};

let state: CloudState = { key: null, status: 'off', message: null, syncedAt: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<CloudState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

const MESSAGES: Record<CloudErrorKind, string> = {
  conflict: 'The cloud copy changed on another device.',
  unauthorized: 'The cloud did not accept this sync key.',
  'too-large': 'Your scenarios are too large to back up (over 4 MB).',
  invalid: 'The cloud did not accept this workspace.',
  network: 'Could not reach the cloud. Changes are kept in this browser and will sync when it is back.',
  server: 'The cloud had a problem. Try again in a moment.',
};

let applying = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let started = false;

const client = () => (state.key ? cloudClient(API_BASE, state.key) : null);

async function push(): Promise<void> {
  const c = client();
  if (!c || state.status === 'conflict') return;
  set({ status: 'syncing', message: null });
  const r = await c.put(appStore.getState().toWorkspace(), read(SYNCED));
  if (r.ok) {
    write(SYNCED, r.value.updatedAt);
    write(DIRTY, null);
    set({ status: 'synced', syncedAt: r.value.updatedAt, message: null });
  } else if (r.kind === 'conflict') {
    set({ status: 'conflict', message: MESSAGES.conflict });
  } else {
    set({ status: 'error', message: MESSAGES[r.kind] });
  }
}

function applyRemote(workspace: unknown, updatedAt: string): boolean {
  const ws = workspaceFromJson(workspace);
  if (!ws) {
    set({ status: 'error', message: 'The cloud copy could not be read.' });
    return false;
  }
  applying = true;
  try {
    appStore.getState().hydrateWorkspace(ws);
  } finally {
    applying = false;
  }
  write(SYNCED, updatedAt);
  write(DIRTY, null);
  set({ status: 'synced', syncedAt: updatedAt, message: null });
  return true;
}

/** Look at the cloud copy and decide: nothing to do, load it, save to it, or ask the owner. */
async function reconcile(): Promise<void> {
  const c = client();
  if (!c) return;
  set({ status: 'syncing', message: null });
  const r = await c.get();
  if (!r.ok) return set({ status: 'error', message: MESSAGES[r.kind] });
  const dirty = read(DIRTY) === '1';
  if (!r.value) return void (await push());
  if (r.value.updatedAt === read(SYNCED)) return dirty ? void (await push()) : set({ status: 'synced', syncedAt: r.value.updatedAt });
  // The cloud copy is newer than the last one this browser saw.
  if (!dirty && read(SYNCED)) return void applyRemote(r.value.workspace, r.value.updatedAt);
  set({ status: 'conflict', message: read(SYNCED) ? MESSAGES.conflict : 'There are scenarios in the cloud and different ones in this browser.' });
}

/** Begin syncing for the owner's browser: watch changes and reconcile once. Safe to call more than once. */
export function startCloudSync(): void {
  if (!CLOUD_ENABLED || started || appStore.getState().mode !== 'edit') return;
  started = true;
  const key = read(KEY);
  if (key && isSyncKey(key)) {
    set({ key, status: 'idle' });
    void reconcile();
  }
  appStore.subscribe((s, prev) => {
    if (applying || !state.key || !WATCHED.some((k) => s[k] !== prev[k])) return;
    write(DIRTY, '1');
    if (state.status === 'conflict') return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void push(), PUSH_DELAY_MS);
  });
  window.addEventListener('online', () => {
    if (state.key && state.status === 'error') void reconcile();
  });
}

/** Turn backup on with a new key (null) or one copied from another device. */
export function enableCloud(key: string | null): { ok: true } | { ok: false; message: string } {
  const k = key === null ? generateSyncKey() : key.trim();
  if (!isSyncKey(k)) return { ok: false, message: 'A sync key is 22 or more letters, numbers, dashes or underscores.' };
  write(KEY, k);
  write(SYNCED, null);
  write(DIRTY, '1');
  set({ key: k, status: 'idle', message: null, syncedAt: null });
  void reconcile();
  return { ok: true };
}

export function disableCloud(): void {
  if (timer) clearTimeout(timer);
  write(KEY, null);
  write(SYNCED, null);
  write(DIRTY, null);
  set({ key: null, status: 'off', message: null, syncedAt: null });
}

/** The key this browser backs up with, or null when backup is off. */
export const getSyncKey = (): string | null => state.key;

export const syncNow = () => (state.status === 'conflict' ? Promise.resolve() : push());

/** Conflict: replace this browser's scenarios with the cloud copy. */
export async function useCloudCopy(): Promise<void> {
  const c = client();
  if (!c) return;
  const r = await c.get();
  if (!r.ok) return set({ status: 'error', message: MESSAGES[r.kind] });
  if (!r.value) return void (set({ status: 'idle' }), await push());
  applyRemote(r.value.workspace, r.value.updatedAt);
}

/** Conflict: keep this browser's scenarios and overwrite the cloud copy. */
export async function keepThisBrowser(): Promise<void> {
  const c = client();
  if (!c) return;
  const r = await c.get();
  if (!r.ok) return set({ status: 'error', message: MESSAGES[r.kind] });
  write(SYNCED, r.value?.updatedAt ?? null);
  set({ status: 'idle', message: null });
  await push();
}

export function useCloudState(): CloudState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
