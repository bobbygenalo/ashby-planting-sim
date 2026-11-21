import { createStore, useStore } from 'zustand';
import siteRaw from '../data/site.json';
import engineRaw from '../data/engine.json';
import { loadSite } from '../engine/site';
import { doyToMonthDay, monthDayToDoy } from '../engine/time';
import speciesRaw from '../data/species.json';
import type { ContainerId, EngineConfig, PlantInstance, Pt, SiteConfig, Species, SpeciesLibrary } from '../engine/types';

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
  updateInstance: (id: string, patch: Partial<Omit<PlantInstance, 'id'>>) => void;
  duplicateInstance: (id: string) => void;
  deleteInstance: (id: string) => void;
  setTimelineMonth: (m: number) => void;
  setTimelinePlaying: (p: boolean) => void;
  select: (id: string | null) => void;
  setPlacing: (id: string | null) => void;
  setPlaceContainer: (c: ContainerId) => void;
  setHover: (p: Pt | null) => void;
}

const engine = engineRaw as unknown as EngineConfig;
const library = speciesRaw as unknown as SpeciesLibrary;
const OWNER_PICKS = ['salvia-leucantha','oenothera-lindheimeri','achillea-millefolium','lomandra-longifolia','bougainvillea','lantana-montevidensis','coleonema-pulchellum','coleonema-sunset-gold','polygala-myrtifolia','polygala-petite-butterflies','loropetalum-chinense','phormium-tenax','agapanthus-africanus','tulbaghia-violacea','phyla-nodiflora','juncus-patens','arctostaphylos-howard-mcminn'];
let nextId = 1;

export function makeAppStore(mode: Mode, site: SiteConfig = loadSite(siteRaw)) {
  return createStore<AppState>()((set, get) => {
    // Plan mutations go through this guard; view mode cannot change them even if the UI is bypassed.
    const mutate = (patch: Partial<AppState>) => {
      if (get().mode !== 'edit') return;
      set(patch);
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
      setMeasureActive: (a) => set({ measureActive: a, measurePoints: [] }),
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
        mutate({ library: { ...get().library, species: [...get().library.species, sp] }, palette: { ...get().palette, [sp.id]: true } }),
      setDrag: (id) => set({ dragId: get().mode === 'edit' ? id : null }),
      setPaletteSpecies: (id, on) => mutate({ palette: { ...get().palette, [id]: on } }),
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
        set({ instances: [...get().instances, inst], selectedId: id });
        return id;
      },
      updateInstance: (id, patch) =>
        mutate({ instances: get().instances.map((i) => (i.id === id ? { ...i, ...patch } : i)) }),
      duplicateInstance: (id) => {
        const src = get().instances.find((i) => i.id === id);
        if (!src || get().mode !== 'edit') return;
        const copy = { ...src, id: `p${nextId++}`, position: [src.position[0] + 2, src.position[1]] as Pt };
        set({ instances: [...get().instances, copy], selectedId: copy.id });
      },
      deleteInstance: (id) => {
        if (get().mode !== 'edit') return;
        set({ instances: get().instances.filter((i) => i.id !== id), selectedId: get().selectedId === id ? null : get().selectedId });
      },
      setTimelineMonth: (m) => set({ timelineMonth: Math.min(engine.timeline.maxYears * 12, Math.max(0, Math.round(m))) }),
      setTimelinePlaying: (p) => set({ timelinePlaying: p }),
      select: (id) => set({ selectedId: id }),
      setPlacing: (id) => set({ placingSpeciesId: get().mode === 'edit' ? id : null, measureActive: false }),
      setPlaceContainer: (c) => set({ placeContainer: c }),
      setHover: (p) => set({ hover: p }),
    };
  });
}

const initialMode: Mode =
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('mode') === 'view' ? 'view' : 'edit';

export const appStore = makeAppStore(initialMode);

export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(appStore, selector);
}

export const currentMonthDay = (s: AppState) => doyToMonthDay(s.doy);
