import { detectConflicts } from './conflicts';
import { placedPlants } from './growth';
import { takeoff } from './hardscape';
import { bloomCalendar } from './pollinator';
import { emptyPrices, projectCost } from './pricing';
import { SHARE_FORMAT } from '../share/format';
import { activeStructures } from './site';
import type {
  EngineConfig, HardscapeElement, Hydrozone, Irrigation, Material, PlantInstance, Prices, SiteConfig, SoilConfig, SoilProfile, Species, WaterConfig,
} from './types';
import { waterDemand } from './water';

/** Species the owner started with: the plants photographed in neighboring yards. */
export const OWNER_PICKS = [
  'salvia-leucantha', 'oenothera-lindheimeri', 'achillea-millefolium', 'lomandra-longifolia', 'bougainvillea', 'lantana-montevidensis',
  'coleonema-pulchellum', 'coleonema-sunset-gold', 'polygala-myrtifolia', 'polygala-petite-butterflies', 'loropetalum-chinense',
  'phormium-tenax', 'agapanthus-africanus', 'tulbaghia-violacea', 'phyla-nodiflora', 'juncus-patens', 'arctostaphylos-howard-mcminn', 'citrus-satsuma',
];

/** What a scenario holds (SC-1): palette, plants, hardscape, hydrozones, and settings. */
export interface ScenarioData {
  palette: Record<string, boolean>;
  instances: PlantInstance[];
  hardscape: HardscapeElement[];
  hydrozones: Hydrozone[];
  autoIrrigation: Record<string, Irrigation>;
  useRain: boolean;
  aduEnabled: boolean;
  /** Where the owner put the beehive; without it the app picks a spot. */
  hive?: [number, number] | null;
  /** Prices the owner set; without them the stand-in prices apply. */
  prices?: Prices;
}

export interface ScenarioMeta {
  id: string;
  name: string;
  createdAt: string;
  modifiedAt: string;
}

/** Owner-entered site facts that travel with a plan but are not part of any one scenario. */
export interface SiteOverrides {
  soilProfiles: Record<string, SoilProfile>;
  playZones: Record<string, boolean>;
}

export interface ShareRecord {
  scenarioId: string;
  token: string;
  /** Secret that lets the owner update or revoke the link. Stays in this browser. */
  revokeKey: string;
  createdAt: string;
  updatedAt: string;
  blurLocation: boolean;
  revoked: boolean;
}

export interface Workspace {
  format: 'ashby-workspace/1';
  scenarios: ScenarioMeta[];
  data: Record<string, ScenarioData>;
  activeId: string;
  customSpecies: Species[];
  siteOverrides: SiteOverrides;
  shares: ShareRecord[];
}

export const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Share records saved by an older version used another name for the location option. */
export function normalizeShare(r: ShareRecord & { hideAddress?: boolean }): ShareRecord {
  const { hideAddress, ...rest } = r;
  return { ...rest, blurLocation: r.blurLocation ?? hideAddress ?? false };
}

/**
 * Existing hardscape (the driveway) is a fact about the yard, so it always comes from the site file. A scenario keeps
 * only what the owner did with it: whether this scenario removes it, and any color. Without this, a scenario saved
 * before the site file was corrected would keep drawing the old shape. Elements the owner added are left alone.
 */
export function syncExistingHardscape(hardscape: HardscapeElement[], site: SiteConfig): HardscapeElement[] {
  const saved = new Map(hardscape.map((e) => [e.id, e]));
  const fromSite = site.hardscape
    .filter((e) => e.existing)
    .map((e): HardscapeElement => {
      const mine = saved.get(e.id);
      return { ...clone(e), ...(mine?.removed ? { removed: true } : {}), ...(mine?.color ? { color: mine.color } : {}) };
    });
  const siteIds = new Set(fromSite.map((e) => e.id));
  return [...fromSite, ...hardscape.filter((e) => !siteIds.has(e.id))];
}

/** A fresh scenario: the owner's default palette, no plants, and the lot's existing hardscape. */
export function emptyScenarioData(site: SiteConfig): ScenarioData {
  return {
    palette: Object.fromEntries(OWNER_PICKS.map((id) => [id, true])),
    instances: [],
    hardscape: clone(site.hardscape),
    hydrozones: [],
    autoIrrigation: {},
    useRain: false,
    aduEnabled: true,
    hive: null,
    prices: { plant: {}, material: {} },
  };
}

