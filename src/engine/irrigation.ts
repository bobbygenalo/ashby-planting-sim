import { bbox, pointInPolygon } from './geometry';
import type { PlacedPlant } from './growth';
import { footprint, isStoop } from './hardscape';
import { raisedBedSoilTop } from './soil';
import { Heap } from './pathnet';
import { hydrozoneMixWarning, hydrozoneOf, WATER_ORDER } from './water';
import type { Confidence, EngineConfig, HardscapeElement, Hydrozone, Irrigation, Pt, StructureCfg, WaterConfig } from './types';

/** What a device does at a plant. `inline` is drip tubing laid in rings under a groundcover. */
export type DeviceKind = 'emitter' | 'bubbler' | 'spray' | 'rotor' | 'inline';
export type Method = DeviceKind | 'hand' | 'none';
/** Devices that can share a valve (different kinds need different pressure and flow). */
export type Family = 'drip' | 'bubbler' | 'spray' | 'rotor';

export interface IrrigationCfg {
  source: string;
  confidence: Confidence;
  gridFt: number;
  lotMarginFt: number;
  buildingClearFt: number;
  blockedTypes: string[];
  crossCost: Record<string, number>;
  keepClearCost: number;
  sharedTrenchFactor: number;
  terminalSearchFt: number;
  /** Once a valve has a run, a plant whose own branch off it would be longer than this is watered by hand. */
  maxSpurFt: number;
  /** A plant with no other irrigated plant or head within `isolatedNeighborFt`, and farther than `isolatedFromSourceFt` from the source, is watered by hand. */
  isolatedNeighborFt: number;
  isolatedFromSourceFt: number;
  /** A run from the manifold longer than this is flagged. */
  maxRunFt: number;
  /** Flow the supply can give at once, in gallons per hour; one valve over it is flagged. */
  supplyGph: number;
  byType: Record<string, 'emitter' | 'bubbler' | 'inline'>;
  emitter: { gph: number; areaPerEmitterSf: number; min: number; max: number; ringShare: number; tailMinFt: number };
  bubbler: { gph: number; ftPerBubbler: number; min: number; max: number; ringShare: number };
  inline: { gphPerFt: number; rowSpacingFt: number; ringShare: number };
  spray: { gph: number; coverageSf: number; ringShare: number };
  /** Drip in a raised bed: emitters on a grid in the soil, fed from one valve family shared by every bed set to drip. */
  bed: { emitterSpacingFt: number; gph: number; edgeInsetFt: number; category: string; hydrozoneName: string; searchMarginFt: number; plantFactor: number; plantFactorSource: string };
  schedule: {
    source: string; confidence: Confidence;
    daysPerWeek: Record<string, number>; bedDaysPerWeek: number;
    maxRunMin: Record<Family, number>; minRunMin: number; gapMin: number;
    windows: { startMin: number; endMin: number }[]; windowNote: string;
  };
  flow: {
    dropFt: number; dropFallFt: number; dropEveryS: number;
    bubblerRiseFt: number; sprayReachFt: number; rotorReachFt: number;
    sprayParticles: number; rotorParticles: number; bubblerParticles: number;
    dropColor: string;
  };
  lawn: { sprayGph: number; spraySpacingFt: number; rotorGph: number; rotorSpacingFt: number; rotorMinAreaSf: number; headInsetFt: number };
  valveMaxGph: Record<Family, number>;
  splitStripFt: number;
  lineSizes: { inches: number; maxGph: number; label: string }[];
  supplyLineInches: number;
  controllerStations: number[];
  prices: {
    status: 'stand-in';
    note: string;
    valve: number;
    backflow: number;
    filterRegulator: number;
    controller: Record<string, number>;
    emitter: number;
    bubbler: number;
    sprayHead: number;
    rotorHead: number;
    inlinePerFt: number;
    microTubingPerFt: number;
    linePerFt: Record<string, number>;
    fittingsShare: number;
  };
  draw: {
    ribbonFt: Record<string, number>;
    tailFt: number;
    liftFt: number;
    emitterFt: number;
    bubblerFt: number;
    sprayFt: number;
    rotorFt: number;
    manifoldFt: number;
    layerStepFt: number;
    /** Valve labels sit at least this far apart along the lines. */
    labelGapFt: number;
    /** Every line is this light blue; while its valve runs, waves of `lineFlowColor` travel out from the manifold, `waveLengthFt` apart at `waveSpeedFtS`. */
    lineColor: string;
    lineFlowColor: string;
    /** Emitters, bubblers and heads: a mid blue that stands out on the light lines. */
    deviceColor: string;
    waveLengthFt: number;
    waveSpeedFtS: number;
    /** Ribbons are cut into pieces this long so the waves show along a straight run. */
    wavePieceFt: number;
    handRingFt: number;
    valveColors: string[];
    handColor: string;
  };
}

export interface WaterSource {
  id: string;
  label: string;
  /** Short name used in valve names when there is more than one access. */
  short?: string;
  point: Pt;
}

export interface IrrigationInput {
  plants: PlacedPlant[];
  elements: HardscapeElement[];
  structures: StructureCfg[];
  lot: { width: number; depth: number };
  /** Water accesses (hose bibs): each has its own manifold, supply line and valves. The one nearer by cheapest route serves a plant. */
  sources: WaterSource[];
  hydrozones: Hydrozone[];
  autoIrrigation: Record<string, Irrigation>;
  water: WaterConfig;
  hardscapeCfg: EngineConfig['hardscape'];
  /** Inches a raised bed's soil stops below its rim (`soil.raisedBed.freeboardIn`), for the height the drip lies at. */
  soilFreeboardIn: number;
  /** True when every raised bed is on drip; false leaves them all to hand watering. */
  bedsOnDrip: boolean;
  cfg: IrrigationCfg;
}

