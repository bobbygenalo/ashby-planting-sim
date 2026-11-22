import { createStore, useStore } from 'zustand';
import siteRaw from '../data/site.json';
import engineRaw from '../data/engine.json';
import type { Conflict } from '../engine/conflicts';
import { polygonArea, polylineLength } from '../engine/geometry';
import type { SuggestResult, SuggestWeights } from '../engine/suggest';
import { loadSite } from '../engine/site';
import {
  validateScenarioData, buildShareSnapshot, clone, emptyScenarioData, parseScenarioFile, serializeScenarioFile,
  type ScenarioData, type ScenarioMeta, type ShareRecord, type ShareSnapshot, type SiteOverrides, type ValidationContext, type Workspace,
} from '../engine/scenario';
import { doyToMonthDay, monthDayToDoy } from '../engine/time';
import speciesRaw from '../data/species.json';
import materialsRaw from '../data/materials.json';
import waterRaw from '../data/water.json';
import soilRaw from '../data/soil.json';
import type {
  ContainerId, EngineConfig, HardscapeElement, HardscapeType, Hydrozone, Irrigation, Material, PlantInstance, Pt, SiteConfig, SoilConfig,
  SoilProfile, Species, SpeciesLibrary, WaterConfig,
} from '../engine/types';

/** The parts of a scenario that undo and redo restore. */
export interface ScenarioSnapshot {
  instances: PlantInstance[];
  palette: Record<string, boolean>;
  hardscape: HardscapeElement[];
  hydrozones: Hydrozone[];
  autoIrrigation: Record<string, Irrigation>;
  useRain: boolean;
}

export type HsDrag = { id: string; kind: 'vertex'; index: number } | { id: string; kind: 'move'; last: Pt };

export type Mode = 'edit' | 'view';

export interface Layers {
  sunHours: boolean;
  dimensions: boolean;
  setbacks: boolean;
  easements: boolean;
  context: boolean;
  /** Tint blooming plants with their bloom color (POL-7). */
  bloom: boolean;
  /** Placement heatmap and the top spots. */
  suggestions: boolean;
  /** Red rings on plants that have a conflict. */
  conflicts: boolean;
}

export interface AppState {
  mode: Mode;
  site: SiteConfig;
  engine: EngineConfig;
  /** Plan setting: model the lot with the ADU. A mutation, so blocked in view mode. */
  aduEnabled: boolean;
  /** Viewer-safe display state follows. */
  layers: Layers;
  doy: number;
  minutes: number;
  playing: boolean;
  view: string;
  sunPeriod: string; // 'day' or a season id
  measureActive: boolean;
  measurePoints: Pt[];
  snap: number;

  setAduEnabled: (v: boolean) => void;
  replaceSite: (site: SiteConfig) => void;
  setLayer: (k: keyof Layers, v: boolean) => void;
  setDoy: (d: number) => void;
  setMinutes: (m: number) => void;
  setPlaying: (p: boolean) => void;
  setView: (v: string) => void;
  setSunPeriod: (p: string) => void;
  setMeasureActive: (a: boolean) => void;
  addMeasurePoint: (p: Pt) => void;
  clearMeasure: () => void;
  setSnap: (s: number) => void;

  library: SpeciesLibrary;
  /** Species selected into the scenario palette. */
  palette: Record<string, boolean>;
  instances: PlantInstance[];
  /** Timeline position in months from planting day, 0 to maxYears * 12. */
  timelineMonth: number;
  timelinePlaying: boolean;
  selectedId: string | null;
  placingSpeciesId: string | null;
  placeContainer: ContainerId;
  hover: Pt | null;
  dragId: string | null;

