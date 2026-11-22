import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import engineRaw from '../src/data/engine.json';
import materialsRaw from '../src/data/materials.json';
import speciesRaw from '../src/data/species.json';
import { butterflyCount, butterflyFlowers, CritterSim, hummerCount, wormCount, wormUpChance } from '../src/engine/critters';
import { pointInPolygon } from '../src/engine/geometry';
import { instanceSize, type PlacedPlant } from '../src/engine/growth';
import { buildLifeWorld, type LifeWorldInput } from '../src/engine/life';
import type { SunMap } from '../src/engine/placement';
import { activeStructures, loadSite } from '../src/engine/site';
import type { EngineConfig, HardscapeElement, Material, PlantInstance, SpeciesLibrary } from '../src/engine/types';

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;
const cfg = engine.life.critters;
const mats = materialsRaw as unknown as Material[];
const lib = speciesRaw as unknown as SpeciesLibrary;
const structures = activeStructures(site, { aduEnabled: true });

const placed = (list: [string, number, number][]): PlacedPlant[] =>
  list.map(([speciesId, x, y], i) => {
    const inst: PlantInstance = { id: `p${i}`, speciesId, position: [x, y], plantedMonth: 0, container: '5gal', existing: false };
    const species = lib.species.find((s) => s.id === speciesId)!;
    return { inst, species, size: instanceSize(inst, species, 96, engine.growth) };
  });
/** A sun map that is `sunny` hours everywhere except the west side (x under 25), which gets `shady`. */
const sunMap = (sunny: number, shady: number): SunMap => {
  const nx = Math.ceil(site.lot.width), ny = Math.ceil(site.lot.depth);
  const hours = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) hours[j * nx + i] = i + 0.5 < 25 ? shady : sunny;
  return { nx, ny, cellSize: 1, hours, mask: new Uint8Array(nx * ny).fill(1) };
};
const el = (type: HardscapeElement['type'], points: [number, number][], materialId: string, id: string): HardscapeElement => ({ id, type, points, materialId, height: 0, depthIn: 3, width: 0, existing: false });
const PATIO = el('patio', [[34, 70], [44, 70], [44, 80], [34, 80]], 'concrete', 'pt');
const world = (plants: PlacedPlant[], month: number, sun?: SunMap, hardscape: HardscapeElement[] = [...(site.hardscape as HardscapeElement[]), PATIO]) =>
  buildLifeWorld({ site, structures, hardscape, materials: mats, plants, month, engine, sunMap: sun } as LifeWorldInput);

const HUMM = (n: number) => placed(Array.from({ length: n }, (_, i): [string, number, number] => ['penstemon-margarita-bop', 30 + i * 3, 100]));
const BUTTER = (n: number, x = 38) => placed(Array.from({ length: n }, (_, i): [string, number, number] => ['verbena-lilacina', x + i * 2.5, 95]));

describe('what the world offers the visitors', () => {
  it('lists the plants in bloom with the visitors they draw and the sun they get, and the tops of the taller ones to perch on', () => {
    const w = world([...HUMM(1), ...BUTTER(1), ...placed([['asclepias-fascicularis', 40, 110]])], 6, sunMap(8, 2));
    expect(w.flowers.length).toBe(3);
    const bf = w.flowers.find((f) => f.groups.includes('butterflies') && !f.groups.includes('hummingbirds'))!;
    expect(bf.sun).toBe(8);
    expect(world(HUMM(1), 6, sunMap(8, 2)).flowers[0].sun).toBe(8);
    expect(world(placed([['penstemon-margarita-bop', 10, 100]]), 6, sunMap(8, 2)).flowers[0].sun).toBe(2); // the shady side
    expect(world(HUMM(1), 6).flowers[0].sun).toBeNull(); // no sun map: unknown
    // out of bloom, nothing to visit
    expect(world(HUMM(2), 12, sunMap(8, 2)).flowers).toHaveLength(0);
    const tall = world(placed([['arctostaphylos-howard-mcminn', 38, 100]]), 2);
    expect(tall.perches.length).toBe(1);
    expect(tall.perches[0].z).toBeGreaterThan(3);
  });
});

