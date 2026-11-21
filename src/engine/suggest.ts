import { overlapApplies, type ContextTree } from './conflicts';
import { circleOverlapsPolygon, distanceToPolygon, pointInPolygon } from './geometry';
import type { PlacedPlant } from './growth';
import { footprint } from './hardscape';
import type { SunHoursResult } from './sunhours';
import type { EasementCfg, EngineConfig, HardscapeElement, Pt, Species, StructureCfg } from './types';
import { WATER_ORDER } from './water';

export type TermId = 'sun' | 'clearance' | 'hydrozone';
export type SuggestWeights = Record<TermId, number>;
export type Exclusion = 'structure' | 'paving' | 'easement' | 'root-zone';

export interface CellScore {
  x: number;
  y: number;
  /** Each term from 0 (poor) to 1 (ideal). */
  terms: Record<TermId, number>;
  /** Weighted average of the terms, 0 to 1. Zero for excluded cells. */
  total: number;
  excluded: Exclusion | null;
  detail: {
    sunHours: number | null;
    /** Smallest margin to an obstacle in feet; negative means too close. */
    margin: number | null;
    limiting: string | null;
    neighbors: number;
    /** Largest gap in water-use steps to a neighbor within the radius. */
    waterStepGap: number;
  };
}

export interface SuggestInput {
  species: Species;
  zone: { id: string; name: string; polygon: Pt[] };
  /** Growing-season sun hours on the site (without the plants being judged). */
  sun: SunHoursResult;
  structures: StructureCfg[];
  /** Plants already in the scenario, used for clearance and water-use neighbors. */
  plants: PlacedPlant[];
  elements: HardscapeElement[];
  easements: EasementCfg[];
  contextTrees: ContextTree[];
  lot: { width: number; depth: number };
  weights: SuggestWeights;
  cfg: EngineConfig;
}

export interface SuggestResult {
  speciesId: string;
  zoneId: string;
  zoneName: string;
  cells: CellScore[];
  /** The heatmap grid over the whole lot (NaN where a cell is outside the zone). */
  grid: { nx: number; ny: number; cell: number; total: Float32Array; excluded: Uint8Array };
  top: CellScore[];
  weights: SuggestWeights;
  excludedCount: number;
}

export interface TermExplanation {
  term: TermId;
  label: string;
  score: number;
  weight: number;
  /** Share of the total contributed by this term. */
  contribution: number;
  text: string;
}

/** How well the sun hours at a cell match the species' light need, 0 to 1. */
export function sunTerm(species: Species, hours: number, cfg: EngineConfig['growth']): number {
  const n = cfg.sunNeedHours;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  if (species.sun === 'full') return clamp(hours / n.full.min);
  if (species.sun === 'part') {
    if (hours < n.part.min) return clamp(hours / n.part.min);
    if (hours > n.part.max) return clamp(1 - (hours - n.part.max) / 5);
    return 1;
  }
  return hours <= n.shade.max ? 1 : clamp(1 - (hours - n.shade.max) / 5);
}

const matureRadius = (s: Species) => s.matureWidth / 2;

