import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import speciesRaw from '../src/data/species.json';
import { fruitState } from '../src/engine/fruit';
import { sunFit } from '../src/engine/growth';
import type { EngineConfig, Species, SpeciesLibrary } from '../src/engine/types';

const engine = engineRaw as unknown as EngineConfig;
const lib = speciesRaw as unknown as SpeciesLibrary;
const sp = (id: string) => lib.species.find((s) => s.id === id)!;

describe('berries are drawn at a believable size', () => {
  const full = (s: Species) => ({ planted: true, height: s.matureHeight, width: s.matureWidth });
  const shown = (id: string) => {
    const s = sp(id);
    return fruitState(s, full(s), s.fruit!.ripeMonths[0], engine.fruit)!.diameterFt;
  };

  it('keeps a blueberry about an inch across on screen (it is about half an inch in life), and a blackberry about an inch and a half', () => {
    for (const id of ['vaccinium-sunshine-blue', 'vaccinium-misty']) {
      const d = shown(id);
      expect(d * 12, id).toBeGreaterThan(0.6); // never smaller than the real fruit
      expect(d * 12, id).toBeLessThanOrEqual(1.4);
      expect(sp(id).fruit!.diameterFt * 12).toBeLessThan(0.8); // the real fruit is under an inch
    }
    expect(shown('rubus-arapaho') * 12).toBeLessThanOrEqual(1.8);
    expect(shown('rubus-arapaho')).toBeGreaterThan(shown('vaccinium-misty')); // a blackberry is bigger than a blueberry
  });

  it('draws strawberries bigger than blueberries and smaller than apples, and bigger fruit is never drawn smaller than small fruit', () => {
    const straw = shown('fragaria-seascape'), blue = shown('vaccinium-misty'), apple = shown('malus-mutsu');
    expect(straw).toBeGreaterThan(blue);
    expect(straw).toBeLessThan(apple);
    expect(shown('fragaria-seascape')).toBeGreaterThan(shown('fragaria-vesca-alexandria'));
  });

  it('shows plenty of berries on a full plant, not a handful', () => {
    const s = sp('vaccinium-misty');
    expect(fruitState(s, full(s), 5, engine.fruit)!.count).toBeGreaterThan(100);
  });
});

describe('shade plants for Los Angeles clay', () => {
  const shade = lib.species.filter((s) => s.sun === 'shade');

  it('are in the library: a dozen plants that want shade, from ferns to groundcovers to a perennial', () => {
    expect(shade.length).toBeGreaterThanOrEqual(6);
    expect(new Set(shade.map((s) => s.type)).size).toBeGreaterThanOrEqual(2);
    for (const id of ['polystichum-munitum', 'dryopteris-arguta', 'aspidistra-elatior', 'clivia-miniata', 'helleborus-hybridus', 'clinopodium-douglasii']) expect(sp(id).sun, id).toBe('shade');
    for (const id of ['iris-douglasiana', 'berberis-aquifolium', 'ribes-viburnifolium', 'carex-divulsa', 'liriope-muscari']) expect(sp(id), id).toBeDefined();
  });

  it('tolerate clay: every shade and part-shade addition lists clay or clay loam, never needs fast drainage', () => {
    const added = ['polystichum-munitum', 'dryopteris-arguta', 'aspidistra-elatior', 'clivia-miniata', 'helleborus-hybridus', 'clinopodium-douglasii', 'iris-douglasiana', 'berberis-aquifolium', 'ribes-viburnifolium', 'carex-divulsa', 'liriope-muscari', 'fragaria-vesca-alexandria'];
    for (const id of added) {
      const s = sp(id);
      expect(s.soil.textures.some((t) => t === 'clay' || t === 'clay loam'), id).toBe(true);
      expect(s.soil.drainageNeed, id).not.toBe('fast');
    }
  });

  it('are judged by the same light rule: fine in the shade, too sunny in full sun', () => {
    for (const s of shade) {
      expect(sunFit(s, 2.5, engine.growth), s.id).toBe('ok');
      expect(sunFit(s, 8, engine.growth), s.id).toBe('too-sunny');
    }
  });

  it('have the data every plant needs, and a note that the figures are estimates', () => {
    for (const s of shade) {
      expect((s.notes ?? '').length).toBeGreaterThan(20);
      expect((s.notes ?? '').toLowerCase()).toMatch(/estimate|owner|sheet/);
      expect(s.matureHeight).toBeGreaterThan(0);
      expect(s.matureWidth).toBeGreaterThan(0);
      expect(s.foliageColor).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('strawberries', () => {
  it('are two plants: a sun-loving day-neutral one and an alpine one for part shade, both edible with fruit', () => {
    const a = sp('fragaria-seascape'), b = sp('fragaria-vesca-alexandria');
    expect(a.type).toBe('edible');
    expect(b.type).toBe('edible');
    expect(a.sun).toBe('full');
    expect(b.sun).toBe('part');
    expect(a.fruit!.ripeMonths.length).toBeGreaterThanOrEqual(5); // spring through fall
    expect(a.fruit!.ripeColor).toMatch(/^#[c-f]/i); // red
    expect(a.matureHeight).toBeLessThan(1.5);
    // they are low mats
    expect(a.habit).toBe('mat');
  });
});

describe('growth stages', () => {
  it('compares up to four plants at once, the one opened included', () => {
    expect(engine.growthStages.maxPlants).toBe(4);
  });
});

describe('roses for Los Angeles', () => {
  const roses = lib.species.filter((s) => s.botanical.startsWith('Rosa'));

  it('has ten roses, each a complete row (bloom months, soil, roots, a detailed look) marked low confidence', () => {
    expect(roses.length).toBeGreaterThanOrEqual(10);
    for (const s of roses) {
      expect(Array.isArray(s.bloomMonths) && s.bloomMonths.length > 0, s.id).toBe(true);
      expect(s.soil.textures.length, s.id).toBeGreaterThan(0);
      expect(s.roots, s.id).toBeDefined();
      expect(s.look, s.id).toBeDefined();
      expect(s.sheet?.confidence, s.id).toBe('Recall only');
    }
  });

  it('covers the kinds an owner will ask for: hybrid tea, floribunda, shrub, climber and a California native', () => {
    for (const id of ['rosa-mr-lincoln', 'rosa-iceberg', 'rosa-knock-out', 'rosa-banksiae', 'rosa-californica']) expect(sp(id), id).toBeDefined();
    expect(sp('rosa-banksiae').type).toBe('vine');
    expect(sp('rosa-californica').origin).toBe('california native');
  });
});
