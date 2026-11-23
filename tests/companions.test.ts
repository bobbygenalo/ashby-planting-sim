import { beforeAll, describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import siteRaw from '../src/data/site.json';
import speciesRaw from '../src/data/species.json';
import materialsRaw from '../src/data/materials.json';
import { castsShade, compatible, contrasts, hsl, pairNeed } from '../src/engine/companions';
import { generateConcept } from '../src/engine/concept';
import { buildSunMap, type SunMap } from '../src/engine/placement';
import { emptyScenarioData } from '../src/engine/scenario';
import { mulberry32 } from '../src/engine/shuffle';
import { activeStructures, loadSite } from '../src/engine/site';
import type { EngineConfig, Material, Species, SpeciesLibrary } from '../src/engine/types';

const engine = engineRaw as unknown as EngineConfig;
const pc = engine.concept.plants;
const lib = speciesRaw as unknown as SpeciesLibrary;
const sp = (id: string): Species => lib.species.find((s) => s.id === id)!;
const need = (a: Species, b: Species, withCompanions = true) => pairNeed(a, b, pc.overlapAllowance, withCompanions ? pc.companions : undefined);
const R = (s: Species) => s.matureWidth / 2;
const site = loadSite(siteRaw);

describe('which plants may stand close', () => {
  it('keeps crowns just touching by default, groundcovers too, so nothing stands under anything else', () => {
    const a = sp('salvia-clevelandii'), b = sp('muhlenbergia-rigens');
    expect(need(a, b, false)).toEqual({ need: pc.overlapAllowance * (R(a) + R(b)), kind: 'apart' });
    const gc = sp('achillea-millefolium'), shrub = sp('ceanothus-concha');
    const r = need(gc, shrub, false);
    expect(r.kind).toBe('apart');
    expect(r.need).toBeCloseTo(pc.overlapAllowance * (R(shrub) + R(gc)), 9);
    expect(need(shrub, gc, false).need).toBeCloseTo(r.need, 9);
  });

  it('lets a drift of one species interweave, but only when it is one plant repeated', () => {
    const a = sp('muhlenbergia-rigens');
    const d = need(a, a);
    expect(d.kind).toBe('drift');
    expect(d.need).toBeCloseTo(pc.companions.driftSpacing * 2 * R(a), 9);
    expect(d.need).toBeLessThan(2 * R(a));
  });

  it('lets a shade-loving plant stand in the shade of a tree, but not a sun lover, and never at the trunk', () => {
    // a tree (or big shrub) and a shade-tolerant plant that shares its watering and is well under its height
    const casters = lib.species.filter((s) => castsShade(s, pc.companions));
    const found = casters.flatMap((t) => lib.species.filter((s) => s.id !== t.id && s.sun !== 'full' && compatible(t, s) && t.matureHeight >= pc.companions.layerHeightRatio * s.matureHeight).map((s) => [t, s] as const))[0];
    expect(found, 'some tree has a shade-tolerant companion that waters like it').toBeTruthy();
    const [tree, low] = found;
    const r = need(tree, low);
    expect(r.kind).toBe('layered');
    expect(r.need).toBeCloseTo(R(tree) * pc.companions.coreFraction, 9);
    expect(r.need).toBeLessThan(pc.overlapAllowance * (R(tree) + R(low)));
    // a sun lover that shares its watering is kept out from under the crown
    const sunny = lib.species.find((s) => s.sun === 'full' && compatible(tree, s) && tree.matureHeight >= pc.companions.layerHeightRatio * s.matureHeight)!;
    if (sunny) expect(need(tree, sunny).kind).not.toBe('layered');
  });

  it('keeps a small plant out from under a low shrub that gives it no shade to like', () => {
    const sage = sp('salvia-clevelandii'), fescue = sp('festuca-glauca');
    expect(castsShade(sage, pc.companions)).toBe(false);
    expect(need(sage, fescue)).toEqual({ need: pc.overlapAllowance * (R(sage) + R(fescue)), kind: 'apart' });
  });

  it('allows nothing closer between plants that want different watering or light', () => {
    const wet = lib.species.find((s) => s.wucols === 'moderate')!, dry = lib.species.find((s) => s.wucols === 'low')!;
    expect(compatible(wet, dry)).toBe(false);
    expect(need(wet, dry).kind).toBe('apart');
    expect(need(dry, dry === wet ? dry : dry).kind).toBe('drift'); // the same plant with itself is fine
  });

  it('never lets any pair stand at a trunk, and never reaches nothing', () => {
    for (const a of lib.species) for (const b of lib.species) {
      const r = need(a, b);
      const tall = a.matureHeight >= b.matureHeight ? a : b;
      expect(r.need, `${a.common} / ${b.common}`).toBeGreaterThan(0);
      expect(r.need, `${a.common} / ${b.common}`).toBeGreaterThanOrEqual(Math.min(R(tall) * pc.companions.coreFraction, r.need) - 1e-9);
      if (a.id !== b.id) expect(r.need).toBeGreaterThanOrEqual(Math.min(pc.companions.coreFraction * R(tall), pc.companions.contrastSpacing * (R(a) + R(b))) - 1e-9);
    }
  });

  it('calls a clear difference of foliage or bloom a contrast', () => {
    expect(hsl('#ffffff')[2]).toBeCloseTo(1, 6);
    expect(hsl('#ff0000')[0]).toBeCloseTo(0, 6);
    const dark = { foliageColor: '#2a4a2a', bloomColor: '#ff0000', bloomMonths: [5] } as Species;
    const pale = { foliageColor: '#cfdccb', bloomColor: '#ff1010', bloomMonths: [5] } as Species;
    const same = { foliageColor: '#2c4c2c', bloomColor: '#ff1111', bloomMonths: [5] } as Species;
    expect(contrasts(dark, pale, pc.companions)).toBe(true); // silver against dark green
    expect(contrasts(dark, same, pc.companions)).toBe(false);
    const blue = { ...same, bloomColor: '#0000ff' } as Species;
    expect(contrasts(dark, blue, pc.companions)).toBe(true); // red against blue, blooming together
    expect(contrasts(dark, { ...blue, bloomMonths: [11] } as Species, pc.companions)).toBe(false); // not at the same time
  });
});

describe('concepts build their closeness on purpose', () => {
  let sunMap: SunMap;
  beforeAll(() => { sunMap = buildSunMap(site, true, engine); }, 60000);
  const ctx = () => ({ site, structures: activeStructures(site, { aduEnabled: true }), species: lib.species, materials: materialsRaw as unknown as Material[], engine, palette: emptyScenarioData(site).palette, sunMap });

  it('makes drifts and understory, and every close pair is one of them', () => {
    let drifts = 0, layered = 0, contrast = 0, pairs = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const r = generateConcept(ctx(), { hardscape: true, plants: true, starredOnly: false }, mulberry32(seed));
      expect(r.counts.plants).toBeLessThanOrEqual(pc.maxTotal);
      const ps = r.data.instances.map((i) => ({ i, s: sp(i.speciesId) }));
      for (let a = 0; a < ps.length; a++) for (let b = a + 1; b < ps.length; b++) {
        const d = Math.hypot(ps[a].i.position[0] - ps[b].i.position[0], ps[a].i.position[1] - ps[b].i.position[1]);
        const apart = pc.overlapAllowance * (R(ps[a].s) + R(ps[b].s));
        if (d >= apart - 1e-6) continue;
        pairs++;
        const kind = need(ps[a].s, ps[b].s).kind;
        expect(kind, `${ps[a].s.common} close to ${ps[b].s.common}, ${d.toFixed(1)} ft apart`).not.toBe('apart');
        if (kind === 'drift') drifts++; else if (kind === 'layered') layered++; else contrast++;
      }
    }
    expect(drifts).toBeGreaterThan(5);
    expect(layered).toBeGreaterThan(0);
    expect(pairs).toBe(drifts + layered + contrast);
  });

  it('gives fruit trees clear ground, and puts no plant under another that does not shade it', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const r = generateConcept(ctx(), { hardscape: true, plants: true, starredOnly: false }, mulberry32(seed));
      const ps = r.data.instances.map((i) => ({ i, s: sp(i.speciesId) }));
      for (const t of ps.filter((x) => x.s.fruit)) for (const o of ps) {
        if (o === t) continue;
        const d = Math.hypot(t.i.position[0] - o.i.position[0], t.i.position[1] - o.i.position[1]);
        // nothing of a different kind stands under a fruit tree's crown
        if (o.s.id !== t.s.id && o.s.matureHeight < t.s.matureHeight) expect(d, `${o.s.common} under ${t.s.common}`).toBeGreaterThanOrEqual(Math.min(R(t.s), R(t.s) * 0.99));
      }
    }
  });
});
