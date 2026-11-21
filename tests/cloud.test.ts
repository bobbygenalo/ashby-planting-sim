import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handle, type Env, type KV } from '../worker/src/api';
import { cloudClient, generateSyncKey, isSyncKey } from '../src/share/cloud';

function fakeKv(): KV {
  const m = new Map<string, string>();
  return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v), delete: async (k) => void m.delete(k) };
}
const API = 'https://api.test';
const wired = (env: Env): typeof fetch => ((url: string, init?: RequestInit) => handle(new Request(url, init), env)) as typeof fetch;
const ws = (n: number) => ({ format: 'ashby-workspace/1', n });

describe('cloud client against the worker', () => {
  it('generates keys the server accepts, and rejects short ones', () => {
    const k = generateSyncKey();
    expect(isSyncKey(k)).toBe(true);
    expect(k).toHaveLength(22);
    expect(generateSyncKey()).not.toBe(k);
    expect(isSyncKey('short')).toBe(false);
    expect(isSyncKey('has spaces in it but is long enough')).toBe(false);
  });

  it('round-trips a workspace and reports conflicts and bad keys', async () => {
    const env: Env = { PLANNER: fakeKv() };
    const key = generateSyncKey();
    const a = cloudClient(API, key, wired(env));
    expect(await a.get()).toEqual({ ok: true, value: null });
    const first = await a.put(ws(1), null);
    expect(first.ok).toBe(true);
    const got = await a.get();
    expect(got.ok && got.value?.workspace).toEqual(ws(1));
    // a second device with a stale view cannot overwrite
    const stale = await cloudClient(API, key, wired(env)).put(ws(2), null);
    expect(stale).toMatchObject({ ok: false, kind: 'conflict' });
    const next = await a.put(ws(3), first.ok ? first.value.updatedAt : null);
    expect(next.ok).toBe(true);
    expect(await cloudClient(API, 'x'.repeat(5), wired(env)).get()).toMatchObject({ ok: false, kind: 'unauthorized' });
    expect(await cloudClient(API, key, (() => Promise.reject(new Error('offline'))) as typeof fetch).get()).toMatchObject({ ok: false, kind: 'network' });
  });
});

describe('cloud sync decisions', () => {
  const store = new Map<string, string>();
  const listeners: Record<string, () => void> = {};
  let env: Env;

  beforeEach(() => {
    store.clear();
    env = { PLANNER: fakeKv() };
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE', API);
    vi.stubGlobal('window', {
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
      addEventListener: (n: string, f: () => void) => { listeners[n] = f; },
    });
    vi.stubGlobal('fetch', wired(env));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const load = async () => {
    const cs = await import('../src/store/cloudSync');
    const { appStore } = await import('../src/store/store');
    return { cs, g: () => appStore.getState() };
  };
  it('saves the first device, then a new device must choose, and choosing the cloud copy loads it', async () => {
    const { cs, g } = await load();
    g().setPaletteSpecies('salvia-clevelandii', true);
    g().addInstance('salvia-clevelandii', [38, 100]);
    cs.startCloudSync();
    expect(cs.enableCloud(null).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    const key = store.get('ashby-planner/cloud/key')!;
    const remote = await cloudClient(API, key, wired(env)).get();
    expect(remote.ok && remote.value).toBeTruthy();
    expect(store.get('ashby-planner/cloud/synced')).toBe(remote.ok && remote.value ? remote.value.updatedAt : '');
    expect(store.get('ashby-planner/cloud/dirty')).toBeUndefined();

    // A second browser with the same key and different work is asked, not overwritten.
    vi.resetModules();
    store.clear();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }, addEventListener: () => {} });
    const second = await load();
    second.g().setPaletteSpecies('lomandra-longifolia', true);
    second.g().addInstance('lomandra-longifolia', [30, 90]);
    second.cs.startCloudSync();
    expect(second.cs.enableCloud(key).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(store.get('ashby-planner/cloud/synced')).toBeUndefined(); // nothing was overwritten or adopted yet
    const before = await cloudClient(API, key, wired(env)).get();
    await second.cs.useCloudCopy();
    expect(second.g().instances.map((i) => i.speciesId)).toEqual(['salvia-clevelandii']);
    const after = await cloudClient(API, key, wired(env)).get();
    expect(after).toEqual(before); // loading did not write back
  });

  it('gives a browser a private key on its first edit, with nothing for the visitor to do', async () => {
    const { cs, g } = await load();
    cs.startCloudSync();
    expect(store.get('ashby-planner/cloud/key')).toBeUndefined(); // looking around costs nothing
    g().setPaletteSpecies('salvia-clevelandii', true);
    g().addInstance('salvia-clevelandii', [38, 100]);
    expect(store.get('ashby-planner/cloud/key')).toHaveLength(22);
    expect(store.get('ashby-planner/cloud/dirty')).toBe('1');
    expect(cs.getSyncKey()).toBe(store.get('ashby-planner/cloud/key'));
  });

  it('saves before a share is created, so the share needs no setup', async () => {
    const { cs, g } = await load();
    g().setPaletteSpecies('salvia-clevelandii', true);
    g().addInstance('salvia-clevelandii', [38, 100]);
    cs.startCloudSync();
    const ready = await cs.ensureBackedUp();
    expect(ready).toEqual({ ok: true });
    const key = cs.getSyncKey()!;
    const { shareClient } = await import('../src/share/client');
    const made = await shareClient(`${API}/api/share`, wired(env), () => cs.getSyncKey()).create({ format: 'ashby-share/1' });
    expect(made.ok).toBe(true);
    // without a saved workspace the same call is refused
    const stranger = await shareClient(`${API}/api/share`, wired(env), () => generateSyncKey()).create({ format: 'ashby-share/1' });
    expect(stranger).toMatchObject({ ok: false, error: { kind: 'unauthorized' } });
    expect(key).toHaveLength(22);
  });

  it('stays off after the owner stops saving online, until they share or turn it back on', async () => {
    const { cs, g } = await load();
    cs.startCloudSync();
    expect(cs.enableCloud(null).ok).toBe(true);
    cs.disableCloud();
    g().setPaletteSpecies('lomandra-longifolia', true);
    g().addInstance('lomandra-longifolia', [30, 90]);
    expect(store.get('ashby-planner/cloud/key')).toBeUndefined();
    expect(await cs.ensureBackedUp()).toEqual({ ok: true });
    expect(store.get('ashby-planner/cloud/key')).toHaveLength(22);
  });

  it('refuses a key that is too short and turns off cleanly', async () => {
    const { cs } = await load();
    cs.startCloudSync();
    expect(cs.enableCloud('short')).toMatchObject({ ok: false });
    expect(store.get('ashby-planner/cloud/key')).toBeUndefined();
    expect(cs.enableCloud(null).ok).toBe(true);
    expect(store.get('ashby-planner/cloud/key')).toBeTruthy();
    cs.disableCloud();
    expect(store.get('ashby-planner/cloud/key')).toBeUndefined();
  });
});
