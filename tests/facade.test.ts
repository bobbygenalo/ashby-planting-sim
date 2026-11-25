import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import siteRaw from '../src/data/site.json';
import { buildSunScene, loadSite, structureSolidPoints } from '../src/engine/site';
import type { EngineConfig, OpeningCfg, Pt, StructureCfg } from '../src/engine/types';
import { slatLayout } from '../src/engine/slats';

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;
const openings = site.openings ?? [];
const byId = <T extends { id: string }>(list: T[], id: string) => list.find((x) => x.id === id)!;

/** The edge of a polygon a point lies on, with the edge's outward normal; null when it is on none. */
function wallAt(poly: Pt[], p: Pt, tol = 0.02): { a: Pt; b: Pt; normal: Pt } | null {
  const cx = poly.reduce((s, q) => s + q[0], 0) / poly.length, cy = poly.reduce((s, q) => s + q[1], 0) / poly.length;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy);
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (l * l);
    const dist = Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
    if (t < -1e-6 || t > 1 + 1e-6 || dist > tol) continue;
    let n: Pt = [dy / l, -dx / l];
    if (n[0] * (a[0] - cx) + n[1] * (a[1] - cy) < 0) n = [-n[0], -n[1]];
    return { a, b, normal: n };
  }
  return null;
}