export interface Device {
  kind: DeviceKind;
  at: Pt;
  /** Height of the soil surface the device sits on when it is in a raised bed (the scene draws it there, not on the ground). */
  z?: number;
  gph: number;
  /** Inline drip: feet of tubing, and the ring it is drawn as. */
  lengthFt?: number;
  ringFt?: number;
  /** The plant it waters, or null for a lawn head. */
  plantId: string | null;
}

export interface Run {
  valveId: string;
  sizeInches: number;
  points: Pt[];
  /** Feet of line from the manifold to the run's first point, so water can be drawn travelling out from the manifold. */
  fromFt: number;
}

export interface Valve {
  id: string;
  name: string;
  /** The water access it is fed from. */
  sourceId: string;
  hydrozoneId: string;
  hydrozoneName: string;
  family: Family;
  /** Water-use categories of the plants on it. */
  categories: string[];
  plantIds: string[];
  devices: Device[];
  /** Short micro-tubing from each plant's tap to its emitters, bubblers and heads. */
  tails: { from: Pt; to: Pt; z?: number; /** Feet of line from the manifold to `from`. */ s?: number }[];
  /** Raised beds this valve waters. */
  bedIds: string[];
  /** Gallons per hour this valve gives each lawn it waters (a lawn's heads can be split over several valves). */
  lawnGph: Record<string, number>;
  runs: Run[];
  gph: number;
  linesFt: Record<string, number>;
  tailFt: number;
  inlineFt: number;
  /** Longest run from the manifold to a tap, in feet. */
  longestRunFt: number;
  warning: string | null;
  color: string;
  /** Middle of what it waters. */
  center: Pt;
  /** Where its label sits: on one of its own lines, a good way from the other valves' labels (`labelOnLines`). */
  labelAt: Pt;
}

export interface PlantRow {
  /** Plant instance id, or the lawn element's id. */
  id: string;
  label: string;
  at: Pt;
  method: Method;
  valveId: string | null;
  hydrozoneId: string;
  deviceCount: number;
  gph: number;
  runFt: number;
  /** Half its canopy width (0 for a lawn), for drawing a ring round a hand-watered plant. */
  radiusFt: number;
  /** Why it is watered by hand or not at all, when it is. */
  reason: string | null;
}

export interface Warning {
  severity: 'warn' | 'info';
  text: string;
  plantId?: string;
  valveId?: string;
}

export interface PartRow {
  id: string;
  label: string;
  quantity: number;
  unit: 'each' | 'ft';
  unitPrice: number;
  total: number;
}

export interface PlanSource extends WaterSource {
  /** Where its valve manifold stands: the nearest clear spot to the access. */
  manifold: Pt;
  valveIds: string[];
}

export interface IrrigationPlan {
  sources: PlanSource[];
  valves: Valve[];
  plants: PlantRow[];
  /** Plants outside raised beds that are hand-watered or left dry (a subset of `plants`). */
  hand: PlantRow[];
  /** Plants that stand in a raised bed (they are watered with their bed, by drip or by hand). */
  excludedRaisedBed: number;
  /** Every raised bed in the plan: set to drip (with its valve) or left to hand watering. */
  beds: PlantRow[];
  warnings: Warning[];
  /** The supply line from each water access to its manifold (only for accesses that have valves). */
  supplies: { sourceId: string; from: Pt; to: Pt; sizeInches: number }[];
  totals: {
    zones: number;
    valves: number;
    emitters: number;
    bubblers: number;
    sprayHeads: number;
    rotorHeads: number;
    inlineFt: number;
    tailFt: number;
    linesFt: Record<string, number>;
    gph: number;
    handPlants: number;
    controllerStations: number;
  };
  parts: PartRow[];
  cost: number;
}