describe('hummingbirds', () => {
  const day = { minutes: 13 * 60, night: false };

  it('visit while hummingbird flowers bloom, in the daytime, more of them with more flowers up to the most', () => {
    expect(hummerCount(world(HUMM(1), 5), day, cfg.hummer)).toBe(1);
    expect(hummerCount(world(HUMM(3), 5), day, cfg.hummer)).toBe(2);
    expect(hummerCount(world(HUMM(8), 5), day, cfg.hummer)).toBe(cfg.hummer.max);
  });

  it('are gone at night and in the early hours, and when nothing they like is in bloom or planted', () => {
    const w = world(HUMM(6), 5);
    expect(hummerCount(w, { minutes: 3 * 60, night: true }, cfg.hummer)).toBe(0);
    expect(hummerCount(w, { minutes: 5 * 60, night: false }, cfg.hummer)).toBe(0); // before six
    expect(hummerCount(w, { minutes: 19 * 60, night: false }, cfg.hummer)).toBe(0); // after seven
    expect(hummerCount(w, { minutes: 13 * 60, night: true }, cfg.hummer)).toBe(0);
    expect(hummerCount(world(HUMM(6), 12), day, cfg.hummer)).toBe(0); // out of bloom
    expect(hummerCount(world(BUTTER(6), 6), day, cfg.hummer)).toBe(0); // butterflies' flowers, not theirs
    expect(hummerCount(world([], 6), day, cfg.hummer)).toBe(0);
  });

  it('like a flower in the shade as well as one in the sun', () => {
    const w = world(placed([['salvia-spathacea', 10, 100]]), 4, sunMap(8, 1.5));
    expect(w.flowers[0].sun).toBeLessThan(2);
    expect(hummerCount(w, day, cfg.hummer)).toBe(1);
  });

  it('come to hover at the flowers, bob there, and fade out when it gets dark', () => {
    const w = world(HUMM(4), 5);
    const sim = new CritterSim(w, cfg, 5);
    sim.setClock({ minutes: 13 * 60, night: false });
    let fed = 0;
    for (let t = 0; t < 120; t += 0.1) {
      sim.step(0.1);
      for (const h of sim.hummers) {
        if (h.state !== 'feed') continue;
        fed++;
        expect(w.flowers.some((f) => Math.hypot(f.x - h.target!.x, f.y - h.target!.y) <= f.radius)).toBe(true);
        expect(Math.hypot(h.x - h.target!.x, h.y - h.target!.y)).toBeLessThan(0.2);
      }
    }
    expect(fed).toBeGreaterThan(30);
    expect(sim.hummers.filter((h) => h.vis > 0.99).length).toBe(2);
    sim.setClock({ minutes: 21 * 60, night: false });
    for (let t = 0; t < cfg.hummer.fadeS + 1; t += 0.1) sim.step(0.1);
    expect(sim.hummers.every((h) => h.vis === 0)).toBe(true);
  });
});