// ---------------------------------------------------------------------------------------------
// Persistence (SC-2)
// ---------------------------------------------------------------------------------------------

export const WORKSPACE_KEY = 'ashby-planner/workspace/v1';

/** The part of localStorage the app uses, so tests can supply a stand-in. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function saveWorkspace(storage: KeyValueStorage, ws: Workspace): { ok: true } | { ok: false; error: string } {
  try {
    storage.setItem(WORKSPACE_KEY, JSON.stringify(ws));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not save' };
  }
}

/** A workspace read from storage or the cloud. Anything missing, malformed, or from another version returns null. */
export function workspaceFromJson(value: unknown): Workspace | null {
  const ws = value as Workspace | null;
  if (!ws || typeof ws !== 'object' || ws.format !== 'ashby-workspace/1' || !Array.isArray(ws.scenarios) || ws.scenarios.length === 0) return null;
  if (!ws.data || !ws.data[ws.activeId]) return null;
  return ws;
}

/** Load the saved workspace. Anything missing, malformed, or from another version returns null. */
export function loadWorkspace(storage: KeyValueStorage): Workspace | null {
  try {
    const raw = storage.getItem(WORKSPACE_KEY);
    return raw ? workspaceFromJson(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Validation shared by file import and share links
// ---------------------------------------------------------------------------------------------

export interface ValidationContext {
  speciesIds: Set<string>;
  containers: Set<string>;
  hardscapeTypes: Set<string>;
  materialIds: Set<string>;
  zoneIds: Set<string>;
}

const IRRIGATION = new Set(['drip', 'spray', 'hand', 'none']);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPt = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);

export interface DataCheck {
  data: ScenarioData | null;
  errors: string[];
  warnings: string[];
}

/** Check and clean a scenario's data. Structural problems are errors; unknown species are dropped with a warning. */
/**
 * Species that are no longer in the library, and what a plant of one becomes, so saved work, files and shared links
 * made before the change still open with their plants in place.
 */
export const RETIRED_SPECIES: Record<string, { becomes: string; label: string }> = {
  'feijoa-sellowiana': { becomes: 'citrus-kumquat', label: 'Pineapple guava' },
};

export function validateScenarioData(raw: unknown, ctx: ValidationContext, extraSpecies: Set<string> = new Set()): DataCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(raw)) return { data: null, errors: ['Scenario data is missing.'], warnings };
  const known = (id: string) => ctx.speciesIds.has(id) || extraSpecies.has(id);
  const replaced = new Set<string>();
  const current = (id: string) => {
    const r = RETIRED_SPECIES[id];
    if (!r || known(id)) return id;
    replaced.add(`${r.label} is no longer in the library; its plants are now ${r.becomes.replace('citrus-', '')}s.`);
    return r.becomes;
  };

  const palette: Record<string, boolean> = {};
  if (!isRecord(raw.palette)) errors.push('The palette is missing.');
  else {
    for (const [oldId, on] of Object.entries(raw.palette)) {
      const id = current(oldId);
      if (typeof on !== 'boolean') errors.push(`Palette entry "${oldId}" is not on or off.`);
      else if (!known(id)) warnings.push(`Dropped unknown species "${oldId}" from the palette.`);
      else palette[id] = palette[id] || on;
    }
  }

  const instances: PlantInstance[] = [];
  if (!Array.isArray(raw.instances)) errors.push('The plant list is missing.');
  else {
    raw.instances.forEach((i, n) => {
      if (!isRecord(i) || typeof i.id !== 'string' || typeof i.speciesId !== 'string' || !isPt(i.position) || !isNum(i.plantedMonth) || typeof i.existing !== 'boolean' || typeof i.container !== 'string') {
        errors.push(`Plant ${n + 1} is malformed.`);
      } else if (!ctx.containers.has(i.container)) {
        errors.push(`Plant ${n + 1} has an unknown container "${i.container}".`);
      } else if (!known(current(i.speciesId))) {
        warnings.push(`Dropped a plant of unknown species "${i.speciesId}".`);
      } else {
        instances.push({
          id: i.id, speciesId: current(i.speciesId), position: [(i.position as number[])[0], (i.position as number[])[1]], plantedMonth: i.plantedMonth,
          container: i.container as PlantInstance['container'], existing: i.existing,
          ...(isNum(i.currentHeight) ? { currentHeight: i.currentHeight } : {}),
          ...(isNum(i.currentWidth) ? { currentWidth: i.currentWidth } : {}),
          ...(typeof i.hydrozoneId === 'string' ? { hydrozoneId: i.hydrozoneId } : {}),
        });
      }
    });
  }

  const hardscape: HardscapeElement[] = [];
  if (!Array.isArray(raw.hardscape)) errors.push('The hardscape list is missing.');
  else {
    raw.hardscape.forEach((e, n) => {
      if (!isRecord(e) || typeof e.id !== 'string' || typeof e.type !== 'string' || !Array.isArray(e.points) || !e.points.every(isPt) || typeof e.materialId !== 'string'
        || !isNum(e.height) || !isNum(e.depthIn) || !isNum(e.width) || typeof e.existing !== 'boolean') {
        errors.push(`Hardscape element ${n + 1} is malformed.`);
      } else if (!ctx.hardscapeTypes.has(e.type)) {
        errors.push(`Hardscape element ${n + 1} has an unknown type "${e.type}".`);
      } else if (!ctx.materialIds.has(e.materialId)) {
        errors.push(`Hardscape element ${n + 1} has an unknown material "${e.materialId}".`);
      } else {
        hardscape.push(clone(e) as unknown as HardscapeElement);
      }
    });
  }

  const hydrozones: Hydrozone[] = [];
  if (!Array.isArray(raw.hydrozones)) errors.push('The hydrozone list is missing.');
  else {
    raw.hydrozones.forEach((h, n) => {
      if (!isRecord(h) || typeof h.id !== 'string' || typeof h.name !== 'string' || typeof h.irrigation !== 'string' || !IRRIGATION.has(h.irrigation)) {
        errors.push(`Hydrozone ${n + 1} is malformed.`);
      } else hydrozones.push({ id: h.id, name: h.name, irrigation: h.irrigation as Irrigation });
    });
  }
  const hzIds = new Set(hydrozones.map((h) => h.id));
  for (const i of instances) if (i.hydrozoneId && !hzIds.has(i.hydrozoneId)) delete i.hydrozoneId;

  const autoIrrigation: Record<string, Irrigation> = {};
  if (isRecord(raw.autoIrrigation)) {
    for (const [k, v] of Object.entries(raw.autoIrrigation)) if (typeof v === 'string' && IRRIGATION.has(v)) autoIrrigation[k] = v as Irrigation;
  }
  if (typeof raw.useRain !== 'boolean') errors.push('The rainfall setting is missing.');
  // Prices are optional: records of finite, non-negative dollar amounts, or the stand-in prices apply.
  const priceRecord = (v: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    if (isRecord(v)) for (const [k, n] of Object.entries(v)) if (typeof n === 'number' && Number.isFinite(n) && n >= 0) out[k] = n;
    return out;
  };
  const prices: Prices = { plant: priceRecord(isRecord(raw.prices) ? raw.prices.plant : undefined), material: priceRecord(isRecord(raw.prices) ? raw.prices.material : undefined) };
  // The hive position is optional: a pair of finite numbers, or the app picks a spot.
  const hive: [number, number] | null = Array.isArray(raw.hive) && raw.hive.length === 2 && raw.hive.every((v) => typeof v === 'number' && Number.isFinite(v)) ? [raw.hive[0] as number, raw.hive[1] as number] : null;
  if (typeof raw.aduEnabled !== 'boolean') errors.push('The ADU setting is missing.');

  warnings.push(...replaced);
  if (errors.length) return { data: null, errors, warnings };
  return {
    data: { palette, instances, hardscape, hydrozones, autoIrrigation, useRain: raw.useRain as boolean, aduEnabled: raw.aduEnabled as boolean, hive, prices },
    errors,
    warnings,
  };
}