describe('front of the house from the owner photographs', () => {
  it('draws the porch open: a roof with no walls, so it casts only a roof shadow', () => {
    const porch = byId(site.structures, 'house-porch');
    expect(porch.open).toBe(true);
    expect(Math.min(...structureSolidPoints(porch).map((p) => p[2]))).toBeGreaterThanOrEqual(porch.eaveHeight - 1e-9);
    const closed = structureSolidPoints({ ...porch, open: false });
    expect(Math.min(...closed.map((p) => p[2]))).toBe(0);
    const scene = buildSunScene(site, { aduEnabled: true }, engine);
    expect(Math.min(...byId(scene.solids, 'house-porch').points.map((p) => p[2]))).toBeGreaterThanOrEqual(porch.eaveHeight - 1e-9);
  });

  it('puts every door, window and panel on a wall of a building, facing out of it', () => {
    const walls: { s: StructureCfg }[] = site.structures.filter((s) => !s.open).map((s) => ({ s }));
    for (const o of openings.filter((x) => x.kind !== 'sconce')) {
      const hit = walls.map(({ s }) => ({ s, w: wallAt(s.footprint, o.at) })).find((x) => x.w);
      expect(hit, `${o.id} is on no wall`).toBeTruthy();
      expect(hit!.w!.normal[0]).toBeCloseTo(o.facing[0], 6);
      expect(hit!.w!.normal[1]).toBeCloseTo(o.facing[1], 6);
    }
  });

  it('keeps every opening inside its wall, below its eave', () => {
    for (const o of openings) {
      const s = site.structures.filter((st) => !st.open).find((st) => wallAt(st.footprint, o.at));
      if (!s) continue;
      const w = wallAt(s.footprint, o.at)!;
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      const along = Math.hypot(o.at[0] - w.a[0], o.at[1] - w.a[1]);
      expect(along - o.widthFt / 2, `${o.id} runs off the wall's start`).toBeGreaterThanOrEqual(-0.05);
      expect(along + o.widthFt / 2, `${o.id} runs off the wall's end`).toBeLessThanOrEqual(len + 0.05);
      const top = o.kind === 'sconce' ? o.sillFt + o.heightFt / 2 : o.sillFt + o.heightFt;
      expect(top, `${o.id} is taller than the wall`).toBeLessThanOrEqual(s.ridgeHeight + 1e-6);
    }
  });

  it('stands the front door on the porch floor, with the porch window and sconces beside it and not over it', () => {
    const floor = byId(site.hardscape, 'porch-floor');
    const door = byId(openings, 'front-door');
    expect(door.sillFt).toBeCloseTo(floor.height, 6);
    const win = byId(openings, 'porch-window');
    expect(win.at[0] + win.widthFt / 2).toBeLessThan(door.at[0] - door.widthFt / 2);
    for (const id of ['porch-sconce-high', 'porch-sconce-low']) {
      const s = byId(openings, id);
      expect(Math.abs(s.at[0] - door.at[0])).toBeGreaterThan(door.widthFt / 2);
    }
    // the sim's door is at the front edge of the stoop, in front of the real door (within its casing)
    const simDoor = site.doors!.find((d) => d.id === 'house-front')!;
    expect(Math.abs(simDoor.point[0] - door.at[0])).toBeLessThanOrEqual(door.widthFt / 2);
  });

  it('has the existing porch floor and stoop slabs as raised concrete, not new work', () => {
    const floor = byId(site.hardscape, 'porch-floor'), west = byId(site.hardscape, 'stoop-west'), east = byId(site.hardscape, 'stoop-east');
    for (const e of [floor, west, east]) {
      expect(e.existing).toBe(true);
      expect(e.materialId).toBe('concrete');
      expect(e.height).toBeGreaterThan(0.5);
    }
    expect(floor.height).toBeGreaterThan(west.height);
    // the stoop stops where the porch floor begins
    const stoopTop = Math.max(...west.points.map((p) => p[1]));
    const porchFront = Math.min(...floor.points.map((p) => p[1]));
    expect(stoopTop).toBeCloseTo(porchFront, 3);
  });

  it('puts the slat screen on the porch, under the porch roof, from the corner post to the east post, and lets some sun through', () => {
    const screen = byId(site.contextObjects, 'porch-slats');
    const porch = byId(site.structures, 'house-porch');
    const xs = porch.footprint.map((p) => p[0]), ys = porch.footprint.map((p) => p[1]);
    for (const [x, y] of screen.line!) {
      expect(x).toBeGreaterThan(Math.min(...xs));
      expect(x).toBeLessThan(Math.max(...xs));
      expect(y).toBeGreaterThanOrEqual(Math.min(...ys));
      expect(y).toBeLessThan(Math.max(...ys));
    }
    // the screen runs from the porch's west post to its east post: no separate west post stands inside it
    expect(site.contextObjects.some((o) => o.kind === 'post')).toBe(false);
    expect(Math.min(...screen.line!.map((p) => p[0]))).toBeLessThan(Math.min(...xs) + 1.0);
    expect(screen.height).toBeLessThanOrEqual(porch.eaveHeight);
    expect(screen.baseHeight).toBeCloseTo(byId(site.hardscape, 'porch-floor').height, 6);
    const scene = buildSunScene(site, { aduEnabled: true }, engine);
    const shade = scene.solids.find((s) => s.id === 'porch-slats#0')!;
    expect(shade.density).toBeCloseTo(screen.density!, 6);
    expect(shade.density).toBeGreaterThan(0.3);
    expect(shade.density).toBeLessThan(0.9);
    expect(Math.min(...shade.points.map((p) => p[2]))).toBeCloseTo(screen.baseHeight!, 6);
  });

  it('makes the screen of at least 25 real 2x4s at 45 degrees, 1 to 2 inches apart, all between the two posts', () => {
    const screen = byId(site.contextObjects, 'porch-slats');
    const len = Math.hypot(screen.line![1][0] - screen.line![0][0], screen.line![1][1] - screen.line![0][1]);
    const cfg = { slatFt: screen.slatFt!, slatWidthFt: screen.slatWidthFt!, slatAngleDeg: screen.slatAngleDeg!, slatCount: screen.slatCount!, endPostFt: screen.endPostFt! };
    expect(cfg.slatCount).toBeGreaterThanOrEqual(25);
    expect(cfg.slatAngleDeg).toBe(45);
    // a 2x4 is 1.5 by 3.5 inches
    expect(cfg.slatFt * 12).toBeCloseTo(1.5, 1);
    expect(cfg.slatWidthFt * 12).toBeCloseTo(3.5, 1);
    const l = slatLayout(len, cfg);
    expect(l.centers).toHaveLength(cfg.slatCount);
    // the clear space between neighbors, square to their faces and measured along the screen
    expect(l.gapAcrossFt * 12).toBeGreaterThanOrEqual(1);
    expect(l.gapAcrossFt * 12).toBeLessThanOrEqual(2);
    expect(l.gapAlongFt * 12).toBeGreaterThanOrEqual(1 - 1e-6);
    // evenly spaced, none touching a post or another slat
    for (let i = 1; i < l.centers.length; i++) expect(l.centers[i] - l.centers[i - 1]).toBeCloseTo(l.pitch, 9);
    expect(l.centers[0] - l.extent / 2).toBeGreaterThanOrEqual(cfg.endPostFt / 2 - 1e-9);
    expect(l.centers[l.centers.length - 1] + l.extent / 2).toBeLessThanOrEqual(len - cfg.endPostFt / 2 + 1e-9);
    expect(l.pitch).toBeGreaterThan(l.extent);
  });

  it('marks everything read from a photograph as an estimate', () => {
    for (const o of openings as OpeningCfg[]) expect(o.estimate, o.id).toBe(true);
  });
});

