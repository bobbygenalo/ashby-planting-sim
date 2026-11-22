import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import speciesRaw from '../src/data/species.json';
import { litterState, sheds } from '../src/engine/litter';
import type { EngineConfig, Species, SpeciesLibrary } from '../src/engine/types';

const cfg = (engineRaw as unknown as EngineConfig).litter;
const lib = speciesRaw as unknown as SpeciesLibrary;
const sp = (id: string) => lib.species.find((s) => s.id === id)!;
const months = Array.from({ length: 12 }, (_, i) => i + 1);

describe('leaf litter', () => {
  it('only deciduous plants shed', () => {
    expect(sheds(sp('malus-mutsu'))).toBe(true);
    expect(sheds(sp('olea-frantoio'))).toBe(false);
    expect(sheds(sp('citrus-satsuma'))).toBe(false);
    for (const m of months) expect(litterState(sp('olea-frantoio'), m, cfg).phase).toBe('none');
  });

  it('falls in the first leaf-off month, lies while the tree is bare, then rots into the soil over the next months, across the new year', () => {
    const apple = sp('malus-mutsu'); // bare Dec to Feb
    expect(litterState(apple, 11, cfg).phase).toBe('none');
    expect(litterState(apple, 12, cfg)).toMatchObject({ phase: 'falling', amount: cfg.fallAmount, decay: 0 });
    expect(litterState(apple, 1, cfg)).toMatchObject({ phase: 'lying', amount: 1, decay: 0 });
    expect(litterState(apple, 2, cfg)).toMatchObject({ phase: 'lying', amount: 1 });
    const rot = [3, 4, 5].map((m) => litterState(apple, m, cfg));
    for (const r of rot) expect(r.phase).toBe('composting');
    expect(rot[0].amount).toBeGreaterThan(rot[1].amount);
    expect(rot[1].amount).toBeGreaterThan(rot[2].amount);
    expect(rot[0].decay).toBeLessThan(rot[1].decay);
    expect(rot[2].decay).toBeLessThan(1);
    expect(rot[2].amount).toBeGreaterThan(0);
    for (const m of [6, 7, 8, 9, 10, 11]) expect(litterState(apple, m, cfg).phase).toBe('none');
  });

  it('takes `decayMonths` to rot away and `fallMonths` to fall, as configured', () => {
    const tree = { ...sp('malus-mutsu'), leafOffMonths: [12, 1, 2, 3] } as Species;
    const slow = { ...cfg, decayMonths: 5, fallMonths: 2 };
    expect(litterState(tree, 12, slow).phase).toBe('falling');
    expect(litterState(tree, 1, slow).phase).toBe('falling');
    expect(litterState(tree, 2, slow).phase).toBe('lying');
    expect(months.filter((m) => litterState(tree, m, slow).phase === 'composting')).toEqual([4, 5, 6, 7, 8]);
  });

  it('gives every deciduous species a season of litter, none in high summer, and a complete cycle', () => {
    const deciduous = lib.species.filter(sheds);
    expect(deciduous.length).toBeGreaterThan(3);
    for (const s of deciduous) {
      const phases = months.map((m) => litterState(s, m, cfg).phase);
      expect(phases, s.id).toContain('falling');
      expect(phases, s.id).toContain('lying');
      expect(phases, s.id).toContain('composting');
      expect(phases[6], `${s.id} in July`).toBe('none');
      for (const m of months) {
        const st = litterState(s, m, cfg);
        expect(st.amount).toBeGreaterThanOrEqual(0);
        expect(st.amount).toBeLessThanOrEqual(1);
        expect(st.decay).toBeGreaterThanOrEqual(0);
        expect(st.decay).toBeLessThan(1);
      }
    }
  });
});
