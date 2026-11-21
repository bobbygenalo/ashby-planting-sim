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

/** Existing hardscape shipped in the site file. Same shape as a scenario element. */
export type HardscapeCfg = HardscapeElement;

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
    /** Share of normal canopy density left when a deciduous plant is leafless. */
    leafOffDensityFactor: number;
    /** How far a blooming plant's foliage color moves toward its bloom color (0-1). */
    bloomTintFraction: number;
  };
  timeline: { maxYears: number; presets: number[] };
  hardscape: {
    permeableThreshold: number;
    sampleCellFt: number;
    snapToleranceFt: number;
    rootZoneFactor: number;
    drawOrder: HardscapeType[];
    types: Record<
      HardscapeType,
      { label: string; shape: 'polygon' | 'line'; material: string; height: number; depthIn: number; width: number }
    >;
  };
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
  soil: { drainageNeed: 'fast' | 'moderate' | 'tolerant'; textures: string[]; phMin: number; phMax: number };
  provenance?: Partial<Record<'size' | 'light' | 'water' | 'pollinator' | 'soil', { source: string; confidence: Confidence }>>;
}

export interface SpeciesLibrary {
  version: string;
  provenanceDefault: { source: string; confidence: Confidence };
  soilNote?: string;
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
  /** Explicit hydrozone. Without one, the plant joins an automatic zone for its water-use category. */
  hydrozoneId?: string;
}

export type HardscapeType = 'patio' | 'path' | 'bed' | 'lawn' | 'deck' | 'gravel' | 'raisedBed' | 'wall' | 'fence';

export interface Material {
  id: string;
  name: string;
  category: 'paving' | 'loose' | 'planting' | 'turf' | 'deck' | 'structure';
  /** Share of rainfall that soaks through, 0 (sealed) to 1 (open soil). */
  permeability: number;
  /** Default surface layer depth in inches. */
  defaultDepthIn: number;
  /** Compacted base (or footing) depth in inches. */
  baseDepthIn: number;
  unit: 'sf' | 'lf';
  color: string;
  note?: string;
}

export interface HardscapeElement {
  id: string;
  type: HardscapeType;
  name?: string;
  /** Polygon vertices, or polyline vertices for path, wall and fence. */
  points: Pt[];
  materialId: string;
  /** Height above grade in feet, rendered in 3D and cast as shade. */
  height: number;
  /** Surface layer depth in inches. */
  depthIn: number;
  /** Width of a path, or thickness of a wall or fence, in feet. Ignored for polygons. */
  width: number;
  existing: boolean;
  /** Existing elements a scenario removes. */
  removed?: boolean;
  /** New work must not cover this (the driveway). */
  keepClear?: boolean;
}

export type Irrigation = 'drip' | 'spray' | 'hand' | 'none';

export interface Hydrozone {
  id: string;
  name: string;
  irrigation: Irrigation;
}

export interface SoilProfile {
  texture: string;
  /** Percolation rate in inches per hour. */
  drainageInHr: number;
  ph: number;
  organicMatterPct: number;
  compaction: string;
  testDate: string | null;
  /** True until the owner enters a test result. */
  isDefault?: boolean;
}

export interface WaterConfig {
  version: string;
  formula: { conversion: number; source: string; confidence: Confidence };
  eto: { station: string; monthly: number[]; status: 'verified' | 'unverified'; source: string; confidence: Confidence };
  rainfall: {
    station: string; monthly: number[]; source: string; confidence: Confidence;
    effectiveFraction: number; effectiveFractionSource: string; effectiveFractionConfidence: Confidence;
  };
  daysInMonth: number[];
  plantFactorRanges: Record<string, [number, number]>;
  plantFactorSource: string;
  irrigation: Record<Irrigation, { label: string; efficiency: number; source: string; confidence: Confidence }>;
  defaultIrrigation: Record<PlantType, Irrigation>;
  establishment: Record<PlantType, { months: number; multiplier: number }>;
  establishmentSource: string;
  lawn: { plantFactor: number; irrigation: Irrigation; source: string; confidence: Confidence };
  budget: { etaf: number; source: string; confidence: Confidence };
  pollinator: { weights: Record<PollinatorValue, number>; countCap: number; source: string; topSuggestions: number };
  outputs: { spacingFactor: number; spacingSource: string };
}

export interface SoilConfig {
  version: string;
  textures: string[];
  drainageClasses: { fastMinInHr: number; moderateMinInHr: number };
  drainageSource: string;
  defaultProfile: SoilProfile;
  phTolerance: number;
  containers: Record<string, { ballDiaIn: number; ballDepthIn: number }>;
  containerSource: string;
  hole: { widthFactor: number; depthFactor: number; source: string };
  amendment: { fractionOfBackfill: number; skipForDrainageNeed: string[]; source: string };
  mulch: { depthIn: number; ringDiameterFt: number; source: string };
  rootableSoil: { cuFtPerSfCanopy: number; depthFt: number; searchRadiusFactor: number; source: string; confidence: Confidence };
  raisedBed: { freeboardIn: number; source: string };
}