describe('openings against the printed elevations', () => {
  const floor = 1.25; // 01 ground floor, 1'-3" above natural grade
  const o = (id: string) => byId(openings, id);
  const top = (id: string) => o(id).sillFt + o(id).heightFt;

  it('matches the south elevation: window 08 is 4\'-0 1/4" tall with its sill 2\'-9" above the floor, and the door tops out at 8\'-0"', () => {
    expect(o('gable-window').heightFt).toBeCloseTo(4 + 1 / 48, 2);
    expect(o('gable-window').sillFt - floor).toBeCloseTo(2.75, 2);
    expect(top('front-door')).toBeCloseTo(8.0, 1);
    expect(o('front-door').sillFt).toBeCloseTo(floor, 6);
    expect(o('porch-window').sillFt - floor).toBeCloseTo(2.75, 2); // window 01 sits at the same height
    expect(o('porch-sconce-high').sillFt - floor).toBeGreaterThan(o('porch-sconce-low').sillFt - floor);
  });

  it('matches the north elevation: window 11 is 2\'-6" above the floor, the sconces are 5\'-0" above it, and the slider has three panels', () => {
    expect(o('rear-window').sillFt - floor).toBeCloseTo(2.5, 2);
    expect(o('rear-sconce-east').sillFt - floor).toBeCloseTo(4.85, 1);
    expect(o('rear-slider').mullions).toBe(2);
    expect(o('rear-slider').sillFt).toBeCloseTo(floor, 6);
    // the window is west of the slider and the sconces flank it
    expect(o('rear-window').at[0]).toBeLessThan(o('rear-slider').at[0]);
    expect(o('rear-sconce-west').at[0]).toBeLessThan(o('rear-slider').at[0] - o('rear-slider').widthFt / 2);
    expect(o('rear-sconce-east').at[0]).toBeGreaterThan(o('rear-slider').at[0] + o('rear-slider').widthFt / 2);
  });

  it('matches the west elevation: window 10 is 3\'-6" tall and 3\'-6" above the floor, and the porch roof meets the 9\'-3" underside', () => {
    expect(o('west-window').heightFt).toBeCloseTo(3.5, 2);
    expect(o('west-window').sillFt - floor).toBeCloseTo(3.5, 2);
    expect(o('west-window').facing).toEqual([-1, 0]);
    expect(byId(site.structures, 'house-porch').eaveHeight).toBeCloseTo(9.25, 2);
    expect(byId(site.contextObjects, 'porch-slats').height).toBeCloseTo(floor + 7 + 11.5 / 12, 2); // 7'-11 1/2" above the floor
  });
});