describe('butterflies', () => {
  const noon = { minutes: 12 * 60, night: false };

  it('are about in the warm months, in the warm part of the day, over flowers they visit', () => {
    expect(butterflyCount(world(BUTTER(3), 6), noon, cfg.butterfly)).toBeGreaterThan(0);
    for (const m of [12, 1, 2]) expect(butterflyCount(world(BUTTER(3), m), noon, cfg.butterfly), `month ${m}`).toBe(0);
    expect(butterflyCount(world(BUTTER(3), 6), { minutes: 8 * 60, night: false }, cfg.butterfly)).toBe(0);
    expect(butterflyCount(world(BUTTER(3), 6), { minutes: 17 * 60, night: false }, cfg.butterfly)).toBe(0);
    expect(butterflyCount(world(BUTTER(3), 6), { minutes: 12 * 60, night: true }, cfg.butterfly)).toBe(0);
    expect(butterflyCount(world(HUMM(3), 6), noon, cfg.butterfly)).toBe(0); // no butterfly flowers
    expect(butterflyCount(world(BUTTER(30), 6), noon, cfg.butterfly)).toBe(cfg.butterfly.max);
  });

  it('keep to flowers in the sun and leave the shaded ones alone', () => {
    const shaded = world(BUTTER(4, 10), 6, sunMap(8, 2)); // x 10 to 17: the shady side
    expect(butterflyFlowers(shaded, cfg.butterfly)).toHaveLength(0);
    expect(butterflyCount(shaded, noon, cfg.butterfly)).toBe(0);
    const mixed = world([...BUTTER(2, 10), ...BUTTER(2, 38)], 6, sunMap(8, 2));
    expect(butterflyFlowers(mixed, cfg.butterfly)).toHaveLength(2);
    expect(butterflyFlowers(mixed, cfg.butterfly).every((f) => f.x >= 25)).toBe(true);
    // with no sun map they are not ruled out
    expect(butterflyFlowers(world(BUTTER(2, 10), 6), cfg.butterfly)).toHaveLength(2);
  });

  it('flutter between sunny flowers and settle on them for a while', () => {
    const w = world(BUTTER(3), 6, sunMap(8, 2));
    const sim = new CritterSim(w, cfg, 9);
    sim.setClock(noon);
    let landed = 0;
    for (let t = 0; t < 180; t += 0.1) {
      sim.step(0.1);
      for (const b of sim.butterflies) if (b.state === 'land') { landed++; expect(w.flowers.some((f) => Math.hypot(f.x - b.x, f.y - b.y) <= f.radius + 0.6)).toBe(true); }
    }
    expect(landed).toBeGreaterThan(20);
    expect(sim.butterflies.filter((b) => b.vis > 0.99).length).toBe(butterflyCount(w, noon, cfg.butterfly));
    sim.setClock({ minutes: 18 * 60, night: false });
    for (let t = 0; t < cfg.butterfly.fadeS + 1; t += 0.1) sim.step(0.1);
    expect(sim.butterflies.every((b) => b.vis === 0)).toBe(true);
  });
});