function evaluateCell(x: number, y: number, input: SuggestInput): CellScore {
  const { species: sp, cfg } = input;
  const cc = cfg.conflicts;
  const R = matureRadius(sp);
  const none = { sunHours: null, margin: null, limiting: null, neighbors: 0, waterStepGap: 0 };
  const dead = (excluded: Exclusion): CellScore => ({ x, y, terms: { sun: 0, clearance: 0, hydrozone: 0 }, total: 0, excluded, detail: none });

  // Hard exclusions
  if (input.structures.some((s) => pointInPolygon(x, y, s.footprint))) return dead('structure');
  const avoid = input.elements.filter((e) => !e.removed && cc.trunkAvoidTypes.includes(e.type));
  if (avoid.some((e) => pointInPolygon(x, y, footprint(e, cfg.hardscape)))) return dead('paving');
  if (input.easements.some((e) => sp.matureHeight >= e.heightCap && circleOverlapsPolygon(x, y, R, e.polygon))) return dead('easement');
  const roots = [
    ...input.contextTrees.map((t) => ({ x: t.x, y: t.y, r: t.width / 2 })),
    ...input.plants.filter((p) => p.inst.existing && p.species.type === 'tree').map((p) => ({ x: p.inst.position[0], y: p.inst.position[1], r: p.size.width / 2 })),
  ];
  if (roots.some((t) => Math.hypot(x - t.x, y - t.y) < t.r * cfg.hardscape.rootZoneFactor)) return dead('root-zone');

  // Sun
  const i = Math.floor(x / input.sun.cellSize), j = Math.floor(y / input.sun.cellSize);
  const k = j * input.sun.nx + i;
  const inGrid = i >= 0 && j >= 0 && i < input.sun.nx && j < input.sun.ny;
  const sunHours = inGrid && input.sun.mask[k] === 1 ? input.sun.hours[k] : null;
  const sun = sunHours === null ? 0 : sunTerm(sp, sunHours, cfg.growth);

  // Clearance: the same rules the conflict check applies, judged at mature size
  const margins: { m: number; label: string }[] = [];
  const add = (m: number, scale: number, label: string) => margins.push({ m: m / Math.max(scale, 0.5), label: `${label}|${m.toFixed(2)}` });
  const gap = cc.structureClearanceFt;
  for (const st of input.structures) {
    const outline = sp.matureHeight >= st.eaveHeight ? (st.roofFootprint ?? st.footprint) : st.footprint;
    if (!(sp.habit === 'vine' && cc.ignoreVinesAtStructures)) add(distanceToPolygon(x, y, outline) - (R + gap), R, st.groupName ?? st.name);
    add(distanceToPolygon(x, y, st.footprint) - sp.roots.minFoundationFt, sp.roots.minFoundationFt, `${st.groupName ?? st.name} (roots)`);
  }
  for (const e of avoid) add(distanceToPolygon(x, y, footprint(e, cfg.hardscape)) - sp.roots.minPavingFt, sp.roots.minPavingFt, e.name ?? e.type);
  add(Math.min(x, input.lot.width - x, y, input.lot.depth - y) - cc.lotLineMinFt[sp.type], cc.lotLineMinFt[sp.type], 'the lot line');
  const mature = { sp, height: sp.matureHeight };
  for (const p of input.plants) {
    const ph = p.inst.existing ? p.size.height : p.species.matureHeight;
    if (!overlapApplies(mature, { sp: p.species, height: ph }, cc)) continue;
    const pr = p.inst.existing ? p.size.width / 2 : matureRadius(p.species);
    add(Math.hypot(x - p.inst.position[0], y - p.inst.position[1]) - (R + pr) + cc.overlapToleranceFt, R, p.species.common);
  }
  for (const t of input.contextTrees) {
    if (!overlapApplies(mature, { sp: null, height: t.height }, cc)) continue;
    add(Math.hypot(x - t.x, y - t.y) - (R + t.width / 2) + cc.overlapToleranceFt, R, t.name);
  }
  const worst = margins.reduce((a, b) => (b.m < a.m ? b : a), { m: Infinity, label: '' });
  const clearance = worst.m >= 0 ? 1 : Math.max(0, 1 + worst.m);
  let margin: number | null = null, limiting: string | null = null;
  if (margins.length) {
    const [label, raw] = worst.label.split('|');
    limiting = label;
    margin = Number(raw);
  }

  // Hydrozone: how close the neighbors' water use is to this plant's
  const idx = WATER_ORDER.indexOf(sp.wucols);
  const near = input.plants.filter((p) => Math.hypot(x - p.inst.position[0], y - p.inst.position[1]) <= cfg.suggest.hydrozoneRadiusFt);
  let hydrozone = 1, maxGap = 0;
  if (near.length > 0) {
    let s = 0;
    for (const p of near) {
      const g = Math.abs(WATER_ORDER.indexOf(p.species.wucols) - idx);
      maxGap = Math.max(maxGap, g);
      s += 1 - Math.min(1, g / 2);
    }
    hydrozone = s / near.length;
  }

  return { x, y, terms: { sun, clearance, hydrozone }, total: 0, excluded: null, detail: { sunHours, margin, limiting, neighbors: near.length, waterStepGap: maxGap } };
}

const weighted = (t: Record<TermId, number>, w: SuggestWeights) => {
  const sum = w.sun + w.clearance + w.hydrozone;
  return sum > 0 ? (t.sun * w.sun + t.clearance * w.clearance + t.hydrozone * w.hydrozone) / sum : 0;
};

/** Pick the best cells, keeping them apart so the five suggestions are real alternatives. */
function pickTop(cells: CellScore[], R: number, cfg: EngineConfig['suggest']): CellScore[] {
  const sep = Math.max(cfg.minSeparationFt, R);
  // Equal scores are common (many cells are simply fine), so break ties toward the cell with the most
  // room to spare, then the most sun, rather than whichever sits first on the grid.
  const room = (c: CellScore) => c.detail.margin ?? Infinity;
  const sorted = cells
    .filter((c) => !c.excluded)
    .sort((a, b) => b.total - a.total || room(b) - room(a) || (b.detail.sunHours ?? 0) - (a.detail.sunHours ?? 0) || a.y - b.y || a.x - b.x);
  const top: CellScore[] = [];
  for (const c of sorted) {
    if (top.length >= cfg.topCount) break;
    if (top.every((t) => Math.hypot(t.x - c.x, t.y - c.y) >= sep)) top.push(c);
  }
  return top;
}

