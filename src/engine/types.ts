export type Pt = [number, number];
export type Pt3 = [number, number, number];

export type RoofForm = 'flat' | 'gable' | 'hip';

export interface StructureCfg {
  id: string;
  name: string;
  footprint: Pt[];
  /** Roof outline when it differs from the walls (overhangs). */
  roofFootprint?: Pt[];
  eaveHeight: number;
  ridgeHeight: number;
  roofForm: RoofForm;
  status: 'existing' | 'proposed';
  toggleable: boolean;
  note?: string;
}

export interface HardscapeCfg {
  id: string;
  name: string;
  polygon: Pt[];
  material: string;
}

export interface ContextObjectCfg {
  id: string;
  kind: 'fence' | 'wall' | 'building' | 'tree' | 'pole';
  name: string;
  line?: Pt[];
  footprint?: Pt[];
  position?: Pt;
  height: number;
  thickness?: number;
  canopyWidth?: number;
  trunkHeight?: number;
  /** 0..1 share of sunlight blocked by the object. */
  density?: number;
  placeholder?: boolean;
  note?: string;
}

export interface EasementCfg {
  id: string;
  label: string;
  polygon: Pt[];
  heightCap: number;
}

export interface SetbackCfg {
  id: string;
  label: string;
  edge: 'left' | 'right' | 'rear' | 'front';
  distance: number;
}

export interface ZoneCfg {
  id: string;
  name: string;
  polygon: Pt[];
  slope?: number;
}

export interface ViewCfg {
  id: string;
  label: string;
  kind: 'perspective' | 'plan';
  position?: Pt3;
  target?: Pt3;
}

export type Measure =
  | { type: 'lot'; axis: 'x' | 'y' }
  | { type: 'extent'; structure: string; axis: 'x' | 'y'; roof?: boolean }
  | { type: 'edgeToLot'; structure: string; edge: 'minX' | 'maxX' | 'minY' | 'maxY' }
  | { type: 'gap'; from: string; to: string; axis: 'x' | 'y' };

export interface PrintedDimCfg {
  id: string;
  label: string;
  /** Feet-inches string such as 50'-8 1/4" or a number of feet. */
  value: string | number;
  measure: Measure;
}

export interface SiteConfig {
  schema: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  timeZone: string;
  /** Compass bearing of the +Y (rear) axis, degrees clockwise from true north. */
  rearBearingDeg: number;
  /** Which side the driveway is on when facing the house from the street. */
  driveSide: 'left' | 'right';
  lot: { width: number; depth: number };
  structures: StructureCfg[];
  hardscape: HardscapeCfg[];
  contextObjects: ContextObjectCfg[];
  easements: EasementCfg[];
  setbacks: SetbackCfg[];
  zones: ZoneCfg[];
  views: ViewCfg[];
  printed: PrintedDimCfg[];
  assumptions: { id: string; text: string; estimate?: boolean }[];
}

export interface SeasonCfg {
  id: string;
  label: string;
  from: [number, number];
  to: [number, number];
}

export interface EngineConfig {
  version: string;
  referenceYear: number;
  sun: {
    model: string;
    refraction: boolean;
    minElevationDeg: number;
    stepMinutes: number;
    cellSizeFt: number;
    sampleEveryDays: number;
    classes: { fullSunHours: number; partSunHours: number; partShadeHours: number };
    presets: { id: string; label: string; month: number; day: number }[];
    seasons: SeasonCfg[];
  };
  scene: { snapDefaultFt: number; snapOptionsFt: number[]; treeCanopyRings: number };
  growth: {
    steepness: number;
    containers: Record<string, { label: string; height: number; width: number }>;
    maxStartFractionOfMature: number;
    shadowDensityByType: Record<string, number>;
    trunkClearanceFraction: Record<string, number>;
    minShadowHeightFt: number;
    sunNeedHours: { full: { min: number }; part: { min: number; max: number }; shade: { max: number } };
    wucolsPlantFactor: Record<string, number>;
  };
  timeline: { maxYears: number; presets: number[] };
}

export type PlantType = 'tree' | 'shrub' | 'perennial' | 'grass' | 'groundcover' | 'vine' | 'succulent' | 'edible';
export type Habit = 'columnar' | 'round' | 'vase' | 'spreading' | 'weeping' | 'clump' | 'mat' | 'vine';
export type ContainerId = '1gal' | '5gal' | '15gal' | '24box';
export type Confidence = 'high' | 'medium' | 'low';
export type PollinatorValue = 'high' | 'moderate' | 'low';
export type PollinatorGroup = 'native bees' | 'honey bees' | 'butterflies' | 'moths' | 'hummingbirds';

export interface Species {
  id: string;
  botanical: string;
  common: string;
  type: PlantType;
  origin: 'california native' | 'mediterranean' | 'other';
  evergreen: boolean;
  leafOffMonths: number[];
  matureHeight: number;
  matureWidth: number;
  yearsToMaturity: number;
  habit: Habit;
  sun: 'full' | 'part' | 'shade';
  wucols: 'very low' | 'low' | 'moderate' | 'high';
  bloomMonths: number[];
  bloomColor: string;
  foliageColor: string;
  pollinator: { value: PollinatorValue; groups: PollinatorGroup[]; larvalHost: string[] };
  invasive: boolean;
  toxic: boolean;
  maintenance: 'low' | 'moderate' | 'high';
  notes?: string;
  /** Source and confidence per group of fields. Falls back to the library default. */
  provenance?: Partial<Record<'size' | 'light' | 'water' | 'pollinator', { source: string; confidence: Confidence }>>;
}

export interface SpeciesLibrary {
  version: string;
  provenanceDefault: { source: string; confidence: Confidence };
  species: Species[];
}

export interface PlantInstance {
  id: string;
  speciesId: string;
  position: Pt;
  /** Months after project start (timeline month 0). */
  plantedMonth: number;
  container: ContainerId;
  existing: boolean;
  /** Entered by the owner for existing plants, in feet. */
  currentHeight?: number;
  currentWidth?: number;
}