describe('worms', () => {
  it('are more numerous in the cool wet months than in the dry summer', () => {
    const counts = Array.from({ length: 12 }, (_, i) => wormCount(i + 1, 500, cfg.worms));
    expect(counts[0]).toBeGreaterThan(counts[6] * 3); // January against July
    expect(counts[10]).toBeGreaterThan(counts[7]);
    expect(Math.max(...counts)).toBe(cfg.worms.max);
    expect(wormCount(1, 0, cfg.worms)).toBe(0);
  });

  it('come up at night, and by day mostly in the shade', () => {
    const c = cfg.worms;
    const jan = (minutes: number, shade: boolean) => wormUpChance(1, minutes, shade, c);
    expect(jan(2 * 60, false)).toBeGreaterThan(jan(13 * 60, false) * 5); // night against a sunny afternoon
    expect(jan(13 * 60, true)).toBeGreaterThan(jan(13 * 60, false) * 3); // shade against sun, by day
    expect(jan(23 * 60, true)).toBe(1);
    expect(wormUpChance(7, 13 * 60, false, c)).toBeLessThan(jan(13 * 60, false)); // July is worse than January
    expect(wormUpChance(7, 13 * 60, true, c)).toBeLessThan(0.15);
  });

  it('live in soil, mulch and beds, never under paving, a building or a raised bed', () => {
    const els: HardscapeElement[] = [...(site.hardscape as HardscapeElement[]), PATIO, el('raisedBed', [[20, 120], [24, 120], [24, 130], [20, 130]], 'raised-bed-wood', 'rb'), el('bed', [[26, 86], [32, 86], [32, 92], [26, 92]], 'soil-bed', 'bed')];
    const w = world([], 1, sunMap(8, 2), els);
    expect(w.wormSpots.length).toBeGreaterThan(50);
    for (const s of w.wormSpots) {
      expect(pointInPolygon(s.x, s.y, PATIO.points)).toBe(false);
      expect(pointInPolygon(s.x, s.y, els.find((e) => e.id === 'rb')!.points)).toBe(false);
      for (const st of structures) expect(pointInPolygon(s.x, s.y, st.footprint)).toBe(false);
    }
    expect(w.wormSpots.some((s) => s.rich)).toBe(true); // the bed
    expect(w.wormSpots.some((s) => s.shade)).toBe(true);
    expect(w.wormSpots.some((s) => !s.shade)).toBe(true);
  });

  it('gather under fallen leaves and compost, and in the shade, not in baking sun', () => {
    // a persimmon, bare in January with its leaves down, and the same tree leafy in July
    const tree = placed([['diospyros-kaki-hachiya', 38, 100]]);
    const winter = world(tree, 1, sunMap(8, 2));
    expect(winter.wormSpots.some((s) => s.litter === 'fresh')).toBe(true);
    expect(world(tree, 7, sunMap(8, 2)).wormSpots.some((s) => s.litter !== 'none')).toBe(false);
    expect(world(tree, 4, sunMap(8, 2)).wormSpots.some((s) => s.litter === 'compost')).toBe(true); // rotting into the soil
    // with the shady west side and a sunny east side, worms favor the shade
    let shade = 0, sun = 0;
    const split = world([], 1, sunMap(8, 2));
    for (let seed = 1; seed <= 12; seed++) {
      const sim = new CritterSim(split, cfg, seed);
      for (const wm of sim.worms) {
        if (split.wormSpots[wm.spot].shade) shade++; else sun++;
      }
    }
    expect(shade).toBeGreaterThan(sun);
    // litter pulls worms in: more of them sit on leaf litter than the share of litter ground would suggest (even light all over, so shade does not decide it)
    const lw = world(tree, 1, sunMap(8, 8));
    const share = lw.wormSpots.filter((s) => s.litter !== 'none').length / lw.wormSpots.length;
    let onLitter = 0, total = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const sim = new CritterSim(lw, cfg, seed);
      for (const wm of sim.worms) { total++; if (lw.wormSpots[wm.spot].litter !== 'none') onLitter++; }
    }
    expect(onLitter / total).toBeGreaterThan(share * 1.8);
  });

  it('come out and go back by the time of day and the month, gradually', () => {
    const w = world([], 1, sunMap(8, 2));
    const sim = new CritterSim(w, cfg, 3);
    sim.setClock({ minutes: 2 * 60, night: true });
    expect(sim.worms.every((x) => x.ext === 0)).toBe(true); // not yet up
    for (let t = 0; t < 1 / cfg.worms.emergeRate + 0.5; t += 0.1) sim.step(0.1);
    const night = sim.worms.filter((x) => x.ext > 0.99).length;
    expect(night).toBeGreaterThan(sim.worms.length * 0.8);
    sim.setClock({ minutes: 13 * 60, night: false });
    for (let t = 0; t < 1 / cfg.worms.emergeRate + 0.5; t += 0.1) sim.step(0.1);
    const afternoon = sim.worms.filter((x) => x.ext > 0.99).length;
    expect(afternoon).toBeLessThan(night);
    // July: a few at night only
    const summer = new CritterSim(world([], 7, sunMap(8, 2)), cfg, 3);
    expect(summer.worms.length).toBeLessThan(sim.worms.length / 3);
  });
});

describe('the visitors together', () => {
  it('repeat for a seed, and differ for another', () => {
    const run = (seed: number) => {
      const sim = new CritterSim(world([...HUMM(3), ...BUTTER(3)], 6, sunMap(8, 2)), cfg, seed);
      sim.setClock({ minutes: 12 * 60, night: false });
      for (let t = 0; t < 30; t += 0.1) sim.step(0.1);
      return JSON.stringify([sim.hummers, sim.butterflies, sim.worms]);
    };
    expect(run(4)).toBe(run(4));
    expect(run(4)).not.toBe(run(5));
  });

  it('stay inside the lot', () => {
    const w = world([...HUMM(4), ...BUTTER(4)], 6, sunMap(8, 2));
    const sim = new CritterSim(w, cfg, 11);
    sim.setClock({ minutes: 12 * 60, night: false });
    for (let t = 0; t < 120; t += 0.1) {
      sim.step(0.1);
      for (const o of [...sim.hummers, ...sim.butterflies]) {
        expect(o.x).toBeGreaterThan(-3);
        expect(o.x).toBeLessThan(site.lot.width + 3);
        expect(o.y).toBeGreaterThan(-3);
        expect(o.y).toBeLessThan(site.lot.depth + 3);
        expect(o.z).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
