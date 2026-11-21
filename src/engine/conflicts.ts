import { circleOverlapsPolygon, distanceToPolygon } from './geometry';
import { instanceSize } from './growth';
import { footprint } from './hardscape';
import type { EasementCfg, EngineConfig, HardscapeElement, PlantInstance, Pt, Species, StructureCfg } from './types';

export type ConflictKind = 'overlap' | 'structure' | 'roof' | 'foundation' | 'paving' | 'lot-line' | 'overhead';

export interface Conflict {
  /** Stable key: kind plus the subjects involved. */
  id: string;
  kind: ConflictKind;
  severity: 'error' | 'warning';
  /** Plant instance ids (or `ctx:` ids for existing site trees) involved. */
  subjects: string[];
  /** Plant instances to highlight in the yard. */
  instanceIds: string[];
  /** First timeline month (0 = planting day) the conflict exists. */
  firstMonth: number;
  /** True when it exists from the day of planting, so it does not depend on growth. */
  atPlanting: boolean;
  message: string;
}

export interface ContextTree {
  id: string;
  name: string;
  x: number;
  y: number;
  height: number;
  width: number;
}

export interface ConflictInput {
  instances: PlantInstance[];
  palette: Record<string, boolean>;
  species: Species[];
  structures: StructureCfg[];
  elements: HardscapeElement[];
  easements: EasementCfg[];
  contextTrees: ContextTree[];
  lot: { width: number; depth: number };
  cfg: EngineConfig;
  /** Last timeline month to check (inclusive). */
  maxMonths: number;
}

interface Subject {
  id: string;
  name: string;
  pos: Pt;
  sp: Species | null;
  /** Month the subject appears (planting), or 0. */
  from: number;
  size: (month: number) => { planted: boolean; height: number; width: number };
  instanceId: string | null;
}

/**
 * Whether two canopies conflict when they overlap. Groundcovers and understory plants much shorter
 * than their neighbor are meant to sit under it, so they are skipped.
 */
export function overlapApplies(a: { sp: Species | null; height: number }, b: { sp: Species | null; height: number }, cfg: EngineConfig['conflicts']): boolean {
  if (a.sp && cfg.ignoreHabits.includes(a.sp.habit)) return false;
  if (b.sp && cfg.ignoreHabits.includes(b.sp.habit)) return false;
  const hi = Math.max(a.height, b.height);
  const lo = Math.min(a.height, b.height);
  return hi <= 0 || lo / hi >= cfg.understoryHeightRatio;
}

const fmtYear = (m: number) => (m === 0 ? 'at planting' : `in year ${(m / 12).toFixed(1)}`);

/**
 * Scan the whole timeline in monthly steps and report the first month each conflict appears (GR-6):
 * canopy overlap, canopy touching a structure or roof, trunks too close to a foundation, paving or
 * the lot line, and height reaching the overhead-line cap in an easement.
 */
