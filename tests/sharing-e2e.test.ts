import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shareMiddleware } from '../server/shareMiddleware';
import { fileShareStore } from '../server/shareStore';
import engineRaw from '../src/data/engine.json';
import speciesRaw from '../src/data/species.json';
import { placedPlants } from '../src/engine/growth';
import { shareClient } from '../src/share/client';
import { loadSharedPlan, publishShare, republishShare, revokeShare } from '../src/share/service';
import { makeAppStore } from '../src/store/store';
import type { EngineConfig, SpeciesLibrary } from '../src/engine/types';

const engine = engineRaw as unknown as EngineConfig;
const lib = speciesRaw as unknown as SpeciesLibrary;
let dir: string;
let server: Server;
let client: ReturnType<typeof shareClient>;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ashby-e2e-'));
  const handler = shareMiddleware(fileShareStore(dir));
  server = createServer((req, res) => void handler(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  client = shareClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/share`);
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
});

/** The owner's plan: plants, a patio, a hydrozone, soil results, and a custom species. */
function ownerStore() {
  const owner = makeAppStore('edit');
  const g = () => owner.getState();
  g().setPaletteSpecies('salvia-clevelandii', true);
  g().setPaletteSpecies('cercis-occidentalis', true);
  g().addInstance('salvia-clevelandii', [38, 100]);
  g().addInstance('cercis-occidentalis', [28, 110], { container: '15gal' });
  g().startDrawing('patio');
  [[30, 70], [40, 70], [40, 82], [30, 82]].forEach((p) => g().addDrawPoint(p as [number, number]));
  g().finishDrawing();
  g().addHydrozone('Back beds', 'drip');
  g().setSoilProfile('back_yard', { texture: 'clay', drainageInHr: 0.3 });
  g().setPlayZone('front_yard', true);
  g().setTimelineMonth(36);
  return owner;
}

describe('M7 acceptance: a second viewer can view and simulate but cannot change the plan', () => {
  it('shows the same plan to a viewer who has no login and none of the owner\'s browser storage', async () => {
    const owner = ownerStore();
    const shared = await publishShare(owner, client, owner.getState().activeScenarioId, false);
    expect(shared.ok).toBe(true);
    if (!shared.ok) return;

    const viewer = makeAppStore('view'); // a separate store: nothing is shared with the owner but the link
    const loaded = await loadSharedPlan(viewer, client, shared.value.token);
    expect(loaded.status).toBe('ready');
    const v = viewer.getState(), o = owner.getState();
    expect(v.mode).toBe('view');
    expect(v.instances).toEqual(o.instances);
    expect(v.palette).toEqual(o.palette);
    expect(v.hardscape).toEqual(o.hardscape);
    expect(v.hydrozones).toEqual(o.hydrozones);
    expect(v.soilProfiles.back_yard).toMatchObject({ texture: 'clay', drainageInHr: 0.3 });
    expect(v.playZones).toEqual({ front_yard: true });
    expect(v.timelineMonth).toBe(36);
    expect(v.shared?.name).toBe('Scenario 1');
    expect(v.shares).toEqual([]); // the owner's keys never reach the viewer
  });

  it('lets the viewer orbit, scrub time and date, toggle layers, and inspect plants, and simulation responds', async () => {
    const owner = ownerStore();
    const shared = await publishShare(owner, client, owner.getState().activeScenarioId, false);
    if (!shared.ok) throw new Error('publish failed');
    const viewer = makeAppStore('view');
    await loadSharedPlan(viewer, client, shared.value.token);
    const g = () => viewer.getState();
    g().setView('plan');
    g().setTimelineMonth(0);
    g().setDoy(355);
    g().setMinutes(9 * 60);
    g().setLayer('sunHours', false);
    g().setSunPeriod('summer');
    g().select(g().instances[0].id);
    expect(g().view).toBe('plan');
    expect(g().doy).toBe(355);
    expect(g().layers.sunHours).toBe(false);
    expect(g().selectedId).toBe(g().instances[0].id);
    // Growth simulation runs in the viewer: the tree is bigger at year 10 than at planting.
    const size = (month: number) => placedPlants(g().instances, g().palette, g().library.species, month, engine.growth).find((p) => p.species.id === 'cercis-occidentalis')!.size.height;
    expect(size(120)).toBeGreaterThan(size(0) + 3);
  });

  it('refuses every change to the plan at the store, not just in the interface', async () => {
    const owner = ownerStore();
    const shared = await publishShare(owner, client, owner.getState().activeScenarioId, false);
    if (!shared.ok) throw new Error('publish failed');
    const viewer = makeAppStore('view');
    await loadSharedPlan(viewer, client, shared.value.token);
    const g = () => viewer.getState();
    const before = JSON.stringify({ i: g().instances, p: g().palette, h: g().hardscape, z: g().hydrozones, s: g().soilProfiles, pl: g().playZones, sc: g().scenarios, rain: g().useRain, adu: g().aduEnabled, lib: g().library.species.length });
    const first = g().instances[0].id;
    // Plants
    expect(g().addInstance('salvia-clevelandii', [10, 10])).toBeNull();
    g().updateInstance(first, { position: [1, 1] });
    g().duplicateInstance(first);
    g().deleteInstance(first);
    g().setPaletteSpecies('salvia-clevelandii', false);
    g().addSpecies({ ...lib.species[0], id: 'sneaky' });
    // Hardscape
    g().startDrawing('patio');
    [[1, 1], [5, 1], [5, 5]].forEach((p) => g().addDrawPoint(p as [number, number]));
    expect(g().finishDrawing()).toBeNull();
    g().deleteElement(g().hardscape[0].id);
    g().updateElement(g().hardscape[0].id, { height: 9 });
    g().moveElementBy(g().hardscape[0].id, 5, 5);
    // Water, soil, settings
    expect(g().addHydrozone('Hacked', 'none')).toBeNull();
    g().setUseRain(true);
    g().setAutoIrrigation('auto:low', 'none');
    g().setSoilProfile('back_yard', { ph: 4 });
    g().setPlayZone('back_yard', true);
    g().setAduEnabled(false);
    // Scenarios and history
    expect(g().createScenario('Mine')).toBeNull();
    expect(g().deleteScenario('shared')).toBe(false);
    g().renameScenario('shared', 'Renamed');
    expect(g().importScenarioFile('{}')).toEqual({ ok: false, errors: ['A shared view cannot import scenarios.'] });
    g().undo();
    g().redo();
    g().hydrateWorkspace(owner.getState().toWorkspace());
    g().addShare({ scenarioId: 'x', token: 't', revokeKey: 'k', createdAt: '', updatedAt: '', blurLocation: false, revoked: false });
    const after = JSON.stringify({ i: g().instances, p: g().palette, h: g().hardscape, z: g().hydrozones, s: g().soilProfiles, pl: g().playZones, sc: g().scenarios, rain: g().useRain, adu: g().aduEnabled, lib: g().library.species.length });
    expect(after).toBe(before);
    expect(g().shares).toEqual([]);
  });

  it('M7 acceptance: revoking the link blocks access for the viewer', async () => {
    const owner = ownerStore();
    const shared = await publishShare(owner, client, owner.getState().activeScenarioId, false);
    if (!shared.ok) throw new Error('publish failed');
    const { token } = shared.value;
    const viewerA = makeAppStore('view');
    expect((await loadSharedPlan(viewerA, client, token)).status).toBe('ready');

    expect(await revokeShare(owner, client, token)).toEqual({ ok: true, value: true });
    expect(owner.getState().shares.find((s) => s.token === token)?.revoked).toBe(true);

    const viewerB = makeAppStore('view');
    const blocked = await loadSharedPlan(viewerB, client, token);
    expect(blocked.status).toBe('revoked');
    expect(viewerB.getState().instances).toEqual([]); // nothing of the plan reached this viewer
    expect(viewerB.getState().shared).toBeNull();
    // The owner cannot republish a revoked link.
    const again = await republishShare(owner, client, token);
    expect(again.ok).toBe(false);
  });
});

describe('sharing details', () => {
  it('updating a link shows the viewer the new plan at the same link', async () => {
    const owner = ownerStore();
    const shared = await publishShare(owner, client, owner.getState().activeScenarioId, false);
    if (!shared.ok) throw new Error('publish failed');
    const { token } = shared.value;
    owner.getState().addInstance('salvia-clevelandii', [44, 92]);
    const v1 = makeAppStore('view');
    await loadSharedPlan(v1, client, token);
    expect(v1.getState().instances.length).toBe(2); // the plan as first shared
    expect((await republishShare(owner, client, token)).ok).toBe(true);
    const v2 = makeAppStore('view');
    await loadSharedPlan(v2, client, token);
    expect(v2.getState().instances.length).toBe(3);
  });

  it('shares one scenario per link, not the whole workspace', async () => {
    const owner = ownerStore();
    const a = owner.getState().activeScenarioId;
    const b = owner.getState().createScenario('Other idea')!;
    owner.getState().addInstance('salvia-clevelandii', [20, 120]);
    const shared = await publishShare(owner, client, a, false); // a is now parked in `saved`
    if (!shared.ok) throw new Error('publish failed');
    const viewer = makeAppStore('view');
    await loadSharedPlan(viewer, client, shared.value.token);
    expect(viewer.getState().shared?.name).toBe('Scenario 1');
    expect(viewer.getState().instances.length).toBe(2);
    expect(viewer.getState().scenarios.length).toBe(1);
    expect(b).not.toBe(a);
  });

  it('blurs the location in what the viewer receives, and the sun still works', async () => {
    const owner = ownerStore();
    const shared = await publishShare(owner, client, owner.getState().activeScenarioId, true);
    if (!shared.ok) throw new Error('publish failed');
    expect(shared.value.blurLocation).toBe(true);
    const viewer = makeAppStore('view');
    await loadSharedPlan(viewer, client, shared.value.token);
    expect(viewer.getState().site.name).toBe('Shared lot');
    expect(viewer.getState().shared?.blurLocation).toBe(true);
    expect(JSON.stringify(viewer.getState().site)).not.toContain('Ashby');
    expect(viewer.getState().site.lot).toEqual(owner.getState().site.lot);
    expect(owner.getState().site.name).toBe('Ashby Planting Sim'); // the owner's own copy is untouched
  });

  it('keeps the owner key in the owner\'s workspace and out of the shared plan', async () => {
    const owner = ownerStore();
    const shared = await publishShare(owner, client, owner.getState().activeScenarioId, false);
    if (!shared.ok) throw new Error('publish failed');
    const snap = JSON.stringify(owner.getState().buildSnapshot(owner.getState().activeScenarioId, false));
    expect(snap).not.toContain(shared.value.revokeKey);
    expect(JSON.stringify(owner.getState().toWorkspace())).toContain(shared.value.revokeKey);
  });

  it('shows a clear result for a link that never existed, and for a damaged plan', async () => {
    const viewer = makeAppStore('view');
    expect((await loadSharedPlan(viewer, client, 'AAAAAAAAAAAAAAAAAAAAAA')).status).toBe('not-found');
    // A server that returns garbage must not crash or change the viewer.
    const liar = shareClient('http://x.test/api/share', (async () => new Response(JSON.stringify({ snapshot: { format: 'ashby-share/1', name: 'x' } }), { status: 200 })) as typeof fetch);
    const r = await loadSharedPlan(viewer, liar, 'AAAAAAAAAAAAAAAAAAAAAA');
    expect(r.status).toBe('invalid');
    expect(viewer.getState().shared).toBeNull();
    const offline = shareClient('http://127.0.0.1:1/api/share');
    expect((await loadSharedPlan(viewer, offline, 'AAAAAAAAAAAAAAAAAAAAAA')).status).toBe('network');
  });

  it('only the owner can publish', async () => {
    const viewer = makeAppStore('view');
    const r = await publishShare(viewer, client, 'x', false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('forbidden');
  });

  it('treats a link the server has forgotten as already off when revoking', async () => {
    const owner = ownerStore();
    owner.getState().addShare({ scenarioId: owner.getState().activeScenarioId, token: 'BBBBBBBBBBBBBBBBBBBBBB', revokeKey: 'k', createdAt: '', updatedAt: '', blurLocation: false, revoked: false });
    expect((await revokeShare(owner, client, 'BBBBBBBBBBBBBBBBBBBBBB')).ok).toBe(true);
    expect(owner.getState().shares.at(-1)?.revoked).toBe(true);
  });
});
