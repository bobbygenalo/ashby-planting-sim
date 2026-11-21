import { createStore, useStore } from 'zustand';
import siteRaw from '../data/site.json';
import engineRaw from '../data/engine.json';
import { polygonArea, polylineLength } from '../engine/geometry';
import { loadSite } from '../engine/site';
import { doyToMonthDay, monthDayToDoy } from '../engine/time';
import speciesRaw from '../data/species.json';
import materialsRaw from '../data/materials.json';
import type {
  ContainerId, EngineConfig, HardscapeElement, HardscapeType, Material, PlantInstance, Pt, SiteConfig, Species, SpeciesLibrary,
} from '../engine/types';

/** The parts of a scenario that undo and redo restore. */
export interface ScenarioSnapshot {
  instances: PlantInstance[];
  palette: Record<string, boolean>;
  hardscape: HardscapeElement[];
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
  selectElement: (id: string | null) => void;
  updateElement: (id: string, patch: Partial<Omit<HardscapeElement, 'id'>>, opts?: { silent?: boolean }) => void;
  setElementMaterial: (id: string, materialId: string) => void;
  moveElementBy: (id: string, dx: number, dy: number) => void;
  setVertex: (id: string, index: number, p: Pt) => void;
  deleteElement: (id: string) => void;
  setHsDrag: (d: HsDrag | null) => void;
  setHover: (p: Pt | null, kind?: 'vertex' | 'edge' | 'grid') => void;
}

const engine = engineRaw as unknown as EngineConfig;
const library = speciesRaw as unknown as SpeciesLibrary;
const materials = materialsRaw as unknown as Material[];
const OWNER_PICKS = ['salvia-leucantha','oenothera-lindheimeri','achillea-millefolium','lomandra-longifolia','bougainvillea','lantana-montevidensis','coleonema-pulchellum','coleonema-sunset-gold','polygala-myrtifolia','polygala-petite-butterflies','loropetalum-chinense','phormium-tenax','agapanthus-africanus','tulbaghia-violacea','phyla-nodiflora','juncus-patens','arctostaphylos-howard-mcminn'];
let nextId = 1;
let nextElementId = 1;

export function makeAppStore(mode: Mode, site: SiteConfig = loadSite(siteRaw)) {
  return createStore<AppState>()((set, get) => {
    // Plan mutations go through this guard; view mode cannot change them even if the UI is bypassed.
    const mutate = (patch: Partial<AppState>) => {
      if (get().mode !== 'edit') return;
      set(patch);
    };
    const snapshot = (): ScenarioSnapshot => ({ instances: get().instances, palette: get().palette, hardscape: get().hardscape });
    // Push an undo step. Repeated edits with the same key within a second count as one step.
    const record = (key?: string) => {
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
    return {
      mode,
      site,
      engine,
      aduEnabled: true,
      layers: { sunHours: true, dimensions: false, setbacks: true, easements: true, context: true, bloom: true },
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
      setMeasureActive: (a) => set({ measureActive: a, measurePoints: [], placingSpeciesId: null, drawing: null }),
      addMeasurePoint: (p) => {
        const pts = get().measurePoints;
        set({ measurePoints: pts.length >= 2 ? [p] : [...pts, p] });
      },
      clearMeasure: () => set({ measurePoints: [] }),
      setSnap: (s) => set({ snap: s }),

      library,
      palette: Object.fromEntries(OWNER_PICKS.map((id) => [id, true])),
      instances: [],
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
        if (get().mode !== 'edit' || !get().palette[speciesId]) return null;
        const id = `p${nextId++}`;
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
        const copy = { ...src, id: `p${nextId++}`, position: [src.position[0] + 2, src.position[1]] as Pt };
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
      setPlacing: (id) => set({ placingSpeciesId: get().mode === 'edit' ? id : null, measureActive: false, drawing: null }),
      setPlaceContainer: (c) => set({ placeContainer: c }),
      setHover: (p, kind) => set({ hover: p, hoverSnap: kind ?? 'grid' }),

      materials,
      hardscape: site.hardscape,
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
        const id = `h${nextElementId++}`;
        const el: HardscapeElement = {
          id, type: d.type, points: d.points, materialId: cfgT.material, height: cfgT.height, depthIn: cfgT.depthIn, width: cfgT.width, existing: false,
        };
        record();
        set({ hardscape: [...get().hardscape, el], drawing: null, selectedElementId: id, hover: null });
        return id;
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
    };
  });
}

const initialMode: Mode =
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('mode') === 'view' ? 'view' : 'edit';

export const appStore = makeAppStore(initialMode);
// Dev-only handle for inspecting state from the browser console.
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __app: typeof appStore }).__app = appStore;

export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(appStore, selector);
}

export const currentMonthDay = (s: AppState) => doyToMonthDay(s.doy);
