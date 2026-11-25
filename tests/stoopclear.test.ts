import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import engineRaw from '../src/data/engine.json';
import { drivewayBlocks, footprint, hardscapeWarnings, isStoop } from '../src/engine/hardscape';
import { loadSite } from '../src/engine/site';
import type { EngineConfig, HardscapeElement } from '../src/engine/types';

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;
const hs = engine.hardscape;
const els = site.hardscape as HardscapeElement[];
const stoops = els.filter((e) => isStoop(e, hs));

describe('stoops, steps and landings are kept clear', () => {
  it('finds every stoop, step, porch floor and landing', () => {
    const ids = stoops.map((e) => e.id);
    for (const id of ['porch-floor', 'stoop-west', 'stoop-east', 'stoop-slider', 'stoop-kitchen', 'stoop-kitchen-step', 'adu-landing', 'adu-step-north']) expect(ids).toContain(id);
  });

  it('blocks planting on each one, and not beside it', () => {
    for (const e of stoops) {
      const poly = footprint(e, hs);
      const c: [number, number] = [poly.reduce((a, p) => a + p[0], 0) / poly.length, poly.reduce((a, p) => a + p[1], 0) / poly.length];
      expect(drivewayBlocks(c, els, hs), e.id).toBe(true);
    }
    expect(drivewayBlocks([60, 5], els, hs)).toBe(false);
  });

  it('warns when new work overlaps a stoop', () => {
    const s = stoops.find((e) => e.id === 'stoop-slider')!;
    const [x, y] = footprint(s, hs)[0];
    const mine = { ...s, id: 'mine', existing: false, points: [[x + 1, y + 1], [x + 4, y + 1], [x + 4, y + 3], [x + 1, y + 3]] } as HardscapeElement;
    const w = hardscapeWarnings(mine, [...els, mine], { easements: [], trees: [], lot: site.lot }, hs);
    expect(w.some((k) => k.kind === 'stoop')).toBe(true);
  });
});
