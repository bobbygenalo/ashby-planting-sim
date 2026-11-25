import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import { glassBands } from '../src/engine/glazing';
import { bbox } from '../src/engine/geometry';
import { loadSite } from '../src/engine/site';

const site = loadSite(siteRaw);
const get = (id: string) => site.structures.find((s) => s.id === id)!;

describe('the ADU clerestory windows', () => {
  it('are on both wings, nowhere else', () => {
    expect(site.structures.filter((s) => s.windows?.length).map((s) => s.id).sort()).toEqual(['adu-bedroom', 'adu-great']);
  });

  it.each(['adu-great', 'adu-bedroom'])('%s: a wide band on the tall east wall, not the south front, set in from the ends, in the plane of the wall', (id) => {
    const s = get(id), f = bbox(s.footprint);
    expect(s.windows!.map((w) => w.side)).toEqual(['east']);
    const [b] = glassBands(s);
    expect(b.normal).toEqual([1, 0]);
    for (const c of b.corners) expect(c[0]).toBeCloseTo(f.maxX); // in the east wall's plane
    const [bl, br, tr, tl] = b.corners;
    expect(bl[1]).toBeGreaterThanOrEqual(f.minY + 0.5);
    expect(br[1]).toBeLessThanOrEqual(f.maxY - 0.5);
    expect(br[1] - bl[1]).toBeGreaterThan((f.maxY - f.minY) * 0.7); // wide along the wall
    expect(tl[1]).toBe(bl[1]);
    expect(tr[1]).toBe(br[1]);
  });

  it('sits high on the wall, level, just under the roof edge, and for the bedroom wing above the lower roof beside it', () => {
    for (const id of ['adu-great', 'adu-bedroom']) {
      const s = get(id);
      const [b] = glassBands(s);
      const [bl, br, tr, tl] = b.corners;
      // the east wall is the roof's high edge, so the band is level
      expect(tl[2]).toBeCloseTo(tr[2]);
      expect(bl[2]).toBeCloseTo(br[2]);
      expect(tl[2] - bl[2]).toBeCloseTo(s.windows![0].heightFt);
      expect(tl[2]).toBeLessThan(s.ridgeHeight);
      expect(tl[2]).toBeGreaterThan(s.ridgeHeight - 1);
    }
    // the bedroom wing's east wall stands above the bath-and-hall roof beside it: the glass is wholly in the part that shows
    const link = get('adu-link');
    expect(glassBands(get('adu-bedroom'))[0].corners[0][2]).toBeGreaterThan(link.ridgeHeight);
  });

  it('has mullions about every four and a half feet, end posts included, each as tall as the glass', () => {
    const [b] = glassBands(get('adu-great'));
    expect(b.mullions.length).toBeGreaterThanOrEqual(3);
    expect(b.mullions[0].y).toBeCloseTo(b.corners[0][1]);
    expect(b.mullions[b.mullions.length - 1].y).toBeCloseTo(b.corners[1][1]);
    for (let i = 1; i < b.mullions.length; i++) expect(b.mullions[i].y - b.mullions[i - 1].y).toBeLessThan(5.5);
    for (const m of b.mullions) expect(m.z1 - m.z0).toBeCloseTo(2.4);
  });

  it('keeps the old south-wall rule: a south or north band stays under the overhanging roof slab', () => {
    const s = { ...get('adu-great'), windows: [{ side: 'south' as const, insetFt: 0.6, belowRoofFt: 0.35, heightFt: 2.6, mullionFt: 5 }] };
    const [b] = glassBands(s);
    expect(b.normal).toEqual([0, -1]);
    expect(b.corners[3][2]).toBeLessThan(s.eaveHeight - s.roofThickness! + 0.1 + (s.ridgeHeight - s.eaveHeight) * 0.05);
    expect(b.corners[2][2]).toBeLessThan(s.ridgeHeight - s.roofThickness!);
  });

  it('does nothing for a structure with no windows', () => {
    const plain = site.structures.find((q) => !q.windows)!;
    expect(glassBands(plain)).toEqual([]);
  });
});
