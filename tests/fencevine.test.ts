import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import speciesRaw from '../src/data/species.json';
import { fenceVineGrowth, type FenceVineInput } from '../src/engine/fencevine';
import type { EngineConfig, SpeciesLibrary } from '../src/engine/types';

const engine = engineRaw as unknown as EngineConfig;
const cfg = engine.fenceVine;
const lib = speciesRaw as unknown as SpeciesLibrary;
const jasmine = lib.species.find((s) => s.id === 'trachelospermum-jasminoides')!;

// the west fence: starts 20 ft from the street, runs along +y, the yard to +x; one 8 ft hog panel (3 ft tall) between boards 6 ft tall
const base = (over: Partial<FenceVineInput> = {}): FenceVineInput => ({
  seed: 7, along: 40, height: 3, width: 1.5, matureHeight: jasmine.matureHeight,
  panels: [{ from: 36, to: 44, top: 34 / 12 }], boards: [{ from: 0, to: 36, top: 6 }, { from: 44, to: 130, top: 6 }],
  a: [0, 20], dir: [0, 1], yard: [1, 0], origin: [1, 60],
  leaf: { lengthFt: jasmine.look!.leaf.lengthFt, widthFt: jasmine.look!.leaf.widthFt, perFt: jasmine.look!.leaf.perFt ?? 10, displayScale: 1.4 },
  flower: { sizeFt: 0.07, displayScale: 2.4 }, blooming: false,
  ...over,
});
const alongOf = (l: { p: number[] }, i: FenceVineInput) => (l.p[0] + i.origin[0] - i.a[0]) * i.dir[0] + (l.p[1] + i.origin[1] - i.a[1]) * i.dir[1];
const growAt = (f: number, over: Partial<FenceVineInput> = {}) => base({ height: jasmine.matureHeight * f, width: jasmine.matureWidth * f, ...over });

describe('a climbing plant on the fence', () => {
  it('grows up the hog wire, staying on the panel and within its height while it is young', () => {
    const inp = growAt(0.3);
    const r = fenceVineGrowth(inp, cfg);
    expect(r.leaves.length).toBeGreaterThan(20);
    for (const l of r.leaves) {
      const s = alongOf(l, inp);
      expect(s).toBeGreaterThanOrEqual(36 - 0.2);
      expect(s).toBeLessThanOrEqual(44 + 0.2);
    }
    expect(r.reach.topFt).toBeLessThanOrEqual(34 / 12 + cfg.overTopFt + 0.5);
    expect(r.reach.leavesOnBoards).toBeLessThan(r.leaves.length * 0.1);
  });

  it('lies flat against the fence: leaves stay within a few inches of it once up the wire, and lean in from the plant\'s base at the foot', () => {
    const inp = growAt(0.8);
    const r = fenceVineGrowth(inp, cfg);
    const depth = (l: { p: number[] }) => l.p[0] + inp.origin[0] - inp.a[0]; // feet in front of the fence line (the yard is +x)
    for (const l of r.leaves.filter((x) => x.p[2] > cfg.climbFt + 0.2)) {
      expect(depth(l)).toBeGreaterThanOrEqual(cfg.planeDepthFt[0] - 0.02);
      expect(depth(l)).toBeLessThanOrEqual(cfg.planeDepthFt[1] + 0.02);
    }
    // the stems start at the plant's base, a foot out, and finish on the fence
    const first = r.segments[0];
    expect(first.a[0]).toBeCloseTo(0, 6);
    expect(first.a[2]).toBe(0);
    const farEnd = r.segments.reduce((m, s) => (s.b[2] > m.b[2] ? s : m));
    expect(farEnd.b[0] + inp.origin[0]).toBeLessThan(0.5);
  });

  it('spreads onto the boards beside the panel only once it is grown, and further as it fills out', () => {
    const young = fenceVineGrowth(growAt(0.5), cfg);
    const grown = fenceVineGrowth(growAt(0.85), cfg);
    const mature = fenceVineGrowth(growAt(1), cfg);
    expect(young.reach.leavesOnBoards).toBe(0); // below spillMinGrowth
    expect(grown.reach.leavesOnBoards).toBeGreaterThan(0);
    expect(mature.reach.leavesOnBoards).toBeGreaterThan(grown.reach.leavesOnBoards);
    // but never more than spillFt past the panel's edge, nor higher than the boards
    const inp = growAt(1);
    for (const l of mature.leaves) {
      const s = alongOf(l, inp);
      expect(s).toBeGreaterThanOrEqual(36 - cfg.spillFt - 0.3);
      expect(s).toBeLessThanOrEqual(44 + cfg.spillFt + 0.3);
      expect(l.p[2]).toBeLessThanOrEqual(6 + 0.3);
    }
    expect(mature.reach.to - mature.reach.from).toBeGreaterThan(grown.reach.to - grown.reach.from - 0.01);
  });

  it('stays low when there is no wire panel to climb', () => {
    const r = fenceVineGrowth(growAt(1, { panels: [] }), cfg);
    expect(r.reach.topFt).toBeLessThanOrEqual(cfg.unsupportedFt + 0.3);
  });

  it('does not cover fence further from the plant than its own spread plus its reach onto the boards', () => {
    const inp = growAt(1);
    const r = fenceVineGrowth(inp, cfg);
    for (const l of r.leaves) expect(Math.abs(alongOf(l, inp) - inp.along)).toBeLessThanOrEqual(inp.width / 2 + cfg.spillFt + 0.3);
  });

  it('is the same every time for one seed, and different for another', () => {
    const a = fenceVineGrowth(growAt(0.7), cfg), b = fenceVineGrowth(growAt(0.7), cfg), c = fenceVineGrowth(growAt(0.7, { seed: 8 }), cfg);
    expect(a.leaves.map((l) => l.p)).toEqual(b.leaves.map((l) => l.p));
    expect(a.leaves.map((l) => l.p)).not.toEqual(c.leaves.map((l) => l.p));
  });

  it('puts flowers on it only while it blooms, and keeps the leaf count within its limit', () => {
    expect(fenceVineGrowth(growAt(0.9), cfg).flowers).toHaveLength(0);
    const f = fenceVineGrowth(growAt(0.9, { blooming: true }), cfg);
    expect(f.flowers.length).toBeGreaterThan(5);
    expect(fenceVineGrowth(growAt(1, { blooming: true }), cfg).leaves.length).toBeLessThanOrEqual(cfg.maxLeaves * 1.05);
  });

  it('has more leaves and a wider spread as it grows', () => {
    const sizes = [0.15, 0.4, 0.7, 1].map((f) => fenceVineGrowth(growAt(f), cfg));
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i].leaves.length).toBeGreaterThanOrEqual(sizes[i - 1].leaves.length);
      expect(sizes[i].reach.topFt).toBeGreaterThanOrEqual(sizes[i - 1].reach.topFt - 0.01);
    }
  });
});