export const familyOf = (k: DeviceKind): Family => (k === 'emitter' || k === 'inline' ? 'drip' : k);
export const FAMILY_LABEL: Record<Family, string> = { drip: 'Drip', bubbler: 'Bubblers', spray: 'Spray', rotor: 'Rotors' };
export const METHOD_LABEL: Record<Method, string> = {
  emitter: 'Drip emitters', bubbler: 'Bubblers', spray: 'Spray heads', rotor: 'Rotor heads', inline: 'Inline drip', hand: 'Hand watering', none: 'Not irrigated',
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A small stable number from a string, for turning a ring of emitters by a different amount at each plant. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/** The method a plant's hydrozone and kind call for. */
export function methodFor(type: string, hydrozoneIrrigation: Irrigation, cfg: IrrigationCfg): Method {
  if (hydrozoneIrrigation === 'none') return 'none';
  if (hydrozoneIrrigation === 'hand') return 'hand';
  if (hydrozoneIrrigation === 'spray') return 'spray';
  return cfg.byType[type] ?? 'emitter';
}

/** Devices for one plant at its current size. */
export function plantDevices(p: PlacedPlant, method: Method, cfg: IrrigationCfg): Device[] {
  const [x, y] = p.inst.position;
  const w = Math.max(p.size.width, 0.5);
  const r = w / 2;
  const area = Math.PI * r * r;
  const turn = hash(p.inst.id) * Math.PI * 2;
  const ring = (n: number, share: number, kind: DeviceKind, gph: number): Device[] =>
    Array.from({ length: n }, (_, i) => {
      const a = turn + (i / n) * Math.PI * 2;
      const rr = n === 1 ? 0 : Math.max(r * share, cfg.emitter.tailMinFt);
      return { kind, at: [x + Math.cos(a) * rr, y + Math.sin(a) * rr] as Pt, gph, plantId: p.inst.id };
    });
  switch (method) {
    case 'bubbler': {
      const n = clamp(Math.ceil(w / cfg.bubbler.ftPerBubbler), cfg.bubbler.min, cfg.bubbler.max);
      return ring(n, cfg.bubbler.ringShare, 'bubbler', cfg.bubbler.gph);
    }
    case 'emitter': {
      const n = clamp(Math.ceil(area / cfg.emitter.areaPerEmitterSf), cfg.emitter.min, cfg.emitter.max);
      return ring(n, cfg.emitter.ringShare, 'emitter', cfg.emitter.gph);
    }
    case 'spray': {
      const n = Math.max(1, Math.ceil(area / cfg.spray.coverageSf));
      return ring(n, cfg.spray.ringShare, 'spray', cfg.spray.gph);
    }
    case 'inline': {
      const ringFt = Math.max(r * cfg.inline.ringShare, 0.5);
      const lengthFt = Math.max(area / cfg.inline.rowSpacingFt, 2);
      return [{ kind: 'inline', at: [x, y], gph: lengthFt * cfg.inline.gphPerFt, lengthFt, ringFt, plantId: p.inst.id }];
    }
    default:
      return [];
  }
}

/** Heads on a grid inside a lawn: sprays, or rotors for a lawn big enough. */
export function lawnHeads(poly: Pt[], areaSf: number, cfg: IrrigationCfg): Device[] {
  const rotor = areaSf >= cfg.lawn.rotorMinAreaSf;
  const sp = rotor ? cfg.lawn.rotorSpacingFt : cfg.lawn.spraySpacingFt;
  const kind: DeviceKind = rotor ? 'rotor' : 'spray';
  const gph = rotor ? cfg.lawn.rotorGph : cfg.lawn.sprayGph;
  const b = bbox(poly);
  const inset = cfg.lawn.headInsetFt;
  const inside = (x: number, y: number) => {
    if (!pointInPolygon(x, y, poly)) return false;
    // keep heads off the very edge: a point inset from each side must also be inside
    return [[inset, 0], [-inset, 0], [0, inset], [0, -inset]].every(([dx, dy]) => pointInPolygon(x + dx, y + dy, poly));
  };
  const nx = Math.max(1, Math.round((b.maxX - b.minX) / sp)), ny = Math.max(1, Math.round((b.maxY - b.minY) / sp));
  const out: Device[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = b.minX + ((i + 0.5) * (b.maxX - b.minX)) / nx, y = b.minY + ((j + 0.5) * (b.maxY - b.minY)) / ny;
    if (inside(x, y)) out.push({ kind, at: [x, y], gph, plantId: null });
  }
  if (out.length === 0) {
    // a lawn too small or narrow for the grid still gets one head at the point most inside it
    const cx = poly.reduce((a, q) => a + q[0], 0) / poly.length, cy = poly.reduce((a, q) => a + q[1], 0) / poly.length;
    out.push({ kind, at: [cx, cy], gph, plantId: null });
  }
  return out;
}

interface Item {
  /** Index of the water access that serves it (set once the accesses are known). */
  src?: number;
  id: string;
  label: string;
  at: Pt;
  hz: { id: string; name: string };
  category: string;
  family: Family;
  devices: Device[];
  gph: number;
  /** A lawn head is its own tap; a plant has one tap for all its devices. */
  lawnId?: string;
  /** A raised bed on drip: one tap for the whole bed, the drip lines drawn at the soil surface. */
  bed?: { id: string; poly: Pt[]; soilZ: number; searchFt: number };
}

const STEP8: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * Suggest an irrigation layout for the plants and lawns that are not in raised beds. Plants are grouped by hydrozone
 * and device family, one valve per group (split when a valve would carry more flow than `valveMaxGph`), all valves at
 * a manifold by the hose bib. Each valve's lines grow like a spanning tree from the manifold by cheapest route on a
 * 1 ft grid (keeping off buildings, raised beds and the lot edge, crossing paving only at a high cost and sharing
 * trenches with earlier valves); a line's size follows the flow downstream of it. Deterministic.
 */
export function planIrrigation(inp: IrrigationInput): IrrigationPlan {
  const { cfg, lot, hardscapeCfg: hs } = inp;
  const g = cfg.gridFt;
  const cols = Math.ceil(lot.width / g), rows = Math.ceil(lot.depth / g);
  const N = cols * rows;
  const cx = (i: number) => ((i % cols) + 0.5) * g;
  const cy = (i: number) => (Math.floor(i / cols) + 0.5) * g;

  // --- cost grid
  const cellCost = new Float64Array(N).fill(1);
  const paint = (poly: Pt[], v: number) => {
    if (poly.length < 3) return;
    const b = bbox(poly);
    const i0 = Math.max(0, Math.floor(b.minX / g)), i1 = Math.min(cols - 1, Math.floor(b.maxX / g));
    const j0 = Math.max(0, Math.floor(b.minY / g)), j1 = Math.min(rows - 1, Math.floor(b.maxY / g));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (pointInPolygon((i + 0.5) * g, (j + 0.5) * g, poly)) cellCost[j * cols + i] = v;
    }
  };
  const live = inp.elements.filter((e) => !e.removed).sort((a, b) => hs.drawOrder.indexOf(a.type) - hs.drawOrder.indexOf(b.type));
  for (const el of live) {
    const poly = footprint(el, hs);
    if (cfg.blockedTypes.includes(el.type) || isStoop(el, hs)) paint(poly, Infinity);
    else if (el.keepClear) paint(poly, cfg.keepClearCost);
    else if (cfg.crossCost[el.type] !== undefined) paint(poly, cfg.crossCost[el.type]);
  }
  const m = cfg.lotMarginFt;
  for (let i = 0; i < N; i++) {
    const x = cx(i), y = cy(i);
    if (x < m || y < m || x > lot.width - m || y > lot.depth - m) cellCost[i] = Infinity;
  }
  for (const s of inp.structures) {
    const b = bbox(s.footprint);
    const pad = cfg.buildingClearFt;
    const i0 = Math.max(0, Math.floor((b.minX - pad) / g)), i1 = Math.min(cols - 1, Math.floor((b.maxX + pad) / g));
    const j0 = Math.max(0, Math.floor((b.minY - pad) / g)), j1 = Math.min(rows - 1, Math.floor((b.maxY + pad) / g));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = (i + 0.5) * g, y = (j + 0.5) * g;
      if (pointInPolygon(x, y, s.footprint) || nearPolygon(x, y, s.footprint, pad)) cellCost[j * cols + i] = Infinity;
    }
  }
  const free = (k: number) => Number.isFinite(cellCost[k]);
  const nearestFree = (p: Pt, within: number): number => {
    let best = -1, bd = within + 1e-9;
    const r = Math.ceil(within / g);
    const ci = Math.floor(p[0] / g), cj = Math.floor(p[1] / g);
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
      const k = j * cols + i;
      if (!free(k)) continue;
      const d = Math.hypot(cx(k) - p[0], cy(k) - p[1]);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  };

  // --- water accesses: each one's manifold spot, and the cheapest-route distance from it to every clear cell
  const srcList = inp.sources;
  const roots = srcList.map((s) => {
    const cell = nearestFree(s.point, 12);
    return { ...s, cell, manifold: (cell >= 0 ? [cx(cell), cy(cell)] : s.point) as Pt };
  });
  const reach = (start: number): Float64Array => {
    const d = new Float64Array(N).fill(Infinity);
    if (start < 0) return d;
    const heap = new Heap();
    d[start] = 0;
    heap.push(0, start);
    while (heap.size > 0) {
      const [dc, c] = heap.pop();
      if (dc > d[c]) continue;
      const ci = c % cols, cj = (c - ci) / cols;
      for (const [dx, dy] of STEP8) {
        const ni = ci + dx, nj = cj + dy;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const n = nj * cols + ni;
        if (!free(n)) continue;
        if (dx !== 0 && dy !== 0 && (!free(cj * cols + ni) || !free(nj * cols + ci))) continue;
        const step = dx !== 0 && dy !== 0 ? Math.SQRT2 * g : g;
        const nd = dc + step * ((cellCost[c] + cellCost[n]) / 2);
        if (nd < d[n]) { d[n] = nd; heap.push(nd, n); }
      }
    }
    return d;
  };
  const reachBy = roots.map((r) => (roots.length > 1 ? reach(r.cell) : new Float64Array(0)));
  /** The access that reaches a spot by the cheapest route (the nearer one by straight line when none can reach it). */
  const sourceFor = (at: Pt, searchFt: number): number => {
    if (roots.length === 1) return 0;
    const k = nearestFree(at, searchFt);
    let best = -1, bd = Infinity;
    if (k >= 0) roots.forEach((_, i) => { if (reachBy[i][k] < bd) { bd = reachBy[i][k]; best = i; } });
    if (best >= 0) return best;
    roots.forEach((r, i) => { const d = Math.hypot(r.point[0] - at[0], r.point[1] - at[1]); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const nearestSourceFt = (at: Pt) => Math.min(...srcList.map((s) => Math.hypot(s.point[0] - at[0], s.point[1] - at[1])));

  // --- what to water
  const beds = live.filter((e) => e.type === 'raisedBed').map((e) => footprint(e, hs));
  const warnings: Warning[] = [];
  const plants: PlantRow[] = [];
  const items: Item[] = [];
  let excludedRaisedBed = 0;
  for (const p of inp.plants) {
    const [x, y] = p.inst.position;
    if (beds.some((b) => pointInPolygon(x, y, b))) { excludedRaisedBed++; continue; }
    const hz = hydrozoneOf(p.inst, p.species, inp.hydrozones, inp.autoIrrigation, inp.water);
    const method = methodFor(p.species.type, hz.irrigation, cfg);
    const base: PlantRow = {
      id: p.inst.id, label: p.species.common, at: [x, y], method, valveId: null, hydrozoneId: hz.id, deviceCount: 0, gph: 0, runFt: 0, radiusFt: p.size.width / 2, reason: null,
    };
    if (method === 'hand' || method === 'none') {
      base.reason = method === 'hand' ? `Its hydrozone (${hz.name}) is set to hand watering.` : `Its hydrozone (${hz.name}) is set to no irrigation.`;
      plants.push(base);
      continue;
    }
    const devices = plantDevices(p, method, cfg);
    const gph = devices.reduce((a, d) => a + d.gph, 0);
    plants.push({ ...base, deviceCount: devices.length, gph });
    items.push({ id: p.inst.id, label: p.species.common, at: [x, y], hz: { id: hz.id, name: hz.name }, category: p.species.wucols, family: familyOf(devices[0].kind), devices, gph });
  }
  const lawnIrr = inp.autoIrrigation['auto:lawn'] ?? inp.water.lawn.irrigation;
  for (const el of live) {
    if (el.type !== 'lawn') continue;
    const poly = footprint(el, hs);
    const area = Math.abs(poly.reduce((a, q, i) => { const n = poly[(i + 1) % poly.length]; return a + q[0] * n[1] - n[0] * q[1]; }, 0)) / 2;
    const label = el.name ?? 'Lawn';
    if (lawnIrr === 'hand' || lawnIrr === 'none') {
      plants.push({ id: el.id, label, at: poly[0], method: lawnIrr, valveId: null, hydrozoneId: 'auto:lawn', deviceCount: 0, gph: 0, runFt: 0, radiusFt: 0, reason: `Lawn irrigation is set to ${lawnIrr === 'hand' ? 'hand watering' : 'none'}.` });
      continue;
    }
    const heads = lawnHeads(poly, area, cfg);
    for (const [i, h] of heads.entries()) {
      items.push({ id: `${el.id}#${i}`, label, at: h.at, hz: { id: 'auto:lawn', name: 'Lawn (automatic)' }, category: 'high', family: familyOf(h.kind), devices: [h], gph: h.gph, lawnId: el.id });
    }
    plants.push({ id: el.id, label, at: poly[0], method: heads[0].kind, valveId: null, hydrozoneId: 'auto:lawn', deviceCount: heads.length, gph: heads.reduce((a, d) => a + d.gph, 0), runFt: 0, radiusFt: 0, reason: null });
  }

  // raised beds: each one is set to drip (emitters in the soil, one tap at its edge) or left to hand watering
  const bedRows: PlantRow[] = [];
  const freeboardIn = inp.soilFreeboardIn;
  for (const el of live) {
    if (el.type !== 'raisedBed' || el.existing) continue;
    const poly = footprint(el, hs);
    const label = el.name ?? 'Raised bed';
    const b = bbox(poly);
    const mid: Pt = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
    const base: PlantRow = { id: el.id, label, at: mid, method: 'hand', valveId: null, hydrozoneId: 'auto:bed', deviceCount: 0, gph: 0, runFt: 0, radiusFt: 0, reason: 'Raised beds are left to hand watering: the people water it with cans.' };
    if (!inp.bedsOnDrip) { bedRows.push(base); continue; }
    const soilZ = raisedBedSoilTop(el.height, freeboardIn);
    const emitters = bedEmitters(poly, cfg);
    const devices: Device[] = emitters.map((at) => ({ kind: 'emitter' as const, at, z: soilZ, gph: cfg.bed.gph, plantId: null }));
    const gph = devices.reduce((a, d) => a + d.gph, 0);
    bedRows.push({ ...base, method: 'emitter', deviceCount: devices.length, gph, reason: null });
    items.push({
      id: el.id, label, at: mid, hz: { id: 'auto:bed', name: cfg.bed.hydrozoneName }, category: cfg.bed.category, family: 'drip', devices, gph,
      bed: { id: el.id, poly, soilZ, searchFt: Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2 + cfg.bed.searchMarginFt },
    });
  }

  // an irrigated plant standing alone, far from the source, is not worth a run of line
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.lawnId || it.bed) continue;
    const far = nearestSourceFt(it.at) > cfg.isolatedFromSourceFt;
    if (!far || items.some((o) => o !== it && Math.hypot(o.at[0] - it.at[0], o.at[1] - it.at[1]) <= cfg.isolatedNeighborFt)) continue;
    const row = plants.find((r) => r.id === it.id)!;
    Object.assign(row, { method: 'hand', deviceCount: 0, gph: 0, reason: `It stands alone, more than ${cfg.isolatedNeighborFt} ft from any other plant and ${Math.round(nearestSourceFt(it.at))} ft from the nearest hose bib, so a run of line to it is not worth it.` });
    warnings.push({ severity: 'info', plantId: it.id, text: `${it.label} is hand-watered: it stands alone, far from the hose bib.` });
    items.splice(i, 1);
  }

  // --- valves: one per hydrozone and device family, split when over the flow limit
  const orderOf = (id: string) => {
    const k = WATER_ORDER.findIndex((c) => id === `auto:${c}`);
    return id === 'auto:lawn' ? 99 : k >= 0 ? k : 50;
  };
  const groups = new Map<string, Item[]>();
  for (const it of items) {
    it.src = sourceFor(it.at, it.bed?.searchFt ?? cfg.terminalSearchFt);
    const key = `${it.src}|${it.hz.id}|${it.family}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(it);
  }
  const familyRank: Family[] = ['drip', 'bubbler', 'spray', 'rotor'];
  const keys = [...groups.keys()].sort((a, b) => {
    const [sa, ha, fa] = a.split('|'), [sb, hb, fb] = b.split('|');
    return Number(sa) - Number(sb) || orderOf(ha) - orderOf(hb) || ha.localeCompare(hb) || familyRank.indexOf(fa as Family) - familyRank.indexOf(fb as Family);
  });
  interface Draft { src: number; family: Family; hz: { id: string; name: string }; items: Item[]; label: string }
  const drafts: Draft[] = [];
  for (const key of keys) {
    const list = groups.get(key)!;
    const family = list[0].family, hz = list[0].hz, src = list[0].src ?? 0;
    const cap = cfg.valveMaxGph[family];
    const sorted = [...list].sort((a, b) => Math.floor(a.at[1] / cfg.splitStripFt) - Math.floor(b.at[1] / cfg.splitStripFt) || a.at[0] - b.at[0] || a.id.localeCompare(b.id));
    const chunks: Item[][] = [[]];
    let load = 0;
    for (const it of sorted) {
      if (load + it.gph > cap && chunks[chunks.length - 1].length > 0) { chunks.push([]); load = 0; }
      chunks[chunks.length - 1].push(it);
      load += it.gph;
    }
    chunks.forEach((c, i) => drafts.push({ src, family, hz, items: c, label: `${hz.name}, ${FAMILY_LABEL[family].toLowerCase()}${roots.length > 1 ? `, ${roots[src].short ?? roots[src].label}` : ''}${chunks.length > 1 ? ` (${i + 1} of ${chunks.length})` : ''}` }));
  }

  // --- routing
  const valves: Valve[] = [];
  const handExtra = new Map<string, string>(); // plant id -> reason
  const usedBy = roots.map(() => new Uint8Array(N)); // trenches are only shared by valves on the same access
  const rowById = new Map([...plants, ...bedRows].map((r) => [r.id, r]));
  const sizeFor = (gph: number) => cfg.lineSizes.find((s) => gph <= s.maxGph + 1e-9) ?? cfg.lineSizes[cfg.lineSizes.length - 1];

  for (const d of drafts) {
    const id = `V${valves.length + 1}`;
    const root = roots[d.src].cell;
    const used = usedBy[d.src];
    const color = cfg.draw.valveColors[valves.length % cfg.draw.valveColors.length];
    // terminals: the nearest free cell to each item's tap
    const term = new Map<number, Item[]>();
    for (const it of d.items) {
      const k = nearestFree(it.at, it.bed?.searchFt ?? cfg.terminalSearchFt);
      if (k < 0 || root < 0) { handExtra.set(it.id, 'Nothing clear to run a line through near it.'); continue; }
      (term.get(k) ?? term.set(k, []).get(k)!).push(it);
    }
    const inTree = new Uint8Array(N);
    const parent = new Int32Array(N).fill(-1);
    const along = new Float64Array(N); // feet of line from the manifold
    const treeCells: number[] = [];
    const attached: { cell: number; items: Item[] }[] = [];
    if (root >= 0 && term.size > 0) { inTree[root] = 1; treeCells.push(root); }
    const remaining = new Set(term.keys());
    const dist = new Float64Array(N), len = new Float64Array(N), from = new Int32Array(N);
    while (remaining.size > 0 && root >= 0) {
      dist.fill(Infinity);
      const heap = new Heap();
      for (const c of treeCells) { dist[c] = 0; len[c] = 0; from[c] = -1; heap.push(0, c); }
      let hit = -1;
      while (heap.size > 0) {
        const [dc, c] = heap.pop();
        if (dc > dist[c]) continue;
        if (remaining.has(c) && !inTree[c]) { hit = c; break; }
        const ci = c % cols, cj = (c - ci) / cols;
        for (const [dx, dy] of STEP8) {
          const ni = ci + dx, nj = cj + dy;
          if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
          const n = nj * cols + ni;
          if (!free(n)) continue;
          if (dx !== 0 && dy !== 0 && (!free(cj * cols + ni) || !free(nj * cols + ci))) continue; // no cutting corners
          const step = dx !== 0 && dy !== 0 ? Math.SQRT2 * g : g;
          const shared = used[n] ? cfg.sharedTrenchFactor : 1;
          const nd = dc + step * ((cellCost[c] + cellCost[n]) / 2) * shared;
          if (nd < dist[n]) { dist[n] = nd; len[n] = len[c] + step; from[n] = c; heap.push(nd, n); }
        }
      }
      if (hit < 0) {
        for (const c of remaining) for (const it of term.get(c)!) handExtra.set(it.id, 'No route to it that avoids the buildings and raised beds.');
        break;
      }
      remaining.delete(hit);
      const stuff = term.get(hit)!;
      if (attached.length > 0 && len[hit] > cfg.maxSpurFt) {
        for (const it of stuff) handExtra.set(it.id, `It is ${Math.round(len[hit])} ft of line from the nearest run, past the ${cfg.maxSpurFt} ft limit for one branch.`);
        continue;
      }
      // attach the path back to the tree
      const path: number[] = [];
      for (let c = hit; c >= 0 && !inTree[c]; c = from[c]) path.push(c);
      let prev = from[path[path.length - 1]];
      for (let i = path.length - 1; i >= 0; i--) {
        const c = path[i];
        parent[c] = prev;
        const step = Math.hypot(cx(c) - cx(prev), cy(c) - cy(prev));
        along[c] = along[prev] + step;
        inTree[c] = 1;
        treeCells.push(c);
        prev = c;
      }
      attached.push({ cell: hit, items: stuff });
    }
    const members = attached.flatMap((a) => a.items);
    if (members.length === 0) continue;

    // loads: the flow downstream of every cell
    const load = new Float64Array(N);
    for (const a of attached) {
      const f = a.items.reduce((s, it) => s + it.gph, 0);
      for (let c = a.cell; c >= 0; c = parent[c]) load[c] += f;
    }
    const kids = new Map<number, number[]>();
    for (const c of treeCells) if (c !== root) (kids.get(parent[c]) ?? kids.set(parent[c], []).get(parent[c])!).push(c);
    const sizeOfCell = (c: number) => sizeFor(load[c]).inches;
    const pt = (c: number): Pt => [cx(c), cy(c)];
    const runs: Run[] = [];
    const linesFt: Record<string, number> = {};
    for (const c of treeCells) {
      if (c === root) continue;
      const p = parent[c];
      const startsChain = p === root || (kids.get(p)?.length ?? 0) !== 1 || sizeOfCell(p) !== sizeOfCell(c);
      if (!startsChain) continue;
      const pts: Pt[] = [pt(p), pt(c)];
      let cur = c;
      for (;;) {
        const k = kids.get(cur);
        if (!k || k.length !== 1 || sizeOfCell(k[0]) !== sizeOfCell(cur)) break;
        cur = k[0];
        pts.push(pt(cur));
      }
      const simple = simplify(pts);
      const size = sizeOfCell(c);
      runs.push({ valveId: id, sizeInches: size, points: simple, fromFt: along[p] });
      linesFt[String(size)] = (linesFt[String(size)] ?? 0) + lengthOf(simple);
    }
    for (const a of attached) if (load[a.cell] > cfg.lineSizes[cfg.lineSizes.length - 1].maxGph) {
      warnings.push({ severity: 'warn', valveId: id, text: `${id} carries more flow than the largest line size takes; split it.` });
      break;
    }

    // devices and tails
    const devices: Device[] = [];
    const tails: { from: Pt; to: Pt; z?: number; s?: number }[] = [];
    const plantIds: string[] = [];
    const bedIds: string[] = [];
    const lawnGph: Record<string, number> = {};
    const cats: string[] = [];
    let longest = 0;
    let tailFt = 0, inlineFt = 0;
    for (const a of attached) {
      const tap = pt(a.cell);
      for (const it of a.items) {
        if (!cats.includes(it.category)) cats.push(it.category);
        const row = rowById.get(it.lawnId ?? it.id)!;
        if (it.lawnId) row.valveId = row.valveId === null ? id : row.valveId; else if (it.bed) { row.valveId = id; bedIds.push(it.id); } else { row.valveId = id; plantIds.push(it.id); }
        if (it.lawnId) lawnGph[it.lawnId] = (lawnGph[it.lawnId] ?? 0) + it.gph;
        row.runFt = Math.max(row.runFt, along[a.cell]);
        longest = Math.max(longest, along[a.cell]);
        if (along[a.cell] > cfg.maxRunFt) warnings.push({ severity: 'warn', valveId: id, plantId: it.lawnId || it.bed ? undefined : it.id, text: `${it.label} is ${Math.round(along[a.cell])} ft of line from the manifold, past ${cfg.maxRunFt} ft, so pressure may run low.` });
        if (it.bed) {
          // the line meets the bed's wall, then drip tubing is laid in rows across the soil
          const edge = nearestOnOutline(tap, it.bed.poly);
          devices.push(...it.devices);
          const lead = Math.hypot(edge[0] - tap[0], edge[1] - tap[1]);
          if (lead > 0.05) { tails.push({ from: tap, to: edge, s: along[a.cell] }); tailFt += lead; }
          let prev = edge;
          let sAt = along[a.cell] + lead;
          for (const dv of snakeOrder(it.devices)) {
            const t = Math.hypot(dv.at[0] - prev[0], dv.at[1] - prev[1]);
            if (t > 0.05) { tails.push({ from: prev, to: dv.at, z: it.bed.soilZ, s: sAt }); tailFt += t; sAt += t; }
            prev = dv.at;
          }
          continue;
        }
        for (const dv of it.devices) {
          devices.push(dv);
          if (dv.kind === 'inline') inlineFt += dv.lengthFt ?? 0;
          else {
            const t = Math.hypot(dv.at[0] - tap[0], dv.at[1] - tap[1]);
            if (t > 0.05) { tails.push({ from: tap, to: dv.at, s: along[a.cell] }); tailFt += t; }
          }
        }
      }
    }
    const gph = devices.reduce((s, dv) => s + dv.gph, 0);
    if (gph > cfg.supplyGph) warnings.push({ severity: 'warn', valveId: id, text: `${id} needs ${Math.round(gph)} gal/hr, more than the ${cfg.supplyGph} the supply is assumed to give at once.` });
    const mix = hydrozoneMixWarning(cats);
    if (mix) warnings.push({ severity: 'warn', valveId: id, text: `${id} (${d.hz.name}): ${mix}` });
    valves.push({
      id, name: d.label, sourceId: roots[d.src].id, hydrozoneId: d.hz.id, hydrozoneName: d.hz.name, family: d.family, categories: cats, plantIds, bedIds, lawnGph, devices, tails, runs, gph,
      linesFt, tailFt, inlineFt, longestRunFt: longest, warning: mix, color,
      center: [members.reduce((s, it) => s + it.at[0], 0) / members.length, members.reduce((s, it) => s + it.at[1], 0) / members.length],
      labelAt: [0, 0],
    });
    for (const c of treeCells) used[c] = 1;
  }

  placeLabels(valves, cfg.draw.labelGapFt);

  // plants that could not be routed are hand-watered
  for (const [pid, why] of handExtra) {
    const lawnId = pid.includes('#') ? pid.split('#')[0] : null;
    if (lawnId) {
      const row = rowById.get(lawnId);
      if (row && !warnings.some((w) => w.plantId === lawnId)) warnings.push({ severity: 'warn', plantId: lawnId, text: `Part of ${row.label} cannot be reached by a line: ${why}` });
      continue;
    }
    const row = rowById.get(pid);
    if (!row) continue;
    row.method = 'hand';
    row.valveId = null;
    row.deviceCount = 0;
    row.gph = 0;
    row.reason = why;
    warnings.push({ severity: 'warn', plantId: pid, text: `${row.label} is hand-watered: ${why}` });
  }

  // --- more notes
  const byHz = new Map<string, Set<Family>>();
  for (const v of valves) (byHz.get(v.hydrozoneId) ?? byHz.set(v.hydrozoneId, new Set()).get(v.hydrozoneId)!).add(v.family);
  for (const v of valves) {
    const fams = byHz.get(v.hydrozoneId)!;
    if (fams.size > 1 && v === valves.find((x) => x.hydrozoneId === v.hydrozoneId)) {
      warnings.push({ severity: 'info', valveId: v.id, text: `${v.hydrozoneName} needs ${fams.size} valves (${[...fams].map((f) => FAMILY_LABEL[f].toLowerCase()).join(' and ')}) because the devices need different flows.` });
    }
  }

  // --- totals and parts
  const totals: IrrigationPlan['totals'] = {
    zones: new Set(valves.map((v) => v.hydrozoneId)).size, valves: valves.length, emitters: 0, bubblers: 0, sprayHeads: 0, rotorHeads: 0,
    inlineFt: 0, tailFt: 0, linesFt: {}, gph: 0, handPlants: 0, controllerStations: 0,
  };
  for (const v of valves) {
    for (const dv of v.devices) {
      if (dv.kind === 'emitter') totals.emitters++;
      else if (dv.kind === 'bubbler') totals.bubblers++;
      else if (dv.kind === 'spray') totals.sprayHeads++;
      else if (dv.kind === 'rotor') totals.rotorHeads++;
    }
    totals.inlineFt += v.inlineFt;
    totals.tailFt += v.tailFt;
    totals.gph += v.gph;
    for (const [s, f] of Object.entries(v.linesFt)) totals.linesFt[s] = (totals.linesFt[s] ?? 0) + f;
  }
  const supplies = roots.filter((r) => valves.some((v) => v.sourceId === r.id)).map((r) => ({ sourceId: r.id, from: r.point, to: r.manifold, sizeInches: cfg.supplyLineInches }));
  for (const supply of supplies) {
    const l = Math.hypot(supply.to[0] - supply.from[0], supply.to[1] - supply.from[1]);
    if (l > 0.05) totals.linesFt[String(supply.sizeInches)] = (totals.linesFt[String(supply.sizeInches)] ?? 0) + l;
  }
  totals.handPlants = plants.filter((r) => r.method === 'hand' || r.method === 'none').length;
  const stations = cfg.controllerStations.find((n) => n >= valves.length) ?? cfg.controllerStations[cfg.controllerStations.length - 1];
  totals.controllerStations = valves.length > 0 ? stations : 0;

  const pr = cfg.prices;
  const parts: PartRow[] = [];
  const add = (id: string, label: string, quantity: number, unit: 'each' | 'ft', unitPrice: number) => {
    if (quantity > 0.0001) parts.push({ id, label, quantity: unit === 'ft' ? Math.ceil(quantity) : quantity, unit, unitPrice, total: (unit === 'ft' ? Math.ceil(quantity) : quantity) * unitPrice });
  };
  if (valves.length > 0) {
    add('backflow', 'Backflow preventer', supplies.length, 'each', pr.backflow);
    add('controller', `Controller, ${stations} stations`, 1, 'each', pr.controller[String(stations)] ?? 0);
    add('valve', 'Zone valve', valves.length, 'each', pr.valve);
    add('filter', 'Filter and pressure regulator (drip)', supplies.filter((sp) => valves.some((v) => v.sourceId === sp.sourceId && v.family === 'drip')).length, 'each', pr.filterRegulator);
  }
  for (const s of cfg.lineSizes) add(`line-${s.inches}`, s.label, totals.linesFt[String(s.inches)] ?? 0, 'ft', pr.linePerFt[String(s.inches)] ?? 0);
  add('inline', 'Inline drip tubing', totals.inlineFt, 'ft', pr.inlinePerFt);
  add('micro', '1/4 in micro tubing to emitters, bubblers and heads', totals.tailFt, 'ft', pr.microTubingPerFt);
  add('emitter', 'Drip emitters', totals.emitters, 'each', pr.emitter);
  add('bubbler', 'Bubblers', totals.bubblers, 'each', pr.bubbler);
  add('spray', 'Spray heads', totals.sprayHeads, 'each', pr.sprayHead);
  add('rotor', 'Rotor heads', totals.rotorHeads, 'each', pr.rotorHead);
  const lineMaterial = parts.filter((p) => p.id.startsWith('line-') || p.id === 'inline' || p.id === 'micro').reduce((a, p) => a + p.total, 0);
  add('fittings', 'Fittings, stakes and connectors (allowance)', lineMaterial * pr.fittingsShare > 0 ? 1 : 0, 'each', lineMaterial * pr.fittingsShare);
  const cost = parts.reduce((a, p) => a + p.total, 0);

  const hand = plants.filter((r) => r.method === 'hand' || r.method === 'none');
  const sources: PlanSource[] = roots.map((r) => ({ id: r.id, label: r.label, short: r.short, point: r.point, manifold: r.manifold, valveIds: valves.filter((v) => v.sourceId === r.id).map((v) => v.id) }));
  return { sources, valves, plants, hand, excludedRaisedBed, beds: bedRows, warnings, supplies, totals, parts, cost };
}

/** Emitters on a grid inside a raised bed's outline, kept `edgeInsetFt` off the boards; a bed too small for a grid gets one at its middle. */
export function bedEmitters(poly: Pt[], cfg: IrrigationCfg): Pt[] {
  const { emitterSpacingFt: sp, edgeInsetFt: inset } = cfg.bed;
  const b = bbox(poly);
  const out: Pt[] = [];
  const nx = Math.max(1, Math.floor((b.maxX - b.minX) / sp)), ny = Math.max(1, Math.floor((b.maxY - b.minY) / sp));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = b.minX + ((i + 0.5) * (b.maxX - b.minX)) / nx, y = b.minY + ((j + 0.5) * (b.maxY - b.minY)) / ny;
    if (pointInPolygon(x, y, poly) && !nearPolygon(x, y, poly, inset)) out.push([x, y]);
  }
  if (out.length === 0) {
    const mid: Pt = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
    out.push(pointInPolygon(mid[0], mid[1], poly) ? mid : poly[0]);
  }
  return out;
}

/** Row by row, left to right then right to left, so tubing laid from one emitter to the next reads as rows across the bed. */
function snakeOrder(devs: Device[]): Device[] {
  const ys = [...new Set(devs.map((d) => Math.round(d.at[1] * 100)))].sort((a, b) => a - b);
  return ys.flatMap((y, i) => devs.filter((d) => Math.round(d.at[1] * 100) === y).sort((a, b) => (i % 2 === 0 ? a.at[0] - b.at[0] : b.at[0] - a.at[0])));
}

/** The point on a polygon's outline nearest to a point. */
function nearestOnOutline(p: Pt, poly: Pt[]): Pt {
  let best: Pt = poly[0], bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], c = poly[(i + 1) % poly.length];
    const dx = c[0] - a[0], dy = c[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1);
    const q: Pt = [a[0] + t * dx, a[1] + t * dy];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}

/** The point a fraction of the way along a polyline. */
function along(pts: Pt[], f: number): Pt {
  const total = lengthOf(pts);
  let want = total * f;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (want <= seg || i === pts.length - 1) {
      const t = seg === 0 ? 0 : Math.min(1, want / seg);
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    }
    want -= seg;
  }
  return pts[pts.length - 1];
}

/**
 * Put each valve's label on one of its own lines: the middle of its longest run, or if another label is already within
 * `gapFt` of that, the next spot along (other fractions of the longest run, then of its other runs). A valve with no
 * run (everything at its manifold) is labelled at the middle of what it waters. Deterministic, valve by valve.
 */
export function placeLabels(valves: Valve[], gapFt: number): void {
  const placed: Pt[] = [];
  const fractions = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9];
  for (const v of valves) {
    const runs = [...v.runs].filter((r) => r.points.length > 1).sort((a, b) => lengthOf(b.points) - lengthOf(a.points));
    const candidates: Pt[] = runs.flatMap((r) => fractions.map((f) => along(r.points, f)));
    if (candidates.length === 0) candidates.push(v.center);
    const far = (p: Pt) => placed.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) >= gapFt);
    // when no spot clears the gap, take the one farthest from every other label
    const pick = candidates.find(far) ?? candidates.reduce((best, p) => {
      const d = Math.min(...placed.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])), Infinity);
      return d > best.d ? { p, d } : best;
    }, { p: candidates[0], d: -1 }).p;
    v.labelAt = pick;
    placed.push(pick);
  }
}

/** True when a point is closer than `d` to the outline of a polygon. */
function nearPolygon(x: number, y: number, poly: Pt[], d: number): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : clamp(((x - a[0]) * dx + (y - a[1]) * dy) / l2, 0, 1);
    if (Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy)) < d) return true;
  }
  return false;
}

const lengthOf = (pts: Pt[]) => pts.reduce((a, p, i) => (i === 0 ? 0 : a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1])), 0);

/** Drop points that lie on the straight line between their neighbors. */
function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) > 1e-6) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