export function detectConflicts(input: ConflictInput): Conflict[] {
  const { cfg } = input;
  const cc = cfg.conflicts;
  const byId = new Map(input.species.map((s) => [s.id, s]));
  const subjects: Subject[] = [];

  for (const inst of input.instances) {
    if (!input.palette[inst.speciesId]) continue;
    const sp = byId.get(inst.speciesId);
    if (!sp) continue;
    subjects.push({
      id: inst.id, name: sp.common, pos: inst.position, sp, from: inst.existing ? 0 : inst.plantedMonth,
      size: (m) => instanceSize(inst, sp, m, cfg.growth), instanceId: inst.id,
    });
  }
  for (const t of input.contextTrees) {
    subjects.push({ id: `ctx:${t.id}`, name: t.name, pos: [t.x, t.y], sp: null, from: 0, size: () => ({ planted: true, height: t.height, width: t.width }), instanceId: null });
  }

  const found = new Map<string, Conflict>();
  const record = (c: Omit<Conflict, 'atPlanting'> & { atPlanting?: boolean }) => {
    if (!found.has(c.id)) found.set(c.id, { atPlanting: false, ...c });
  };

  // A building made of several parts (the ADU's wings, the house's gables) is one thing to plant near: report it once.
  const buildings = [...input.structures.reduce((m, st) => m.set(st.groupName ?? st.group ?? st.id, [...(m.get(st.groupName ?? st.group ?? st.id) ?? []), st]), new Map<string, StructureCfg[]>())].map(
    ([key, parts]) => ({ key, name: parts[0].groupName ?? parts[0].name, parts }),
  );

  const live = input.elements.filter((e) => !e.removed);
  const avoid = live.filter((e) => cc.trunkAvoidTypes.includes(e.type));
  const lot = input.lot;

  // Static trunk checks happen once, on the day the plant goes in.
  for (const s of subjects) {
    if (!s.sp || !s.instanceId) continue;
    const sp = s.sp;
    const [x, y] = s.pos;
    const m0 = s.from;
    for (const b of buildings) {
      const d = Math.min(...b.parts.map((p) => distanceToPolygon(x, y, p.footprint)));
      if (d < sp.roots.minFoundationFt) {
        record({
          id: `foundation:${s.id}:${b.key}`, kind: 'foundation', severity: 'error', subjects: [s.id], instanceIds: [s.instanceId], firstMonth: m0, atPlanting: true,
          message: `${s.name} is ${d.toFixed(1)} ft from ${b.name}; keep at least ${sp.roots.minFoundationFt} ft for its roots.`,
        });
      }
    }
    for (const e of avoid) {
      const d = distanceToPolygon(x, y, footprint(e, cfg.hardscape));
      if (d < sp.roots.minPavingFt) {
        record({
          id: `paving:${s.id}:${e.id}`, kind: 'paving', severity: 'error', subjects: [s.id], instanceIds: [s.instanceId], firstMonth: m0, atPlanting: true,
          message: `${s.name} is ${d.toFixed(1)} ft from the ${e.name ?? e.type}; keep at least ${sp.roots.minPavingFt} ft.`,
        });
      }
    }
    const lotMin = cc.lotLineMinFt[sp.type];
    const dLot = Math.min(x, lot.width - x, y, lot.depth - y);
    if (dLot < lotMin) {
      record({
        id: `lot-line:${s.id}`, kind: 'lot-line', severity: 'warning', subjects: [s.id], instanceIds: [s.instanceId], firstMonth: m0, atPlanting: true,
        message: `${s.name} is ${Math.max(0, dLot).toFixed(1)} ft from the lot line; keep at least ${lotMin} ft.`,
      });
    }
  }

  // Growth-dependent checks, month by month.
  for (let m = 0; m <= input.maxMonths; m++) {
    const sizes = subjects.map((s) => (m >= s.from ? s.size(m) : null));

    for (let i = 0; i < subjects.length; i++) {
      const a = sizes[i];
      if (!a || !a.planted) continue;
      const s = subjects[i];
      const r = a.width / 2;

      // Canopy against structures and roofs
      if (!(s.sp?.habit === 'vine' && cc.ignoreVinesAtStructures)) {
        for (const b of buildings) {
          if (b.parts.some((p) => circleOverlapsPolygon(s.pos[0], s.pos[1], r + cc.structureClearanceFt, p.footprint))) {
            record({
              id: `structure:${s.id}:${b.key}`, kind: 'structure', severity: 'error', subjects: [s.id], instanceIds: s.instanceId ? [s.instanceId] : [], firstMonth: m,
              message: `${s.name}'s canopy touches ${b.name} ${fmtYear(m)}.`,
            });
          }
          if (b.parts.some((p) => a.height >= p.eaveHeight && circleOverlapsPolygon(s.pos[0], s.pos[1], r, p.roofFootprint ?? p.footprint))) {
            record({
              id: `roof:${s.id}:${b.key}`, kind: 'roof', severity: 'error', subjects: [s.id], instanceIds: s.instanceId ? [s.instanceId] : [], firstMonth: m,
              message: `${s.name} reaches the ${b.name} roof ${fmtYear(m)}.`,
            });
          }
        }
      }

      // Overhead-line height cap in an easement
      for (const e of input.easements) {
        if (a.height >= e.heightCap && circleOverlapsPolygon(s.pos[0], s.pos[1], r, e.polygon)) {
          record({
            id: `overhead:${s.id}:${e.id}`, kind: 'overhead', severity: 'error', subjects: [s.id], instanceIds: s.instanceId ? [s.instanceId] : [], firstMonth: m,
            message: `${s.name} reaches the ${e.heightCap} ft cap in the ${e.label} ${fmtYear(m)}.`,
          });
        }
      }

      // Canopy overlap with another plant
      for (let j = i + 1; j < subjects.length; j++) {
        const b = sizes[j];
        if (!b || !b.planted) continue;
        const o = subjects[j];
        if (!s.sp && !o.sp) continue; // two fixed site trees are not the owner's decision
        const dist = Math.hypot(s.pos[0] - o.pos[0], s.pos[1] - o.pos[1]);
        const overlap = r + b.width / 2 - dist;
        if (overlap > cc.overlapToleranceFt && overlapApplies({ sp: s.sp, height: a.height }, { sp: o.sp, height: b.height }, cc)) {
          record({
            id: `overlap:${s.id}:${o.id}`, kind: 'overlap', severity: 'warning', subjects: [s.id, o.id],
            instanceIds: [s.instanceId, o.instanceId].filter((v): v is string => v !== null), firstMonth: m,
            message: `${s.name} and ${o.name} canopies overlap by ${overlap.toFixed(1)} ft ${fmtYear(m)}.`,
          });
        }
      }
    }
  }

  return [...found.values()].sort((x, y) => x.firstMonth - y.firstMonth || (x.severity === y.severity ? 0 : x.severity === 'error' ? -1 : 1));
}