describe('the ADU from the owner isometric views', () => {
  const adu = (id: string) => byId(site.structures, id);

  it('clads the south-facing walls of the great room and the bedroom wing in vertical Hardie board, with only the garage (horizontal lap board) beside them', () => {
    expect(adu('adu-great').finish?.south).toBe('hardie');
    expect(adu('adu-bedroom').finish?.south).toBe('hardie');
    expect(site.structures.filter((st) => st.finish).map((st) => st.id).sort()).toEqual(['adu-bedroom', 'adu-great', 'garage']);
    expect(site.structures.find((st) => st.id === 'garage')!.finish?.all).toBe('hardie-lap');
  });

  it('puts the entry landing at the printed 12\'-2 3/4" by 4\'-0", against the east fin and the south wall, level with the door sill', () => {
    const landing = byId(site.hardscape, 'adu-landing');
    const xs = landing.points.map((p) => p[0]), ys = landing.points.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(12 + 2.75 / 12, 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(4, 1);
    expect(Math.max(...ys)).toBeCloseTo(adu('adu-great').footprint[0][1], 2); // against the south wall
    expect(Math.max(...xs)).toBeCloseTo(adu('adu-fin-great-e').footprint[0][0], 2); // to the east fin's inner face
    const slider = byId(openings, 'adu-gr-slider');
    expect(Math.abs(landing.height - slider.sillFt)).toBeLessThan(0.05);
    expect(slider.at[0] - slider.widthFt / 2).toBeGreaterThan(Math.min(...xs));
    expect(slider.at[0] + slider.widthFt / 2).toBeLessThan(Math.max(...xs));
  });

  it('has the south openings the view shows: a window, a light and a sliding door on the great room, a wide window on the bedroom wing', () => {
    expect(byId(openings, 'adu-gr-window').at[0]).toBeLessThan(byId(openings, 'adu-gr-light').at[0]);
    expect(byId(openings, 'adu-gr-light').at[0]).toBeLessThan(byId(openings, 'adu-gr-slider').at[0] - byId(openings, 'adu-gr-slider').widthFt / 2);
    expect(byId(openings, 'adu-br-window').widthFt).toBeGreaterThan(5);
    for (const o of openings.filter((x) => x.id.startsWith('adu-'))) expect(o.building, o.id).toBe('adu');
  });

  it('puts the heads of the south windows and door at about 8 ft', () => {
    for (const id of ['adu-gr-window', 'adu-gr-slider']) expect(byId(openings, id).sillFt + byId(openings, id).heightFt).toBeCloseTo(8.0, 0);
  });
});
describe('the kitchen door', () => {
  it('has a full-height glass pane with a margin of about 7 in all round', () => {
    const door = openings.find((o) => o.id === 'back-door')!;
    expect(door.lite).toBe(true);
    expect(door.liteMarginFt! * 12).toBeCloseTo(7, 0);
    const leafW = door.widthFt - 2 * (door.frameFt ?? 0.15), leafH = door.heightFt - (door.frameFt ?? 0.15);
    const paneW = leafW - 2 * door.liteMarginFt!, paneH = leafH - 2 * door.liteMarginFt!;
    expect(paneW).toBeGreaterThan(1.2);
    expect(paneH / leafH).toBeGreaterThan(0.75); // nearly the whole height of the door
    expect(paneH).toBeGreaterThan(paneW * 2.5);
  });
});
describe('the round lights', () => {
  const lights = openings.filter((o) => o.kind === 'sconce');

  it('are round fixtures at about 5 ft above the floor, and the ADU has them too', () => {
    expect(lights.length).toBeGreaterThanOrEqual(9);
    for (const l of lights) {
      expect(l.widthFt, l.id).toBeCloseTo(l.heightFt, 6); // a sphere
      expect(l.widthFt, l.id).toBeGreaterThan(0.4);
      expect(l.widthFt, l.id).toBeLessThan(0.8);
    }
    for (const l of lights.filter((o) => o.building === 'adu')) expect(l.sillFt - 0.8, l.id).toBeGreaterThan(4.5);
    expect(lights.filter((o) => o.building === 'adu').length).toBeGreaterThanOrEqual(3);
    // no boxy lights left on the ADU
    expect(openings.filter((o) => o.building === 'adu' && o.kind === 'unit')).toHaveLength(0);
  });

  it('puts the ADU entrance light to the left of the sliding door, seen from outside (to its west), between it and the window', () => {
    const light = byId(openings, 'adu-gr-light'), slider = byId(openings, 'adu-gr-slider'), win = byId(openings, 'adu-gr-window');
    expect(light.kind).toBe('sconce');
    expect(light.facing).toEqual(slider.facing);
    expect(light.at[0]).toBeLessThan(slider.at[0] - slider.widthFt / 2);
    expect(light.at[0]).toBeGreaterThan(win.at[0] + win.widthFt / 2);
    // close to the door, as the house's lights are
    expect(slider.at[0] - slider.widthFt / 2 - light.at[0]).toBeLessThan(4);
  });
});