function validateOverrides(raw: unknown, ctx: ValidationContext): SiteOverrides {
  const out: SiteOverrides = { soilProfiles: {}, playZones: {} };
  if (!isRecord(raw)) return out;
  if (isRecord(raw.soilProfiles)) {
    for (const [zone, p] of Object.entries(raw.soilProfiles)) {
      if (ctx.zoneIds.has(zone) && isRecord(p) && typeof p.texture === 'string' && isNum(p.drainageInHr) && isNum(p.ph) && isNum(p.organicMatterPct) && typeof p.compaction === 'string') {
        out.soilProfiles[zone] = { texture: p.texture, drainageInHr: p.drainageInHr, ph: p.ph, organicMatterPct: p.organicMatterPct, compaction: p.compaction, testDate: typeof p.testDate === 'string' ? p.testDate : null, isDefault: p.isDefault === true };
      }
    }
  }
  if (isRecord(raw.playZones)) for (const [zone, on] of Object.entries(raw.playZones)) if (ctx.zoneIds.has(zone) && typeof on === 'boolean') out.playZones[zone] = on;
  return out;
}

function validateCustomSpecies(raw: unknown): { species: Species[]; errors: string[] } {
  if (raw === undefined) return { species: [], errors: [] };
  if (!Array.isArray(raw)) return { species: [], errors: ['The custom species list is malformed.'] };
  const errors: string[] = [];
  const species: Species[] = [];
  raw.forEach((s, n) => {
    if (!isRecord(s) || typeof s.id !== 'string' || typeof s.common !== 'string' || !isNum(s.matureHeight) || !isNum(s.matureWidth) || !isNum(s.yearsToMaturity)
      || !isRecord(s.pollinator) || !isRecord(s.soil) || !isRecord(s.roots) || !Array.isArray(s.bloomMonths)) {
      errors.push(`Custom species ${n + 1} is malformed.`);
    } else species.push(clone(s) as unknown as Species);
  });
  return { species, errors };
}