  addSpecies: (sp: Species) => void;
  setDrag: (id: string | null) => void;
  setPaletteSpecies: (id: string, on: boolean) => void;
  addInstance: (speciesId: string, position: Pt, opts?: Partial<PlantInstance>) => string | null;
  updateInstance: (id: string, patch: Partial<Omit<PlantInstance, 'id'>>, opts?: { silent?: boolean }) => void;
  duplicateInstance: (id: string) => void;
  deleteInstance: (id: string) => void;
  setTimelineMonth: (m: number) => void;
  setTimelinePlaying: (p: boolean) => void;
  select: (id: string | null) => void;
  setPlacing: (id: string | null) => void;
  setPlaceContainer: (c: ContainerId) => void;
  materials: Material[];
  hardscape: HardscapeElement[];
  drawing: { type: HardscapeType; points: Pt[] } | null;
  selectedElementId: string | null;
  hsDrag: HsDrag | null;
  /** What the pointer snapped to while drawing or dragging a vertex, for the cursor color. */
  hoverSnap: 'vertex' | 'edge' | 'grid';
  history: { past: ScenarioSnapshot[]; future: ScenarioSnapshot[]; key?: string; t: number };

  undo: () => void;
  redo: () => void;
  /** Record one undo step before a drag begins; the drag itself then updates silently. */
  beginGesture: () => void;
  startDrawing: (type: HardscapeType | null) => void;
  addDrawPoint: (p: Pt) => void;
  removeLastDrawPoint: () => void;
  finishDrawing: () => string | null;
  /** Keep a drawing in progress if it already has enough points (switching tools never throws it away). */
  commitDrawing: () => void;
  /** Copy an element (offset slightly, as new work) and select the copy. */
  duplicateElement: (id: string, offset?: Pt) => string | null;
  selectElement: (id: string | null) => void;
  updateElement: (id: string, patch: Partial<Omit<HardscapeElement, 'id'>>, opts?: { silent?: boolean }) => void;
  setElementMaterial: (id: string, materialId: string) => void;
  moveElementBy: (id: string, dx: number, dy: number) => void;
  setVertex: (id: string, index: number, p: Pt) => void;
  deleteElement: (id: string) => void;
  setHsDrag: (d: HsDrag | null) => void;

  /** Latest conflict scan over the whole timeline. Derived, so it is not part of undo. */
  conflicts: Conflict[];
  setConflicts: (c: Conflict[]) => void;
  suggestWeights: SuggestWeights;
  setSuggestWeights: (w: SuggestWeights) => void;
  suggestion: { result: SuggestResult; speciesId: string } | null;
  setSuggestion: (s: { result: SuggestResult; speciesId: string } | null) => void;
  /** Which of the top spots is highlighted in the yard. */
  suggestFocus: number | null;
  setSuggestFocus: (i: number | null) => void;

  /** Scenarios (SC-1). The active one lives in the fields above; the others are held in `saved`. */
  sheetOpen: boolean;
  setSheetOpen: (o: boolean) => void;
  scenarios: ScenarioMeta[];
  activeScenarioId: string;
  saved: Record<string, ScenarioData>;
  shares: ShareRecord[];
  /** Set when viewing someone's shared plan: its name and when it was published. */
  shared: { name: string; hideAddress: boolean; createdAt: string } | null;
  saveStatus: { state: 'idle' | 'saved' | 'error'; at: string | null; message: string | null };
  setSaveStatus: (s: AppState['saveStatus']) => void;

  createScenario: (name?: string, fromId?: string) => string | null;
  renameScenario: (id: string, name: string) => void;
  deleteScenario: (id: string) => boolean;
  switchScenario: (id: string) => void;
  importScenarioFile: (text: string) => { ok: true; id: string; name: string; warnings: string[] } | { ok: false; errors: string[] };
  exportScenario: (id: string) => { name: string; text: string } | null;
  toWorkspace: () => Workspace;
  hydrateWorkspace: (ws: Workspace) => void;
  /** Owner: the snapshot to publish for a scenario. */
  buildSnapshot: (id: string, hideAddress: boolean) => ShareSnapshot | null;
  addShare: (r: ShareRecord) => void;
  patchShare: (token: string, patch: Partial<ShareRecord>) => void;
  /** Viewer: show a shared plan. Switches the app to view mode. */
  loadShared: (s: ShareSnapshot) => void;

  water: WaterConfig;
  soil: SoilConfig;
  hydrozones: Hydrozone[];
  /** Irrigation type for automatic hydrozones, keyed by their id (for example auto:low). */
  autoIrrigation: Record<string, Irrigation>;
  /** Subtract effective rainfall from demand (WS-8). */
  useRain: boolean;
  soilProfiles: Record<string, SoilProfile>;
  /** Yard zones the owner tags as play areas (POL-6). */
  playZones: Record<string, boolean>;

