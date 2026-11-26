import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import engineRaw from '../src/data/engine.json';
import materialsRaw from '../src/data/materials.json';
import speciesRaw from '../src/data/species.json';
import { boardDensity, boardWidthFt, defaultFenceDesign, fenceDensity, fenceLayout, fenceRun, fenceSunPieces, packBlocks, reorderBlocks, sanitizeFenceDesign, shuffleBlocks, vineSpots, type FenceDesign } from '../src/engine/fencedesign';
import { emptyScenarioData, validateScenarioData } from '../src/engine/scenario';
import { buildSunScene, loadSite } from '../src/engine/site';
import type { EngineConfig, SpeciesLibrary } from '../src/engine/types';
import { makeAppStore } from '../src/store/store';

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;
const cfg = engine.fenceDesign;
const lib = speciesRaw as unknown as SpeciesLibrary;
const run = fenceRun(site, cfg)!;
const ctx = { speciesIds: new Set(lib.species.map((x) => x.id)), containers: new Set(Object.keys(engine.growth.containers)), hardscapeTypes: new Set(Object.keys(engine.hardscape.types)), materialIds: new Set(materialsRaw.map((m: { id: string }) => m.id)), zoneIds: new Set(site.zones.map((z) => z.id)) };
const none = (over: Partial<FenceDesign> = {}): FenceDesign => ({ ...defaultFenceDesign(cfg), blocks: [], ...over });
const blk = (id: string, material: string, atFt: number, widthFt: number) => ({ id, material, atFt, widthFt });