// ---------------------------------------------------------------------------------------------
// Export and import (SC-2)
// ---------------------------------------------------------------------------------------------

export const FILE_FORMAT = 'ashby-scenario/1';

export interface ScenarioFile {
  format: typeof FILE_FORMAT;
  exportedAt: string;
  name: string;
  scenario: ScenarioData;
  customSpecies: Species[];
  siteOverrides: SiteOverrides;
}

/** A scenario as a JSON file the owner can keep or send. Only custom species the scenario uses are included. */
export function serializeScenarioFile(args: {
  name: string;
  data: ScenarioData;
  customSpecies: Species[];
  siteOverrides: SiteOverrides;
  now?: Date;
}): string {
  const used = new Set([...args.data.instances.map((i) => i.speciesId), ...Object.keys(args.data.palette)]);
  const file: ScenarioFile = {
    format: FILE_FORMAT,
    exportedAt: (args.now ?? new Date()).toISOString(),
    name: args.name,
    scenario: args.data,
    customSpecies: args.customSpecies.filter((s) => used.has(s.id)),
    siteOverrides: args.siteOverrides,
  };
  return JSON.stringify(file, null, 1);
}

export type ParsedFile =
  | { ok: true; name: string; data: ScenarioData; customSpecies: Species[]; siteOverrides: SiteOverrides; warnings: string[] }
  | { ok: false; errors: string[] };

export function parseScenarioFile(text: string, ctx: ValidationContext): ParsedFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['This is not a JSON file.'] };
  }
  if (!isRecord(raw) || raw.format !== FILE_FORMAT) return { ok: false, errors: [`This is not a scenario file (expected format "${FILE_FORMAT}").`] };
  const custom = validateCustomSpecies(raw.customSpecies);
  // Custom species in the file can be used by its plants, so they count as known.
  const extra = new Set(custom.species.map((s) => s.id));
  const check = validateScenarioData(raw.scenario, ctx, extra);
  const errors = [...custom.errors, ...check.errors];
  if (typeof raw.name !== 'string' || !raw.name.trim()) errors.push('The scenario has no name.');
  if (errors.length || !check.data) return { ok: false, errors };
  return { ok: true, name: (raw.name as string).trim(), data: check.data, customSpecies: custom.species, siteOverrides: validateOverrides(raw.siteOverrides, ctx), warnings: check.warnings };
}