function buildGrid(cells: CellScore[], input: SuggestInput) {
  const cell = input.cfg.suggest.gridFt;
  const nx = Math.ceil(input.lot.width / cell), ny = Math.ceil(input.lot.depth / cell);
  const total = new Float32Array(nx * ny).fill(NaN);
  const excluded = new Uint8Array(nx * ny);
  for (const c of cells) {
    const k = Math.floor(c.y / cell) * nx + Math.floor(c.x / cell);
    total[k] = c.total;
    excluded[k] = c.excluded ? 1 : 0;
  }
  return { nx, ny, cell, total, excluded };
}

/**
 * Score a 1 ft grid of candidate cells in a yard zone for one species (GR-7). The score is a weighted
 * average of sun fit, clearance at mature size, and hydrozone match. Cells on structures, paving,
 * under the easement height cap, or in an existing tree's root zone are excluded.
 */
export function suggestPlacements(input: SuggestInput): SuggestResult {
  const g = input.cfg.suggest.gridFt;
  const xs = input.zone.polygon.map((p) => p[0]), ys = input.zone.polygon.map((p) => p[1]);
  const cells: CellScore[] = [];
  for (let y = Math.floor(Math.min(...ys) / g) * g + g / 2; y < Math.max(...ys); y += g) {
    for (let x = Math.floor(Math.min(...xs) / g) * g + g / 2; x < Math.max(...xs); x += g) {
      if (!pointInPolygon(x, y, input.zone.polygon)) continue;
      const c = evaluateCell(x, y, input);
      c.total = c.excluded ? 0 : weighted(c.terms, input.weights);
      cells.push(c);
    }
  }
  return {
    speciesId: input.species.id, zoneId: input.zone.id, zoneName: input.zone.name, cells,
    grid: buildGrid(cells, input), top: pickTop(cells, matureRadius(input.species), input.cfg.suggest),
    weights: input.weights, excludedCount: cells.filter((c) => c.excluded).length,
  };
}

/** Re-rank an existing result with new weights, without re-measuring anything (GR-7: adjustable weights). */
export function rescore(result: SuggestResult, weights: SuggestWeights, species: Species, cfg: EngineConfig, lot: { width: number; depth: number }): SuggestResult {
  const cells = result.cells.map((c) => ({ ...c, total: c.excluded ? 0 : weighted(c.terms, weights) }));
  const fake = { cfg, lot } as SuggestInput;
  return { ...result, cells, weights, grid: buildGrid(cells, fake), top: pickTop(cells, matureRadius(species), cfg.suggest) };
}

const EXCLUSION_TEXT: Record<Exclusion, string> = {
  structure: 'under a building',
  paving: 'on paving, a wall, or the driveway',
  easement: 'in the easement, where this plant would pass the height cap',
  'root-zone': "inside an existing tree's root zone",
};
export const exclusionText = (e: Exclusion) => EXCLUSION_TEXT[e];

/** Why a cell scored as it did: each term's score, weight, share of the total, and a plain sentence (GR-7). */
export function explainCell(c: CellScore, species: Species, weights: SuggestWeights, cfg: EngineConfig): TermExplanation[] {
  const sum = Math.max(1e-9, weights.sun + weights.clearance + weights.hydrozone);
  const n = cfg.growth.sunNeedHours;
  const need = species.sun === 'full' ? `at least ${n.full.min} h` : species.sun === 'part' ? `${n.part.min} to ${n.part.max} h` : `under ${n.shade.max} h`;
  const d = c.detail;
  const sunText = d.sunHours === null ? 'No sun data here.' : `${d.sunHours.toFixed(1)} h of sun a day in the growing season; ${species.common} wants ${need} (${species.sun} sun).`;
  let clearText = 'Nothing nearby limits it.';
  if (d.limiting && d.margin !== null) {
    clearText = d.margin >= 0
      ? `At full size it clears ${d.limiting} by ${d.margin.toFixed(1)} ft.`
      : `At full size it falls ${Math.abs(d.margin).toFixed(1)} ft short of the clearance it needs from ${d.limiting}.`;
  }
  const hydroText = d.neighbors === 0 ? 'No plants within reach to share a watering schedule with.' : `${d.neighbors} plant${d.neighbors === 1 ? '' : 's'} nearby; the biggest water-use gap is ${d.waterStepGap} step${d.waterStepGap === 1 ? '' : 's'}.`;
  const row = (term: TermId, label: string, text: string): TermExplanation => ({
    term, label, score: c.terms[term], weight: weights[term], contribution: (c.terms[term] * weights[term]) / sum, text,
  });
  return [row('sun', 'Sun fit', sunText), row('clearance', 'Clearance at maturity', clearText), row('hydrozone', 'Hydrozone match', hydroText)];
}