  addHydrozone: (name: string, irrigation: Irrigation) => string | null;
  updateHydrozone: (id: string, patch: Partial<Omit<Hydrozone, 'id'>>) => void;
  deleteHydrozone: (id: string) => void;
  assignHydrozone: (instanceId: string, hydrozoneId: string | null) => void;
  setAutoIrrigation: (autoId: string, irrigation: Irrigation) => void;
  setUseRain: (on: boolean) => void;
  setSoilProfile: (zoneId: string, patch: Partial<SoilProfile>) => void;
  setPlayZone: (zoneId: string, on: boolean) => void;
  setHover: (p: Pt | null, kind?: 'vertex' | 'edge' | 'grid') => void;
}

const engine = engineRaw as unknown as EngineConfig;
const library = speciesRaw as unknown as SpeciesLibrary;
const materials = materialsRaw as unknown as Material[];
const water = waterRaw as unknown as WaterConfig;
const soil = soilRaw as unknown as SoilConfig;
const baseSpeciesIds = new Set(library.species.map((s) => s.id));
let idCounter = 0;
/** Ids stay unique across sessions: a restored workspace can hold ids a fresh counter would hand out again. */
const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function makeAppStore(mode: Mode, site: SiteConfig = loadSite(siteRaw)) {
  const initial = emptyScenarioData(site);
  const firstScenarioId = uid('s');
  const stamp = () => new Date().toISOString();
  return createStore<AppState>()((set, get) => {
    // Plan mutations go through this guard; view mode cannot change them even if the UI is bypassed.
    const mutate = (patch: Partial<AppState>) => {
      if (get().mode !== 'edit') return;
      set(patch);
    };
    const snapshot = (): ScenarioSnapshot => ({
      instances: get().instances, palette: get().palette, hardscape: get().hardscape,
      hydrozones: get().hydrozones, autoIrrigation: get().autoIrrigation, useRain: get().useRain,
    });
    // Push an undo step. Repeated edits with the same key within a second count as one step.
    const record = (key?: string) => {
      set({ scenarios: get().scenarios.map((s) => (s.id === get().activeScenarioId ? { ...s, modifiedAt: stamp() } : s)) });
      const h = get().history;
      const now = Date.now();
      if (key && h.key === key && now - h.t < 1000) {
        set({ history: { ...h, t: now, future: [] } });
        return;
      }
      set({ history: { past: [...h.past.slice(-99), snapshot()], future: [], key, t: now } });
    };
    // A scenario edit: blocked in view mode, otherwise recorded for undo, then applied.
    const scenario = (patch: Partial<AppState>, key?: string) => {
      if (get().mode !== 'edit') return;
      record(key);
      set(patch);
    };
    const restore = (s: ScenarioSnapshot) => {
      const selId = get().selectedId;
      const selEl = get().selectedElementId;
      set({
        ...s,
        selectedId: s.instances.some((i) => i.id === selId) ? selId : null,
        selectedElementId: s.hardscape.some((e) => e.id === selEl) ? selEl : null,
      });
    };
    const currentData = (): ScenarioData => ({
      palette: get().palette, instances: get().instances, hardscape: get().hardscape, hydrozones: get().hydrozones,
      autoIrrigation: get().autoIrrigation, useRain: get().useRain, aduEnabled: get().aduEnabled,
    });
    // Replace the working fields with a scenario's data and clear everything tied to the old one.
    const applyData = (d: ScenarioData) =>
      set({
        ...clone(d), history: { past: [], future: [], t: 0 }, selectedId: null, selectedElementId: null, placingSpeciesId: null, drawing: null,
        hsDrag: null, dragId: null, measureActive: false, measurePoints: [], suggestion: null, suggestFocus: null,
      });
    const customSpeciesList = () => get().library.species.filter((s) => !baseSpeciesIds.has(s.id));
    const siteOverrides = (): SiteOverrides => ({ soilProfiles: get().soilProfiles, playZones: get().playZones });
    const validationContext = (extra: Species[] = []): ValidationContext => ({
      speciesIds: new Set([...get().library.species.map((s) => s.id), ...extra.map((s) => s.id)]), containers: new Set(Object.keys(engine.growth.containers)),
      hardscapeTypes: new Set(Object.keys(engine.hardscape.types)), materialIds: new Set(get().materials.map((m) => m.id)), zoneIds: new Set(get().site.zones.map((z) => z.id)),
    });
    const dataFor = (id: string): ScenarioData | undefined => (id === get().activeScenarioId ? currentData() : get().saved[id]);
    const without = <T,>(rec: Record<string, T>, key: string) => Object.fromEntries(Object.entries(rec).filter(([k]) => k !== key));
    // Add a scenario and make it the active one, parking the current one.
    const addScenario = (name: string, data: ScenarioData): string => {
      const id = uid('s');
      const t = stamp();
      set({
        saved: { ...get().saved, [get().activeScenarioId]: clone(currentData()) },
        scenarios: [...get().scenarios, { id, name, createdAt: t, modifiedAt: t }],
        activeScenarioId: id,
      });
      applyData(data);
      return id;
    };
    // Merge species an imported scenario brings. A different species with an id already in use is renamed, never overwritten.
    const mergeCustomSpecies = (incoming: Species[]): Map<string, string> => {
      const remap = new Map<string, string>();
      const lib = [...get().library.species];
      for (const s of incoming) {
        const existing = lib.find((x) => x.id === s.id);
        if (!existing) { lib.push(s); continue; }
        if (JSON.stringify(existing) === JSON.stringify(s)) continue;
        let n = 2;
        while (lib.some((x) => x.id === `${s.id}-${n}`)) n++;
        remap.set(s.id, `${s.id}-${n}`);
        lib.push({ ...s, id: `${s.id}-${n}` });
      }
      set({ library: { ...get().library, species: lib } });
      return remap;
    };

    return {
      mode,
      site,
      engine,
      aduEnabled: true,
      layers: { sunHours: true, dimensions: false, setbacks: true, easements: true, context: true, bloom: true, suggestions: true, conflicts: true },
      doy: monthDayToDoy(6, 21),
      minutes: 12 * 60,
      playing: false,
      view: 'orbit',
      sunPeriod: 'day',
      measureActive: false,
      measurePoints: [],
      snap: engine.scene.snapDefaultFt,

      setAduEnabled: (v) => mutate({ aduEnabled: v }),
      replaceSite: (s) => mutate({ site: s }),
      setLayer: (k, v) => set({ layers: { ...get().layers, [k]: v } }),
      setDoy: (d) => set({ doy: Math.min(365, Math.max(1, Math.round(d))) }),
      setMinutes: (m) => set({ minutes: Math.min(1439, Math.max(0, m)) }),
      setPlaying: (p) => set({ playing: p }),
      setView: (v) => set({ view: v }),
      setSunPeriod: (p) => set({ sunPeriod: p }),
      setMeasureActive: (a) => {
        get().commitDrawing();
        set({ measureActive: a, measurePoints: [], placingSpeciesId: null, drawing: null });
      },
      addMeasurePoint: (p) => {
        const pts = get().measurePoints;
        set({ measurePoints: pts.length >= 2 ? [p] : [...pts, p] });
      },
      clearMeasure: () => set({ measurePoints: [] }),
      setSnap: (s) => set({ snap: s }),

      library,
      palette: initial.palette,
      instances: initial.instances,
      timelineMonth: 0,
      timelinePlaying: false,
      selectedId: null,
      placingSpeciesId: null,
      placeContainer: '5gal',
      hover: null,
      dragId: null,

      addSpecies: (sp) =>
        scenario({ library: { ...get().library, species: [...get().library.species, sp] }, palette: { ...get().palette, [sp.id]: true } }),
      setDrag: (id) => set({ dragId: get().mode === 'edit' ? id : null }),
      setPaletteSpecies: (id, on) => scenario({ palette: { ...get().palette, [id]: on } }),
      addInstance: (speciesId, position, opts = {}) => {
        if (get().mode !== 'edit') return null;
        const id = uid('p');
        const inst: PlantInstance = {
          id,
          speciesId,
          position,
          plantedMonth: get().timelineMonth,
          container: get().placeContainer,
          existing: false,
          ...opts,
        };
        record();
        set({ instances: [...get().instances, inst], selectedId: id, selectedElementId: null });
        return id;
      },
      updateInstance: (id, patch, opts) => {
        const next = { instances: get().instances.map((i) => (i.id === id ? { ...i, ...patch } : i)) };
        if (opts?.silent) mutate(next);
        else scenario(next, `inst:${id}`);
      },
      duplicateInstance: (id) => {
        const src = get().instances.find((i) => i.id === id);
        if (!src || get().mode !== 'edit') return;
        const copy = { ...src, id: uid('p'), position: [src.position[0] + 2, src.position[1]] as Pt };
        record();
        set({ instances: [...get().instances, copy], selectedId: copy.id, selectedElementId: null });
      },
      deleteInstance: (id) => {
        if (get().mode !== 'edit') return;
        record();
        set({ instances: get().instances.filter((i) => i.id !== id), selectedId: get().selectedId === id ? null : get().selectedId });
      },
      setTimelineMonth: (m) => set({ timelineMonth: Math.min(engine.timeline.maxYears * 12, Math.max(0, Math.round(m))) }),
      setTimelinePlaying: (p) => set({ timelinePlaying: p }),
      select: (id) => set({ selectedId: id, selectedElementId: id ? null : get().selectedElementId }),
      setPlacing: (id) => {
        get().commitDrawing();
        set({ placingSpeciesId: get().mode === 'edit' ? id : null, measureActive: false, drawing: null });
      },
      setPlaceContainer: (c) => set({ placeContainer: c }),
      setHover: (p, kind) => set({ hover: p, hoverSnap: kind ?? 'grid' }),

      materials,
      hardscape: initial.hardscape,
      drawing: null,
      selectedElementId: null,
      hsDrag: null,
      hoverSnap: 'grid',
      history: { past: [], future: [], t: 0 },

      undo: () => {
        const h = get().history;
        if (get().mode !== 'edit' || h.past.length === 0) return;
        const prev = h.past[h.past.length - 1];
        set({ history: { past: h.past.slice(0, -1), future: [snapshot(), ...h.future], t: 0 } });
        restore(prev);
      },
      redo: () => {
        const h = get().history;
        if (get().mode !== 'edit' || h.future.length === 0) return;
        const next = h.future[0];
        set({ history: { past: [...h.past, snapshot()], future: h.future.slice(1), t: 0 } });
        restore(next);
      },
      beginGesture: () => {
        if (get().mode === 'edit') record();
      },
      startDrawing: (type) => {
        if (get().mode !== 'edit') return;
        // Picking another type keeps what was drawn so far; Esc and Cancel (type null) discard it.
        if (type) get().commitDrawing();
        set({ drawing: type ? { type, points: [] } : null, placingSpeciesId: null, measureActive: false, selectedId: null, selectedElementId: null });
      },
      addDrawPoint: (p) => {
        const d = get().drawing;
        if (!d || get().mode !== 'edit') return;
        const last = d.points[d.points.length - 1];
        if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) < engine.hardscape.snapToleranceFt * 0.1) return;
        set({ drawing: { ...d, points: [...d.points, p] } });
      },
      removeLastDrawPoint: () => {
        const d = get().drawing;
        if (d) set({ drawing: { ...d, points: d.points.slice(0, -1) } });
      },
      finishDrawing: () => {
        const d = get().drawing;
        if (!d || get().mode !== 'edit') return null;
        const cfgT = engine.hardscape.types[d.type];
        const need = cfgT.shape === 'line' ? 2 : 3;
        if (d.points.length < need) return null;
        // Reject collapsed shapes (all corners on one line, or a path with no length).
        if (cfgT.shape === 'line' ? polylineLength(d.points) < 0.5 : polygonArea(d.points) < 0.5) return null;
        const id = uid('h');
        const el: HardscapeElement = {
          id, type: d.type, points: d.points, materialId: cfgT.material, height: cfgT.height, depthIn: cfgT.depthIn, width: cfgT.width, existing: false,
        };
        record();
        set({ hardscape: [...get().hardscape, el], drawing: null, selectedElementId: id, hover: null });
        return id;
      },
      commitDrawing: () => {
        const d = get().drawing;
        if (d) get().finishDrawing();
      },
      duplicateElement: (id, offset = [2, 2]) => {
        const src = get().hardscape.find((e) => e.id === id);
        if (!src || get().mode !== 'edit') return null;
        const copyId = uid('h');
        const { removed: _removed, keepClear: _keepClear, ...rest } = src;
        void _removed; void _keepClear;
        const copy: HardscapeElement = {
          ...clone(rest), id: copyId, existing: false, points: src.points.map(([x, y]): Pt => [x + offset[0], y + offset[1]]),
          name: src.name ? `${src.name} copy` : undefined,
        };
        scenario({ hardscape: [...get().hardscape, copy], selectedElementId: copyId, selectedId: null });
        return copyId;
      },
      selectElement: (id) => set({ selectedElementId: id, selectedId: id ? null : get().selectedId }),
      updateElement: (id, patch, opts) => {
        const next = { hardscape: get().hardscape.map((e) => (e.id === id ? { ...e, ...patch } : e)) };
        if (opts?.silent) mutate(next);
        else scenario(next, `el:${id}`);
      },
      setElementMaterial: (id, materialId) => {
        const m = get().materials.find((x) => x.id === materialId);
        if (!m) return;
        scenario({ hardscape: get().hardscape.map((e) => (e.id === id ? { ...e, materialId, depthIn: m.defaultDepthIn } : e)) });
      },
      moveElementBy: (id, dx, dy) =>
        mutate({ hardscape: get().hardscape.map((e) => (e.id === id ? { ...e, points: e.points.map(([x, y]): Pt => [x + dx, y + dy]) } : e)) }),
      setVertex: (id, index, p) =>
        mutate({ hardscape: get().hardscape.map((e) => (e.id === id ? { ...e, points: e.points.map((q, i): Pt => (i === index ? p : q)) } : e)) }),
      deleteElement: (id) => {
        const el = get().hardscape.find((e) => e.id === id);
        if (!el || get().mode !== 'edit') return;
        // Existing elements are kept in the file and marked removed so a scenario can restore them.
        if (el.existing) scenario({ hardscape: get().hardscape.map((e) => (e.id === id ? { ...e, removed: !e.removed } : e)) });
        else scenario({ hardscape: get().hardscape.filter((e) => e.id !== id), selectedElementId: get().selectedElementId === id ? null : get().selectedElementId });
      },
      setHsDrag: (d) => set({ hsDrag: get().mode === 'edit' ? d : null }),

      conflicts: [],
      setConflicts: (c) => set({ conflicts: c }),
      suggestWeights: { ...engine.suggest.weights },
      setSuggestWeights: (w) => set({ suggestWeights: w }),
      suggestion: null,
      setSuggestion: (s) => set({ suggestion: s, suggestFocus: s ? 0 : null }),
      suggestFocus: null,
      setSuggestFocus: (i) => set({ suggestFocus: i }),

      sheetOpen: false,
      setSheetOpen: (o) => set({ sheetOpen: o }),
      scenarios: [{ id: firstScenarioId, name: 'Scenario 1', createdAt: stamp(), modifiedAt: stamp() }],
      activeScenarioId: firstScenarioId,
      saved: {},
      shares: [],
      shared: null,
      saveStatus: { state: 'idle', at: null, message: null },
      setSaveStatus: (s) => set({ saveStatus: s }),

      createScenario: (name, fromId) => {
        if (get().mode !== 'edit') return null;
        if (fromId) {
          const src = dataFor(fromId);
          const meta = get().scenarios.find((s) => s.id === fromId);
          if (!src || !meta) return null;
          return addScenario(name?.trim() || `${meta.name} copy`, clone(src));
        }
        return addScenario(name?.trim() || `Scenario ${get().scenarios.length + 1}`, emptyScenarioData(get().site));
      },
      renameScenario: (id, name) => {
        if (get().mode !== 'edit' || !name.trim()) return;
        set({ scenarios: get().scenarios.map((s) => (s.id === id ? { ...s, name: name.trim(), modifiedAt: stamp() } : s)) });
      },
      deleteScenario: (id) => {
        const { scenarios, activeScenarioId, saved } = get();
        if (get().mode !== 'edit' || scenarios.length <= 1 || !scenarios.some((s) => s.id === id)) return false;
        const rest = scenarios.filter((s) => s.id !== id);
        if (id === activeScenarioId) {
          const next = rest[0].id;
          set({ scenarios: rest, activeScenarioId: next, saved: without(saved, next) });
          applyData(saved[next]);
        } else {
          set({ scenarios: rest, saved: without(saved, id) });
        }
        return true;
      },
      switchScenario: (id) => {
        const { activeScenarioId, saved, scenarios } = get();
        if (get().mode !== 'edit' || id === activeScenarioId || !saved[id] || !scenarios.some((s) => s.id === id)) return;
        const target = saved[id];
        set({ saved: { ...without(saved, id), [activeScenarioId]: clone(currentData()) }, activeScenarioId: id });
        applyData(target);
      },
      importScenarioFile: (text) => {
        if (get().mode !== 'edit') return { ok: false, errors: ['A shared view cannot import scenarios.'] };
        const parsed = parseScenarioFile(text, validationContext());
        if (!parsed.ok) return parsed;
        const remap = mergeCustomSpecies(parsed.customSpecies);
        const data = clone(parsed.data);
        if (remap.size) {
          data.instances = data.instances.map((i) => (remap.has(i.speciesId) ? { ...i, speciesId: remap.get(i.speciesId)! } : i));
          data.palette = Object.fromEntries(Object.entries(data.palette).map(([k, v]) => [remap.get(k) ?? k, v]));
        }
        // The file's soil results fill zones the owner has not filled in. They never replace what the owner entered.
        const profiles = { ...get().soilProfiles };
        for (const [zone, p] of Object.entries(parsed.siteOverrides.soilProfiles)) if (profiles[zone]?.isDefault) profiles[zone] = p;
        const play = { ...get().playZones };
        for (const [zone, on] of Object.entries(parsed.siteOverrides.playZones)) if (play[zone] === undefined) play[zone] = on;
        set({ soilProfiles: profiles, playZones: play });
        const id = addScenario(parsed.name, data);
        return { ok: true, id, name: parsed.name, warnings: parsed.warnings };
      },
      exportScenario: (id) => {
        const data = dataFor(id);
        const meta = get().scenarios.find((s) => s.id === id);
        if (!data || !meta) return null;
        return { name: meta.name, text: serializeScenarioFile({ name: meta.name, data, customSpecies: customSpeciesList(), siteOverrides: siteOverrides() }) };
      },
      toWorkspace: () => ({
        format: 'ashby-workspace/1',
        scenarios: get().scenarios,
        data: { ...get().saved, [get().activeScenarioId]: currentData() },
        activeId: get().activeScenarioId,
        customSpecies: customSpeciesList(),
        siteOverrides: siteOverrides(),
        shares: get().shares,
      }),
      hydrateWorkspace: (ws) => {
        if (get().mode !== 'edit') return;
        // Saved data can be old or damaged. Keep only the scenarios that check out.
        const ctx = validationContext(ws.customSpecies);
        const good: { meta: ScenarioMeta; data: ScenarioData }[] = [];
        for (const meta of ws.scenarios) {
          const check = validateScenarioData(ws.data[meta.id], ctx);
          if (check.data) good.push({ meta, data: check.data });
        }
        if (good.length === 0) return;
        mergeCustomSpecies(Array.isArray(ws.customSpecies) ? ws.customSpecies : []);
        const active = good.find((g) => g.meta.id === ws.activeId) ?? good[0];
        const soilProfiles = { ...get().soilProfiles, ...(ws.siteOverrides?.soilProfiles ?? {}) };
        set({
          scenarios: good.map((g) => g.meta), activeScenarioId: active.meta.id,
          saved: Object.fromEntries(good.filter((g) => g !== active).map((g) => [g.meta.id, g.data])),
          shares: Array.isArray(ws.shares) ? ws.shares : [], soilProfiles, playZones: { ...(ws.siteOverrides?.playZones ?? {}) },
        });
        applyData(active.data);
      },
      buildSnapshot: (id, hideAddress) => {
        const data = dataFor(id);
        const meta = get().scenarios.find((s) => s.id === id);
        if (!data || !meta) return null;
        return buildShareSnapshot({
          name: meta.name, site: get().site, data, customSpecies: customSpeciesList(), siteOverrides: siteOverrides(), hideAddress,
          view: { timelineMonth: get().timelineMonth, doy: get().doy },
        });
      },
      addShare: (r) => {
        if (get().mode === 'edit') set({ shares: [...get().shares, r] });
      },
      patchShare: (token, patch) => {
        if (get().mode === 'edit') set({ shares: get().shares.map((s) => (s.token === token ? { ...s, ...patch } : s)) });
      },
      loadShared: (snap) => {
        const base = library.species;
        const extra = snap.customSpecies.filter((s) => !baseSpeciesIds.has(s.id));
        set({
          mode: 'view',
          site: snap.site,
          library: { ...library, species: [...base, ...extra] },
          soilProfiles: { ...Object.fromEntries(snap.site.zones.map((z) => [z.id, { ...soil.defaultProfile }])), ...snap.siteOverrides.soilProfiles },
          playZones: { ...snap.siteOverrides.playZones },
          timelineMonth: snap.view.timelineMonth,
          doy: snap.view.doy,
          view: 'orbit',
          scenarios: [{ id: 'shared', name: snap.name, createdAt: snap.createdAt, modifiedAt: snap.createdAt }],
          activeScenarioId: 'shared',
          saved: {},
          shares: [],
          shared: { name: snap.name, hideAddress: snap.hideAddress, createdAt: snap.createdAt },
        });
        applyData(snap.scenario);
      },

      water,
      soil,
      hydrozones: [],
      autoIrrigation: {},
      useRain: false,
      soilProfiles: Object.fromEntries(site.zones.map((z) => [z.id, { ...soil.defaultProfile }])),
      playZones: {},

      addHydrozone: (name, irrigation) => {
        if (get().mode !== 'edit' || !name.trim()) return null;
        const id = uid('z');
        scenario({ hydrozones: [...get().hydrozones, { id, name: name.trim(), irrigation }] });
        return id;
      },
      updateHydrozone: (id, patch) =>
        scenario({ hydrozones: get().hydrozones.map((h) => (h.id === id ? { ...h, ...patch } : h)) }, `hz:${id}`),
      deleteHydrozone: (id) =>
        scenario({
          hydrozones: get().hydrozones.filter((h) => h.id !== id),
          instances: get().instances.map((i) => (i.hydrozoneId === id ? { ...i, hydrozoneId: undefined } : i)),
        }),
      assignHydrozone: (instanceId, hydrozoneId) =>
        scenario({ instances: get().instances.map((i) => (i.id === instanceId ? { ...i, hydrozoneId: hydrozoneId ?? undefined } : i)) }),
      setAutoIrrigation: (autoId, irrigation) => scenario({ autoIrrigation: { ...get().autoIrrigation, [autoId]: irrigation } }),
      setUseRain: (on) => scenario({ useRain: on }),
      // Soil results are site data the owner enters; they are not part of undo.
      setSoilProfile: (zoneId, patch) =>
        mutate({ soilProfiles: { ...get().soilProfiles, [zoneId]: { ...get().soilProfiles[zoneId], ...patch, isDefault: false } } }),
      setPlayZone: (zoneId, on) => mutate({ playZones: { ...get().playZones, [zoneId]: on } }),
    };
  });
}

// A page opened from a share link is always a viewer; so is `?mode=view`.
const initialMode: Mode =
  typeof location !== 'undefined' && (new URLSearchParams(location.search).get('mode') === 'view' || new URLSearchParams(location.search).has('share')) ? 'view' : 'edit';

export const appStore = makeAppStore(initialMode);
// Dev-only handle for inspecting state from the browser console.
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __app: typeof appStore }).__app = appStore;

export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(appStore, selector);
}

export const currentMonthDay = (s: AppState) => doyToMonthDay(s.doy);