// ---------------------------------------------------------------------------------------------
// Sharing snapshots (SH-1, SH-3, NF-6)
// ---------------------------------------------------------------------------------------------

export { SHARE_FORMAT };

export interface ShareSnapshot {
  format: typeof SHARE_FORMAT;
  createdAt: string;
  name: string;
  blurLocation: boolean;
  /** The site the plan was made for. Its name is removed and its location blurred when the owner blurs the location. */
  site: SiteConfig;
  scenario: ScenarioData;
  customSpecies: Species[];
  siteOverrides: SiteOverrides;
  /** Where the timeline and date start for the viewer. */
  view: { timelineMonth: number; doy: number };
}

/**
 * Blur what identifies the lot (SH-3). With the location blurred the name is removed and the coordinates are rounded
 * to a tenth of a degree, which keeps the sun accurate to well under a degree but no longer points at one street.
 * The lot's shape is kept: it is the plan.
 */
export function redactSite(site: SiteConfig, blurLocation: boolean): SiteConfig {
  const s = clone(site);
  if (!blurLocation) return s;
  s.name = 'Shared lot';
  s.latitude = Math.round(s.latitude * 10) / 10;
  s.longitude = Math.round(s.longitude * 10) / 10;
  return s;
}

export function buildShareSnapshot(args: {
  name: string;
  site: SiteConfig;
  data: ScenarioData;
  customSpecies: Species[];
  siteOverrides: SiteOverrides;
  blurLocation: boolean;
  view: { timelineMonth: number; doy: number };
  now?: Date;
}): ShareSnapshot {
  const used = new Set([...args.data.instances.map((i) => i.speciesId), ...Object.keys(args.data.palette)]);
  return {
    format: SHARE_FORMAT,
    createdAt: (args.now ?? new Date()).toISOString(),
    name: args.name,
    blurLocation: args.blurLocation,
    site: redactSite(args.site, args.blurLocation),
    scenario: clone(args.data),
    customSpecies: clone(args.customSpecies.filter((s) => used.has(s.id))),
    siteOverrides: clone(args.siteOverrides),
    view: args.view,
  };
}

export type ParsedSnapshot =
  | { ok: true; snapshot: ShareSnapshot; warnings: string[] }
  | { ok: false; errors: string[] };