describe('customizable west fence', () => {
  it('finds the west fence, which starts 20 ft from the street', () => {
    expect(run.a).toEqual([0, 20]);
    expect(run.lengthFt).toBeGreaterThan(125);
    expect(run.lengthFt).toBeLessThan(135);
    expect(run.heightFt).toBe(6);
  });

  it('offers boards of 2, 4, 6 and 8 ft, wire panels of 2 ft or 4 ft steps, and 1x2 to 1x6 boards with 0 to 1 in gaps', () => {
    for (const m of cfg.materials.filter((x) => x.kind === 'boards')) expect(m.widthsFt).toEqual([2, 4, 6, 8]);
    for (const m of cfg.materials.filter((x) => x.kind === 'wire')) expect(m.widthsFt).toEqual([2, 4, 8, 12, 16]);
    expect(cfg.boardNominalIn[0]).toBe(2);
    expect(cfg.boardNominalIn[cfg.boardNominalIn.length - 1]).toBe(6);
    expect(cfg.boardGapIn.min).toBe(0);
    expect(cfg.boardGapIn.max).toBe(1);
    expect(boardWidthFt(6, cfg) * 12).toBeCloseTo(5.5, 6);
    expect(boardDensity(6, 0, cfg)).toBe(1);
    expect(boardDensity(2, 1, cfg)).toBeCloseTo(1.5 / 2.5, 6);
  });

  it('lets the cedar boards and posts be 6 or 8 ft, the posts rising with the tallest stretch they hold', () => {
    expect(cfg.boardHeightFt.options).toEqual([6, 8]);
    const d = none({ fillHeightFt: 6, blocks: [{ ...blk('a', 'cedar', 20, 4), heightFt: 8 }, blk('b', 'hog', 24, 8)] });
    const l = fenceLayout(d, run.lengthFt, cfg);
    const hAt = (x: number) => l.postHeights[l.posts.findIndex((p) => Math.abs(p - x) < 1e-6)];
    expect(hAt(0)).toBeCloseTo(6 + cfg.postRiseFt, 9); // a 6 ft stretch
    expect(hAt(20)).toBeCloseTo(8 + cfg.postRiseFt, 9); // beside the 8 ft block
    expect(hAt(24)).toBeCloseTo(8 + cfg.postRiseFt, 9); // between the 8 ft block and the wire
    expect(hAt(32)).toBeCloseTo(6 + cfg.postRiseFt, 9); // the wire's other neighbor is a 6 ft fill bay
    expect(l.boards.filter((b) => b.at > 20 && b.at < 24).every((b) => b.heightFt === 8)).toBe(true);
    expect(l.boards.filter((b) => b.at < 20).every((b) => b.heightFt === 6)).toBe(true);
    // the rails of the tall stretch sit higher
    const top = (a: number) => Math.max(...l.rails.filter((r) => r.from === a).map((r) => r.z));
    expect(top(20)).toBeGreaterThan(top(0));
    // and the sun model sees an 8 ft piece
    expect(fenceSunPieces(d, run, cfg).find((p) => p.height === 8)).toBeTruthy();
    expect(sanitizeFenceDesign({ ...d, fillHeightFt: 7, blocks: [{ ...d.blocks[0], heightFt: 9 }] }, cfg, run.lengthFt)).toMatchObject({ fillHeightFt: 6 });
  });

  it('duplicates a block with all its settings right after it, pushing the blocks behind it along', () => {
    const st = makeAppStore('edit');
    const g = () => st.getState();
    g().setFenceCustom(true);
    for (const b of [...g().fenceDesign!.blocks]) g().removeFenceBlock(b.id);
    const a = g().addFenceBlock('cattle', 40, 8)!;
    g().updateFenceBlock(a, { heightIn: 60, gridWidthIn: 6, bottomFt: 1 });
    const b = g().addFenceBlock('redwood', 48, 4)!;
    const copy = g().duplicateFenceBlock(a)!;
    const blocks = g().fenceDesign!.blocks;
    expect(blocks.map((x) => x.id)).toEqual([a, copy, b]);
    expect(blocks[1]).toMatchObject({ material: 'cattle', widthFt: 8, atFt: 48, heightIn: 60, gridWidthIn: 6, bottomFt: 1 });
    expect(blocks[2].atFt).toBe(56); // the redwood block moved along
    // pressing again on the copy chains copies
    const third = g().duplicateFenceBlock(copy)!;
    expect(g().fenceDesign!.blocks.map((x) => x.id)).toEqual([a, copy, third, b]);
    // no room: a copy that would push a block off the end of the fence is refused and nothing changes
    const before = JSON.stringify(g().fenceDesign);
    const tail = g().addFenceBlock('hog', run.lengthFt - 8, 8)!;
    expect(g().duplicateFenceBlock(tail)).toBeNull();
    expect(g().duplicateFenceBlock('nope')).toBeNull();
    expect(JSON.stringify(g().fenceDesign)).not.toBe(before); // (the tail block itself was added)
    expect(g().fenceDesign!.blocks.filter((x) => x.material === 'hog')).toHaveLength(1);
  });

  it('draws hog wire in a metal gray', () => {
    for (const id of ['hog', 'cattle', 'welded']) {
      const hex = cfg.materials.find((m) => m.id === id)!.color;
      const [r, gr, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect(Math.max(r, gr, bl) - Math.min(r, gr, bl), id).toBeLessThan(20); // gray, not tinted
      expect((r + gr + bl) / 3, id).toBeGreaterThan(120); // a galvanized steel gray, not near black
    }
  });

  it('has one-click buttons for a hog wire panel and a wood fence panel, each with a width its material offers', () => {
    expect(cfg.quickAdd.map((q) => q.material)).toEqual(['hog', 'cedar']);
    for (const q of cfg.quickAdd) expect(cfg.materials.find((m) => m.id === q.material)!.widthsFt).toContain(q.widthFt);
    const st = makeAppStore('edit');
    st.getState().setFenceCustom(true);
    for (const b of [...st.getState().fenceDesign!.blocks]) st.getState().removeFenceBlock(b.id);
    for (const q of cfg.quickAdd) st.getState().addFenceBlock(q.material, undefined, q.widthFt);
    expect(st.getState().fenceDesign!.blocks.map((b) => [b.material, b.widthFt])).toEqual([['hog', 8], ['cedar', 4]]);
    expect(st.getState().fenceDesign!.blocks[1].atFt).toBe(8); // right after the first
  });

  it('keeps every setting inside its limits and drops blocks it does not know', () => {
    const d = sanitizeFenceDesign({
      fillBayFt: 5, boardNominalIn: 9, boardGapIn: 5, fillMaterial: 'hog', vines: ['a', 4],
      blocks: [{ id: 'x', material: 'nope', atFt: 5, widthFt: 4 }, { id: 'y', material: 'hog', atFt: -9, widthFt: 5, heightIn: 1000, gridWidthIn: 0 }, { id: 'z', material: 'cedar', atFt: 9999, widthFt: 4 }],
    }, cfg, run.lengthFt);
    expect(d.fillBayFt).toBe(cfg.fill.bayFt.default);
    expect(d.boardNominalIn).toBe(cfg.boardNominalDefault);
    expect(d.boardGapIn).toBe(1);
    expect(d.fillMaterial).toBe(cfg.fill.material); // the fill is boards
    expect(d.vines).toEqual(['a']);
    expect(d.blocks).toHaveLength(1); // unknown material dropped, one past the end dropped
    expect(d.blocks[0]).toMatchObject({ id: 'y', atFt: 0, widthFt: 4, heightIn: cfg.panelHeightIn.max, gridWidthIn: cfg.gridIn.min });
  });

  it('keeps blocks in order along the fence and never lets two overlap or run past the end', () => {
    const packed = packBlocks([blk('b', 'hog', 6, 8), blk('a', 'cedar', 4, 6), blk('c', 'redwood', run.lengthFt - 1, 4)], cfg, run.lengthFt);
    expect(packed.map((b) => b.id)).toEqual(['a', 'b', 'c']);
    expect(packed[1].atFt).toBe(10); // pushed to the end of the block before
    packed.slice(1).forEach((b, i) => expect(b.atFt).toBeGreaterThanOrEqual(packed[i].atFt + packed[i].widthFt - 1e-9));
    const last = packed[packed.length - 1];
    expect(last.atFt + last.widthFt).toBeLessThanOrEqual(run.lengthFt + 1e-9);
  });

  it('lays the fence out as stretches with no gap and no overlap, a block being one bay or one panel between posts', () => {
    const d = none({ fillBayFt: 8, blocks: [blk('a', 'hog', 20, 8), blk('b', 'redwood', 28, 2), blk('c', 'cedar', 30, 4)] });
    const l = fenceLayout(d, run.lengthFt, cfg);
    expect(l.segments[0].from).toBe(0);
    l.segments.slice(1).forEach((sg, i) => expect(sg.from).toBeCloseTo(l.segments[i].to, 9));
    expect(l.segments[l.segments.length - 1].to).toBeCloseTo(run.lengthFt, 6);
    const at = (blockId: string) => l.segments.find((sg) => sg.blockId === blockId)!;
    expect([at('a').kind, at('a').from, at('a').to]).toEqual(['wire', 20, 28]);
    expect([at('b').kind, at('b').from, at('b').to, at('b').material]).toEqual(['boards', 28, 30, 'redwood']);
    expect(at('c').material).toBe('cedar');
    for (const e of [20, 28, 30, 34]) expect(l.posts).toContain(e);
    // never boards and wire in the same stretch
    for (const bd of l.boards) for (const p of l.panels) expect(bd.at < p.from || bd.at > p.to).toBe(true);
    // fill bays are at most the fill width
    expect(Math.max(...l.segments.filter((sg) => !sg.blockId).map((sg) => sg.to - sg.from))).toBeLessThanOrEqual(8 + 1e-9);
    // boards carry their material's color
    expect(l.boards.some((bd) => bd.color === cfg.materials.find((m) => m.id === 'redwood')!.color)).toBe(true);
  });

  it('counts the openings of a panel from its own grid', () => {
    const d = none({ blocks: [{ ...blk('a', 'cattle', 10, 8), heightIn: 48, gridWidthIn: 4, gridHeightIn: 6 }] });
    const p = fenceLayout(d, run.lengthFt, cfg).panels[0];
    expect(p.verticals).toBe(25); // 96 in / 4 in + 1
    expect(p.horizontals).toBe(9); // 48 in / 6 in + 1
    const preset = fenceLayout(none({ blocks: [blk('a', 'hog', 10, 8)] }), run.lengthFt, cfg).panels[0];
    expect(preset.heightFt * 12).toBe(34); // the hog panel's own height
  });

  it('counts wire as mostly open air in the sun model', () => {
    const boards = none({ boardGapIn: 0 });
    expect(fenceDensity(boards, run.lengthFt, cfg)).toBe(1);
    const mixed = none({ boardGapIn: 0, blocks: [blk('a', 'hog', 20, 16)] });
    expect(fenceDensity(mixed, run.lengthFt, cfg)).toBeCloseTo(1 - (16 / run.lengthFt) * cfg.panelOpenShare, 6);
  });

  describe('reordering by dragging', () => {
    const blocks = [blk('a', 'hog', 30, 8), blk('b', 'redwood', 38, 2), blk('c', 'cedar', 40, 4), blk('d', 'hog', 50, 12)]; // a gap before d
    const order = (bs: ReturnType<typeof reorderBlocks>) => bs.map((b) => `${b.id}@${b.atFt}`).join();

    it('moves a block to a new place and shifts the ones between, packed from where the first of them started', () => {
      expect(order(reorderBlocks(blocks, 'c', 0, cfg, run.lengthFt))).toBe('c@30,a@34,b@42,d@50');
      expect(order(reorderBlocks(blocks, 'a', 2, cfg, run.lengthFt))).toBe('b@30,c@32,a@36,d@50');
      expect(order(reorderBlocks(blocks, 'b', 3, cfg, run.lengthFt))).toBe('a@30,c@38,d@42,b@54'); // the gap before d is closed inside the moved range
    });

    it('leaves the blocks outside the moved range where they were, and does nothing when it is dropped where it is', () => {
      const r = reorderBlocks(blocks, 'b', 0, cfg, run.lengthFt);
      expect(r.find((b) => b.id === 'd')!.atFt).toBe(50);
      expect(order(reorderBlocks(blocks, 'b', 1, cfg, run.lengthFt))).toBe(order(packBlocks(blocks, cfg, run.lengthFt)));
      expect(order(reorderBlocks(blocks, 'b', 99, cfg, run.lengthFt))).toBe(order(reorderBlocks(blocks, 'b', 3, cfg, run.lengthFt)));
      expect(order(reorderBlocks(blocks, 'nope', 0, cfg, run.lengthFt))).toBe(order(packBlocks(blocks, cfg, run.lengthFt)));
    });

    it('is what the up and down buttons do, and in the app the climbing plants go with their panels', () => {
      const st = makeAppStore('edit');
      const g = () => st.getState();
      g().setFenceCustom(true);
      for (const b of [...g().fenceDesign!.blocks]) g().removeFenceBlock(b.id);
      const a = g().addFenceBlock('hog', 90, 8)!, b = g().addFenceBlock('redwood', 98, 4)!, c = g().addFenceBlock('hog', 102, 8)!;
      g().patchFenceDesign({ vines: ['trachelospermum-jasminoides'], vineSpacingFt: 4 });
      g().updateFenceBlock(c, { climbers: true });
      const ys = () => g().instances.filter((i) => i.id.startsWith('fv-')).map((i) => i.position[1]);
      expect(ys()).toEqual([124, 128]); // panel c: 102 + 20, 2 ft and 6 ft in
      g().reorderFenceBlock(c, 0);
      expect(g().fenceDesign!.blocks.map((x) => x.id)).toEqual([c, a, b]);
      expect(ys()).toEqual([112, 116]); // now first, at 90 + 20
      g().moveFenceBlock(c, 1); // the button: the same as dragging it one place down
      expect(g().fenceDesign!.blocks.map((x) => x.id)).toEqual([a, c, b]);
      g().undo();
      expect(g().fenceDesign!.blocks.map((x) => x.id)).toEqual([c, a, b]);
    });
  });

  it('closes the Customize fence panel without taking the fence design out of the yard', () => {
    const st = makeAppStore('edit');
    const g = () => st.getState();
    expect(g().fenceBarOpen).toBe(true);
    g().setFenceCustom(true);
    const design = JSON.stringify(g().fenceDesign);
    g().setFenceBarOpen(false);
    expect(g().fenceBarOpen).toBe(false);
    expect(JSON.stringify(g().fenceDesign)).toBe(design); // the fence is still there
    g().setFenceBarOpen(true);
    g().setFenceBarOpen(false);
    g().setFenceCustom(false); // unticking Customize fence is what takes it out
    expect(g().fenceDesign).toBeNull();
    g().setFenceCustom(true); // ticking it again brings the panel back
    expect(g().fenceBarOpen).toBe(true);
  });

  describe('picking and dragging a block in the yard', () => {
    const setup = () => {
      const st = makeAppStore('edit');
      const g = () => st.getState();
      g().setFenceCustom(true);
      for (const b of [...g().fenceDesign!.blocks]) g().removeFenceBlock(b.id);
      const a = g().addFenceBlock('hog', 40, 8)!, b = g().addFenceBlock('redwood', 48, 4)!, c = g().addFenceBlock('cedar', 52, 4)!;
      return { st, g, a, b, c, ids: () => g().fenceDesign!.blocks.map((x) => x.id) };
    };

    it('picks a block, and picking a plant, an element or the hive lets go of it (and the other way round)', () => {
      const { g, b } = setup();
      g().selectFenceBlock(b);
      expect(g().fenceBlockId).toBe(b);
      g().select('anything');
      expect(g().fenceBlockId).toBeNull();
      g().selectFenceBlock(b);
      expect(g().selectedId).toBeNull();
      g().selectHive(true);
      expect(g().fenceBlockId).toBeNull();
      g().selectFenceBlock(b);
      g().selectFenceBlock(null);
      expect(g().fenceBlockId).toBeNull();
    });

    it('moves a block along the fence as its center passes its neighbors, one undo step for the whole drag', () => {
      const { g, a, b, c, ids } = setup();
      const undoDepth = () => g().history.past.length;
      g().setFenceDragging(true);
      const d0 = undoDepth();
      g().dragFenceBlock(a, 44); // center still on its own block: nothing changes
      expect(ids()).toEqual([a, b, c]);
      expect(undoDepth()).toBe(d0); // a plain click leaves no step
      g().dragFenceBlock(a, 51); // past the redwood block's center (50)
      expect(ids()).toEqual([b, a, c]);
      g().dragFenceBlock(a, 60); // past the cedar block's center too
      expect(ids()).toEqual([b, c, a]);
      g().setFenceDragging(false);
      expect(undoDepth()).toBe(d0 + 1);
      g().undo();
      expect(ids()).toEqual([a, b, c]); // the whole drag was one step, back to before it
    });

    it('does not drag in view mode', () => {
      const { st, a, ids } = setup();
      st.setState({ mode: 'view' });
      st.getState().setFenceDragging(true);
      expect(st.getState().fenceDragging).toBe(false);
      st.getState().dragFenceBlock(a, 60);
      expect(ids()[0]).toBe(a);
    });
  });

  describe('shuffling the blocks', () => {
    const d = none({ blocks: [blk('a', 'hog', 30, 8), blk('b', 'redwood', 38, 2), blk('c', 'cedar', 40, 4), blk('d', 'hog', 44, 12)] });
    const sig = (x: FenceDesign) => x.blocks.map((b) => `${b.id}@${b.atFt}`).join();

    it('keeps the same blocks, one after another from where the first began, in a new order', () => {
      const s = shuffleBlocks(d, 3, cfg, run.lengthFt);
      expect(s.blocks.map((b) => b.id).sort()).toEqual(['a', 'b', 'c', 'd']);
      expect(s.blocks[0].atFt).toBe(30);
      s.blocks.slice(1).forEach((b, i) => expect(b.atFt).toBeCloseTo(s.blocks[i].atFt + s.blocks[i].widthFt, 9));
      expect(s.blocks.reduce((a, b) => a + b.widthFt, 0)).toBe(26);
      expect(sig(s)).not.toBe(sig(d));
    });

    it('gives the same order for the same seed, and different orders for different seeds', () => {
      expect(sig(shuffleBlocks(d, 5, cfg, run.lengthFt))).toBe(sig(shuffleBlocks(d, 5, cfg, run.lengthFt)));
      const seen = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((n) => sig(shuffleBlocks(d, n, cfg, run.lengthFt))));
      expect(seen.size).toBeGreaterThan(3);
    });

    it('leaves one block alone', () => {
      const one = none({ blocks: [blk('a', 'hog', 30, 8)] });
      expect(shuffleBlocks(one, 1, cfg, run.lengthFt).blocks).toEqual(one.blocks);
    });
  });

  it('sets climbing plants along the wire panels, a foot into the yard, species taking turns', () => {
    const d = none({ blocks: [{ ...blk('a', 'hog', 20, 8), climbers: true }, blk('b', 'cedar', 28, 4), { ...blk('c', 'hog', 32, 8), climbers: true }], vines: ['trachelospermum-jasminoides', 'passiflora-edulis-frederick'], vineSpacingFt: 4 });
    const l = fenceLayout(d, run.lengthFt, cfg);
    const spots = vineSpots(d, run.a, run.b, cfg, l);
    expect(spots.length).toBe(4); // two on each panel, none on the boards between
    expect(spots.map((s) => s.speciesId)).toEqual(['trachelospermum-jasminoides', 'passiflora-edulis-frederick', 'trachelospermum-jasminoides', 'passiflora-edulis-frederick']);
    for (const s of spots) { expect(s.at[0]).toBeCloseTo(cfg.vine.offsetFt, 9); expect(s.at[1]).toBeCloseTo(run.a[1] + s.along, 9); expect(s.along < 28 || s.along > 32).toBe(true); }
    expect(vineSpots({ ...d, vines: [] }, run.a, run.b, cfg, l)).toEqual([]);
  });

  it('plants only the panels that have climbing plants switched on, so any panel can have them or not', () => {
    const d = none({ blocks: [blk('a', 'hog', 20, 8), { ...blk('b', 'hog', 28, 8), climbers: true }, blk('c', 'cattle', 36, 8)], vines: ['jasminum-polyanthum'], vineSpacingFt: 4 });
    const l = fenceLayout(d, run.lengthFt, cfg);
    const spots = vineSpots(d, run.a, run.b, cfg, l);
    expect(spots.map((x) => x.along)).toEqual([30, 34]); // the middle panel only
    expect(vineSpots({ ...d, blocks: d.blocks.map((b) => ({ ...b, climbers: false })) }, run.a, run.b, cfg, l)).toEqual([]);
    // boards never take climbers, even if the flag is set
    expect(sanitizeFenceDesign({ blocks: [{ id: 'x', material: 'cedar', atFt: 10, widthFt: 4, climbers: true }] }, cfg, run.lengthFt).blocks[0].climbers).toBeUndefined();
  });

  it('switches climbing plants on and off one panel at a time in the app, keeping the age of plants that stay', () => {
    const st = makeAppStore('edit');
    const g = () => st.getState();
    g().setFenceCustom(true);
    for (const b of [...g().fenceDesign!.blocks]) g().removeFenceBlock(b.id);
    const a = g().addFenceBlock('hog', 90, 8)!, b = g().addFenceBlock('hog', 98, 8)!;
    g().patchFenceDesign({ vines: ['trachelospermum-jasminoides'], vineSpacingFt: 4 });
    const fv = () => g().instances.filter((i) => i.id.startsWith('fv-'));
    expect(fv()).toHaveLength(0); // nothing is planted until a panel asks for it
    g().updateFenceBlock(a, { climbers: true });
    expect(fv().map((i) => i.position[1])).toEqual([112, 116]);
    g().setTimelineMonth(24);
    g().updateFenceBlock(b, { climbers: true });
    expect(fv()).toHaveLength(4);
    expect(fv().filter((i) => i.plantedMonth === 0)).toHaveLength(2); // the first panel's plants kept their age
    expect(fv().filter((i) => i.plantedMonth === 24)).toHaveLength(2);
    g().updateFenceBlock(a, { climbers: false });
    expect(fv().map((i) => i.position[1])).toEqual([120, 124]);
    g().applyFenceVines(); // every panel
    expect(fv()).toHaveLength(4);
    g().clearFenceVines();
    expect(fv()).toHaveLength(0);
    expect(g().fenceDesign!.blocks.every((x) => !x.climbers)).toBe(true);
  });

  it('allows a 2 ft hog wire panel, with a climbing plant mid-panel when the spacing is wider', () => {
    const d = none({ blocks: [{ ...blk('a', 'hog', 40, 2), climbers: true }], vines: ['jasminum-polyanthum'], vineSpacingFt: 4 });
    expect(sanitizeFenceDesign(d, cfg, run.lengthFt).blocks[0].widthFt).toBe(2);
    const l = fenceLayout(d, run.lengthFt, cfg);
    expect(l.panels[0]).toMatchObject({ from: 40, to: 42, verticals: 7 }); // 24 in / 4 in + 1
    expect(vineSpots(d, run.a, run.b, cfg, l).map((x) => x.along)).toEqual([41]);
  });

  it('plants beside the driveway too, rooting closer to the fence in the strip between them, and skips only what is on the driveway', () => {
    const st = makeAppStore('edit');
    const g = () => st.getState();
    g().setFenceCustom(true);
    for (const b of [...g().fenceDesign!.blocks]) g().removeFenceBlock(b.id);
    const a = g().addFenceBlock('hog', 30, 8)!; // y 50 to 58: the front yard's side, along the driveway
    g().patchFenceDesign({ vines: ['trachelospermum-jasminoides'], vineSpacingFt: 4 });
    g().updateFenceBlock(a, { climbers: true });
    const fv = g().instances.filter((i) => i.id.startsWith('fv-'));
    expect(fv).toHaveLength(2);
    for (const i of fv) expect(i.position[0]).toBeCloseTo(cfg.vine.tightOffsetFt, 9);
    const drive = (siteRaw.hardscape as { id: string; keepClear?: boolean; points: number[][] }[]).find((e) => e.keepClear)!;
    const minX = Math.min(...drive.points.map((p) => p[0]));
    expect(cfg.vine.tightOffsetFt).toBeLessThan(minX); // short of the driveway's edge
    // out in the back yard, where nothing is in the way, they root the usual distance out
    const b = g().addFenceBlock('hog', 75, 8)!;
    g().updateFenceBlock(b, { climbers: true });
    expect(g().instances.filter((i) => i.id.startsWith('fv-') && i.position[1] > 90).every((i) => Math.abs(i.position[0] - cfg.vine.offsetFt) < 1e-9)).toBe(true);
  });

  it('gives wire panels an optional wooden top piece: for every panel, or one at a time', () => {
    const d = none({ blocks: [blk('a', 'hog', 20, 8), { ...blk('b', 'cattle', 28, 8), topPiece: true }, { ...blk('c', 'welded', 36, 8), topPiece: false }] });
    const t = cfg.wireTop.thicknessIn / 12;
    const panels = (x: typeof d) => fenceLayout(x, run.lengthFt, cfg).panels;
    expect(panels(d).map((p) => p.topPiece)).toEqual([false, true, false]); // only the one that asked
    expect(panels({ ...d, wireTop: true }).map((p) => p.topPiece)).toEqual([true, true, false]); // every panel, except the one that opted out
    const withTop = panels(d)[1];
    expect(withTop.topFt).toBeCloseTo(withTop.bottomFt + withTop.heightFt + t, 9);
    expect(panels(d)[0].topFt).toBeCloseTo(panels(d)[0].bottomFt + panels(d)[0].heightFt, 9);
    // the post beside it stands above the wood, and the sun model sees the added height
    const l = fenceLayout(d, run.lengthFt, cfg);
    const tallest = (x: number) => l.postHeights[l.posts.findIndex((p) => Math.abs(p - x) < 1e-6)];
    expect(tallest(36)).toBeGreaterThanOrEqual(withTop.topFt + cfg.postRiseFt - 1e-9);
    expect(fenceSunPieces(d, run, cfg).find((p) => p.id.endsWith('~' + l.segments.findIndex((sg) => sg.blockId === 'b')))!.height).toBeCloseTo(withTop.topFt, 9);
    // boards never take one
    expect(sanitizeFenceDesign({ blocks: [{ id: 'x', material: 'cedar', atFt: 10, widthFt: 4, topPiece: true }], wireTop: true }, cfg, run.lengthFt).blocks[0].topPiece).toBeUndefined();
    expect(sanitizeFenceDesign({ wireTop: 'yes' }, cfg, run.lengthFt).wireTop).toBe(false);
  });

  it('has real climbing species to choose: jasmine and passion fruit', () => {
    const ids = lib.species.filter((s) => s.habit === 'vine').map((s) => s.id);
    for (const id of ['trachelospermum-jasminoides', 'jasminum-polyanthum', 'passiflora-edulis-frederick']) expect(ids).toContain(id);
  });

  it('lets light through in the sun model', () => {
    const s2 = { ...site, contextObjects: site.contextObjects.map((o) => (o.id === cfg.targetId ? { ...o, density: 0.7 } : o)) };
    const dens = (st: typeof site) => buildSunScene(st, { aduEnabled: true }, engine, []).solids.filter((x) => x.id.startsWith('fence-west')).map((x) => x.density);
    expect(dens(site).every((v) => v === 1)).toBe(true);
    expect(dens(s2).every((v) => v === 0.7)).toBe(true);
  });

  describe('in the app', () => {
    it('adds, changes, moves, shuffles and removes blocks, and the vines follow the panels, one undo each', () => {
      const st = makeAppStore('edit');
      const g = () => st.getState();
      expect(g().fenceDesign).toBeNull();
      const before = g().instances.length;
      g().setFenceCustom(true);
      expect(g().fenceDesign!.blocks.length).toBe(cfg.defaultBlocks.length);
      for (const b of [...g().fenceDesign!.blocks]) g().removeFenceBlock(b.id);
      expect(g().fenceDesign!.blocks).toHaveLength(0);
      const id = g().addFenceBlock('hog', 100)!;
      expect(g().fenceDesign!.blocks[0]).toMatchObject({ id, material: 'hog', atFt: 100, widthFt: 2 });
      g().updateFenceBlock(id, { widthFt: 8 });
      expect(g().fenceDesign!.blocks[0].widthFt).toBe(8);
      g().updateFenceBlock(id, { material: 'cedar' }); // a new material: its own sizes
      expect(g().fenceDesign!.blocks[0]).toMatchObject({ material: 'cedar', widthFt: 8 });
      expect(g().fenceDesign!.blocks[0].heightIn).toBeUndefined();
      g().updateFenceBlock(id, { material: 'hog' });
      const id2 = g().addFenceBlock('redwood')!; // after the last block
      expect(g().fenceDesign!.blocks.find((b) => b.id === id2)!.atFt).toBe(108);
      g().patchFenceDesign({ vines: ['trachelospermum-jasminoides'], vineSpacingFt: 4 });
      expect(g().applyFenceVines()).toBe(2);
      g().moveFenceBlock(id, 1); // trade places with the redwood block
      expect(g().fenceDesign!.blocks.map((b) => b.id)).toEqual([id2, id]);
      expect(g().fenceDesign!.blocks[1].atFt).toBe(102);
      // the plants followed the panel
      const ys = g().instances.filter((i) => i.id.startsWith('fv-')).map((i) => i.position[1]);
      expect(ys).toHaveLength(2);
      expect(Math.min(...ys)).toBeGreaterThan(20 + 102);
      g().shuffleFenceBlocks();
      expect(g().fenceShuffles).toBe(1);
      g().setFenceCustom(false);
      expect(g().fenceDesign).toBeNull();
      expect(g().instances.length).toBe(before);
      g().undo();
      expect(g().fenceDesign).not.toBeNull();
    });

    it('saves with the scenario and survives validation', () => {
      const d = { ...emptyScenarioData(site), fenceDesign: defaultFenceDesign(cfg) };
      const out = validateScenarioData(JSON.parse(JSON.stringify(d)), ctx);
      expect(out.data?.fenceDesign?.blocks.length).toBe(cfg.defaultBlocks.length);
      expect(validateScenarioData({ ...d, fenceDesign: 'x' }, ctx).data?.fenceDesign).toBeNull();
    });
  });
});