/** Check a snapshot a viewer downloaded before showing it. The server is not trusted to send well-formed data. */
export function parseShareSnapshot(raw: unknown, ctx: ValidationContext): ParsedSnapshot {
  if (!isRecord(raw) || raw.format !== SHARE_FORMAT) return { ok: false, errors: ['This link does not hold a plan this app can open.'] };
  const custom = validateCustomSpecies(raw.customSpecies);
  const check = validateScenarioData(raw.scenario, ctx, new Set(custom.species.map((s) => s.id)));
  const errors = [...custom.errors, ...check.errors];
  const site = raw.site as SiteConfig | undefined;
  if (!isRecord(site) || !isRecord((site as unknown as Record<string, unknown>).lot) || !Array.isArray(site.structures) || !Array.isArray(site.zones) || !isNum(site.latitude) || !isNum(site.longitude)) {
    errors.push('The shared site is missing or malformed.');
  }
  if (typeof raw.name !== 'string') errors.push('The shared plan has no name.');
  if (errors.length || !check.data) return { ok: false, errors };
  const view = isRecord(raw.view) && isNum(raw.view.timelineMonth) && isNum(raw.view.doy) ? { timelineMonth: raw.view.timelineMonth, doy: raw.view.doy } : { timelineMonth: 0, doy: 172 };
  return {
    ok: true,
    warnings: check.warnings,
    snapshot: {
      format: SHARE_FORMAT, createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '', name: raw.name as string,
      blurLocation: raw.blurLocation === true || raw.hideAddress === true, site: site as SiteConfig, scenario: check.data, customSpecies: custom.species,
      siteOverrides: validateOverrides(raw.siteOverrides, { ...ctx, zoneIds: new Set((site as SiteConfig).zones.map((z) => z.id)) }), view,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Comparison (SC-3)
// ---------------------------------------------------------------------------------------------

export interface MetricsContext {
  site: SiteConfig;
  engine: EngineConfig;
  water: WaterConfig;
  species: Species[];
  materials: Material[];
  timelineMonth: number;
  /** Root ball sizes by container (`soil.containers`), for the watered-area floor. */
  containers?: SoilConfig['containers'];
}

export interface ScenarioMetrics {
  plants: number;
  /** Sum of each plant's canopy area, so overlapping canopies count twice. */
  canopySf: number;
  annualWaterGal: number;
  hardscapeSf: number;
  hardscapeCuYd: number;
  conflicts: number;
  highValueShare: number;
  bloomGapMonths: number;
  /** Estimated cost of the new plants and hardscape, in dollars. */
  projectCost: number;
}

/** The numbers the brief asks to compare: plant count, canopy cover, annual water, materials, conflicts. */
export function scenarioMetrics(data: ScenarioData, ctx: MetricsContext): ScenarioMetrics {
  const plants = placedPlants(data.instances, data.palette, ctx.species, ctx.timelineMonth, ctx.engine.growth);
  const canopySf = plants.reduce((a, p) => a + Math.PI * (p.size.width / 2) ** 2, 0);
  const demand = waterDemand({
    plants, lawns: data.hardscape.filter((e) => e.type === 'lawn'), hydrozones: data.hydrozones, autoIrrigation: data.autoIrrigation,
    zones: ctx.site.zones, timelineMonth: ctx.timelineMonth, water: ctx.water, growth: ctx.engine.growth, hardscapeCfg: ctx.engine.hardscape, useRain: data.useRain, containers: ctx.containers,
  });
  const tk = takeoff(data.hardscape, ctx.materials, ctx.engine.hardscape).total;
  const conflicts = detectConflicts({
    instances: data.instances, palette: data.palette, species: ctx.species,
    structures: activeStructures(ctx.site, { aduEnabled: data.aduEnabled }), elements: data.hardscape, easements: ctx.site.easements, contextTrees: [],
    lot: ctx.site.lot, cfg: ctx.engine, maxMonths: ctx.engine.timeline.maxYears * 12,
  });
  const cal = bloomCalendar(plants, ctx.water.pollinator);
  const high = plants.filter((p) => p.species.pollinator.value === 'high').length;
  return {
    plants: plants.length, canopySf, annualWaterGal: demand.lot.annualGal, hardscapeSf: tk.areaSf, hardscapeCuYd: tk.surfaceCuYd + tk.baseCuYd,
    conflicts: conflicts.length, highValueShare: plants.length ? high / plants.length : 0, bloomGapMonths: plants.length ? cal.gaps.length : 12,
    projectCost: projectCost(plants, data.hardscape, ctx.materials, ctx.engine, data.prices ?? emptyPrices()).total,
  };
}

export interface CompareRow {
  id: keyof ScenarioMetrics;
  label: string;
  unit: string;
  a: number;
  b: number;
  delta: number;
  /** Which direction is better, or null when neither is. */
  better: 'lower' | 'higher' | null;
}

const ROWS: { id: keyof ScenarioMetrics; label: string; unit: string; better: 'lower' | 'higher' | null }[] = [
  { id: 'plants', label: 'Plants', unit: '', better: null },
  { id: 'canopySf', label: 'Canopy cover', unit: 'sq ft', better: null },
  { id: 'annualWaterGal', label: 'Water per year', unit: 'gal', better: 'lower' },
  { id: 'hardscapeSf', label: 'New hardscape area', unit: 'sq ft', better: null },
  { id: 'hardscapeCuYd', label: 'Hardscape surface + base', unit: 'cu yd', better: null },
  { id: 'projectCost', label: 'Estimated cost', unit: 'USD', better: 'lower' },
  { id: 'conflicts', label: 'Conflicts', unit: '', better: 'lower' },
  { id: 'highValueShare', label: 'High-value pollinator plants', unit: '%', better: 'higher' },
  { id: 'bloomGapMonths', label: 'Months with no high-value bloom', unit: 'months', better: 'lower' },
];

export function compareMetrics(a: ScenarioMetrics, b: ScenarioMetrics): CompareRow[] {
  return ROWS.map((r) => {
    const pct = r.id === 'highValueShare' ? 100 : 1;
    const av = a[r.id] * pct, bv = b[r.id] * pct;
    return { ...r, a: av, b: bv, delta: bv - av };
  });
}
