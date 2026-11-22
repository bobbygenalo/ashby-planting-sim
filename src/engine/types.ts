export type Pt = [number, number];
export type Pt3 = [number, number, number];

export type RoofForm = 'flat' | 'gable' | 'hip' | 'shed';

export interface StructureCfg {
  id: string;
  name: string;
  footprint: Pt[];
  /** Roof outline when it differs from the walls (overhangs). */
  roofFootprint?: Pt[];
  /** When set, the roof over the footprint is a wedge and the part of roofFootprint beyond it a thin slab of this thickness (ft), open underneath. */
  roofThickness?: number;
  eaveHeight: number;
  ridgeHeight: number;
  roofForm: RoofForm;
  /** For a shed roof, the side the roof slopes down toward. `eaveHeight` is the low edge and `ridgeHeight` the high edge. */
  lowSide?: 'west' | 'east' | 'north' | 'south';
  /** Which way a gable or hip ridge runs. Without it the ridge follows the longer side of the roof. */
  ridgeAxis?: 'x' | 'y';
  /** Where a gable ridge sits across the roof (an x for a ridge running along y, a y for one along x). Without it the ridge is centered. */
  ridgeAt?: number;
  /** Parts of one building (for example the ADU's wings) share a group, so printed dimensions can measure them together. */
  group?: string;
  /** What to call the whole building on drawings when it is made of several parts. */
  groupName?: string;
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

/** A door people use to go into a building. The point is on the outside face of the wall. */
export interface DoorCfg {
  id: string;
  label: string;
  /** The structure's group, or its id when it has none. */
  building: string;
  point: Pt;
  /** Unit vector pointing away from the building. */
  outward: Pt;
  /** True when the position is assumed rather than read from a plan. */
  estimate?: boolean;
  note?: string;
}

export interface SiteConfig {
  schema: string;
  name: string;
  latitude: number;
  longitude: number;
  timeZone: string;
  /** Compass bearing of the +Y (rear) axis, degrees clockwise from true north. */
  rearBearingDeg: number;
  /** Which side the driveway is on when facing the house from the street. */
  driveSide: 'left' | 'right';
  lot: { width: number; depth: number };
  structures: StructureCfg[];
  /** Doors people walk in and out of. Optional: a site without them has people stay outside. */
  doors?: DoorCfg[];
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

export interface ShuffleCfg {
  plantMoveRadiusFt: number;
  moveAttempts: number;
  minPlantGapFt: number;
  /** A swapped-in species may be this fraction of the original's mature size, low and high. */
  sizeRatioBand: [number, number];
  /** Cover with less permeability than this counts as hard surface that plants are not nudged onto. */
  hardCoverMaxPermeability: number;
  timeYearsFrom: number[];
  sunMinutesFrom: number;
  sunMinutesTo: number;
  sunMinutesStep: number;
  colorsByCategory: Record<string, string[]>;
}

export interface ConceptAreaCfg {
  width: [number, number];
  depth: [number, number];
  zones: string[];
  attempts: number;
  /** Materials to choose from; the element type's own material when absent. */
  materials?: string[];
}

export interface ConceptTheme {
  id: string;
  label: string;
  /** How many of each area a concept with this theme tries to place, as [least, most]. */
  lawn: [number, number];
  gravel: [number, number];
  mulch: [number, number];
  raisedBeds: [number, number];
  /** Chance of a deck. */
  deck: number;
  /** Chances of a communal table with chairs, and of a grilling station, on the patio. */
  table: number;
  grill: number;
}

export interface ConceptCfg {
  /** Where the table and grill go: tries to find a spot, the gap kept between them and the patio edge, and tries outside the patio when it is too small. */
  furniture: { attempts: number; gapFt: number; edgeFt: number; grillOutsideAttempts: number };
  gridFt: number;
  lotMarginFt: number;
  structureMarginFt: number;
  patio: { zone: string; width: [number, number]; depth: [number, number]; candidates: number; attempts: number };
  path: {
    width: number;
    materials: string[];
    /** Most paths in a concept. */
    max: number;
    gridFt: number;
    /** Walking on an existing path costs this share of open ground, so routes join up instead of running side by side. */
    reuse: number;
    /** Room kept between the path's edge and everything else. */
    clearFt: number;
    /** Plants block the route out to this far from the trunk (their mature radius, up to this cap) plus the path's half width. */
    plantMaxRadiusFt: number;
    /** A path to a fruit tree stops this far from the trunk. */
    fruitStandFt: number;
    maxFruitHubs: number;
    /** Plants keep this far from a path's edge. */
    plantEdgeFt: number;
    /** Plants stay this far from a door so its path can arrive. */
    doorKeepClearFt: number;
  };
  beds: { zones: Record<string, [number, number]>; length: [number, number]; depth: [number, number]; attempts: number; edgeBias: number; gapFt: number };
  areas: { lawn: ConceptAreaCfg; deck: ConceptAreaCfg; gravel: ConceptAreaCfg; mulch: ConceptAreaCfg; raisedBed: ConceptAreaCfg };
  themes: ConceptTheme[];
  /** One display color per material, chosen to be told apart on the plan. */
  colors: Record<string, string>;
  plants: {
    count: [number, number];
    maxTrees: number;
    overlapAllowance: number;
    /** Species drawn in turn for one plant when none finds a spot that suits it. */
    speciesTries: number;
    attempts: number;
    bedBias: number;
    zones: string[];
    treeContainer: string;
    container: string;
    /** How many water-use steps from the chosen category a concept may stray. */
    waterSpread: number;
    pollinatorWeights: Record<string, number>;
  };
  minPoolSize: number;
}

export interface FruitCfg {
  /** Fruit is drawn this many times its real size so it reads from across the yard. */
  displayScale: number;
  /** Unripe fruit is drawn at this share of ripe size. */
  unripeScale: number;
  /** Even tiny fruit (olives) is drawn at least this wide so it can be seen. */
  minDisplayDiameterFt: number;
  /** A plant starts to fruit once it reaches this share of its mature size. */
  minSizeFraction: number;
  /** Share of the full fruit count shown when fruiting first starts. */
  startCountFraction: number;
  /** How far out on the canopy surface the fruit sits (1 = on the surface). */
  insetFraction: number;
  /** Height range on the canopy, as shares of canopy height, where fruit hangs. */
  zFractionRange: [number, number];
  maxCount: number;
}

export interface SpeciesFruit {
  shape: 'sphere' | 'oval';
  /** Vertical stretch of an oval fruit. */
  aspect?: number;
  /** Real diameter in feet. */
  diameterFt: number;
  ripeColor: string;
  unripeColor?: string;
  ripeMonths: number[];
  unripeMonths?: number[];
  /** Fruit shown on a full-size plant. */
  count: number;
  source?: string;
}

export interface PersonSpec {
  /** Age in years: under 6 follows an adult, 6 to 17 wanders on their own, 18 and over is an adult. */
  age: number;
  heightFt: number;
  speedFt: [number, number];
}

export interface DiningCfg {
  /** Chance, when someone chooses where to go next, of calling people to the table. */
  bias: number;
  /** How many sit down together, as [least, most]. */
  groupSize: [number, number];
  /** How far behind a chair, past its edge, someone stands before pulling it out. */
  approachFt: number;
  /** How far a chair slides out when pulled. */
  pullFt: number;
  pullS: number;
  sitS: number;
  pushS: number;
  riseS: number;
  /** How long a group stays at the table, in seconds. */
  talkS: [number, number];
  /** How long one person talks before another takes over, in seconds. */
  speakerS: [number, number];
  /** How far a seated person's hips drop below standing, in feet. */
  sitDropFt: number;
  /** How far a chair is scooted back in once someone sits, as a share of its pull. */
  scootShare: number;
  /** The most a listener turns their head toward the speaker, in radians. */
  headTurnMax: number;
}

export interface MovieCfg {
  /** The building whose east wall is the screen. */
  screenBuilding: string;
  /** Showing from this minute of the day to this one (1200 is 8 pm). */
  startMin: number;
  endMin: number;
  /** Chance that someone free when it starts goes to watch, and that someone choosing where to go next does while it shows. */
  attendBias: number;
  joinBias: number;
  widthFt: number;
  bottomFt: number;
  heightFt: number;
  /** Viewers stand this far out from the wall and no further sideways from its middle than this. */
  spotFromWallFt: [number, number];
  spotLateralFt: number;
  /** Viewers keep this far apart. */
  spotGapFt: number;
  projectorFromWallFt: number;
  projectorHeightFt: number;
}

export interface NightCfg {
  /** People and dogs are indoors from this minute of the day (1380 is 11 pm) until `endMin` (360 is 6 am). */
  startMin: number;
  endMin: number;
  /** A change of the clock bigger than this many minutes sends everyone in at once, or brings them out, instead of walking. */
  jumpMin: number;
  /** In the morning they come out one by one over this many seconds. */
  riseSpreadS: number;
}

export interface LifeCfg {
  night: NightCfg;
  dining: DiningCfg;
  movie: MovieCfg;
  cellFt: number;
  margins: { plantFt: number; structureFt: number; lotFt: number; hiveFt: number; nearBlockedFt: number; nearBlockedExtraCost: number };
  /** What it costs to walk one foot over each kind of ground; paths are cheapest, so people drift toward them. */
  costs: { open: number; path: number; hard: number; lawn: number; gravel: number; mulch: number; bed: number };
  people: {
    max: number;
    pauseS: [number, number];
    pathBias: number;
    minTripFt: number;
    turnRate: number;
    /** The cast, in the order people join as the count goes up. Its length is the most people there can be. */
    roster: PersonSpec[];
    /** How close a toddler stays to the adult looking after them, and how often they catch up. */
    toddlerFollowFt: [number, number];
    toddlerReplanS: number;
    /** Chance, when choosing where to go next, of heading for a building instead. */
    visitBias: number;
    /** How long someone stays inside, in seconds, chosen at random. */
    lingerS: [number, number];
    /** How far outside a door they stop before going in, in feet. */
    doorApproachFt: number;
  };
  dogs: { max: number; speedFt: [number, number]; pauseS: [number, number]; followFt: [number, number]; replanS: number; heightFt: number; turnRate: number };
  bees: {
    count: number;
    speedFt: [number, number];
    forageS: [number, number];
    restS: [number, number];
    rangeFt: number;
    wanderFt: number;
    altitudeFt: [number, number];
    wobbleFt: number;
    /** Drawn length of a bee in feet (a real bee is about a seventh of this, too small to see). */
    displayFt: number;
    hive: { boxes: number; minFromPathFt: number; minFromStructureFt: number; minFromPlantFt: number; attempts: number; /** Score added for a spot at the very back of the lot, so a hive tends to sit toward the rear. */ rearBias: number };
  };
  /** Longest simulated step, so a slow frame never lets anyone jump through an obstacle. */
  maxStepS: number;
}

export interface BranchCfg {
  /** Main limbs from the top of the trunk, as [least, most]. */
  limbs: [number, number];
  /** Levels of branching: limbs, then branches, then twigs. */
  levels: number;
  children: [number, number];
  /** Each level is this long relative to the one before. */
  lengthRatio: number;
  /** The first limbs are this share of the canopy height long. */
  firstLengthFrac: number;
  elevationDeg: [number, number];
  childSpreadDeg: number;
  /** Radius at the base of a limb, as a share of canopy height. */
  radiusFrac: number;
  taper: number;
  minRadiusFt: number;
  /** Twigs stay inside this share of the canopy outline. */
  inset: number;
}

export interface LitterCfg {
  /** Months at the start of leaf-off when leaves are still coming down. */
  fallMonths: number;
  /** Months after the leaves return that last year's litter takes to rot into the soil. */
  decayMonths: number;
  /** Share of the full litter on the ground while the leaves are still falling. */
  fallAmount: number;
  leavesPerSqFt: number;
  minLeaves: number;
  maxLeaves: number;
  /** Share of the leaves drawn in the air, drifting down, while they fall. */
  fallingShare: number;
  leafSizeFt: number;
  /** Litter spreads over this share of the canopy radius. */
  radiusFraction: number;
  humusRadiusFraction: number;
  humusOpacity: number;
  soilColor: string;
  autumnColor: string;
  autumnBlend: number;
  fallSpeedFtPerSec: number;
  swayFt: number;
  groundZ: number;
}

export interface HolidayCfg {
  /** Structures whose front roofline is strung with lights (the street-facing house and the ADU). */
  lightedParts: string[];
  /** Lights go up the day after Thanksgiving, the `nth` `weekday` (1 Monday to 7 Sunday; 4 is Thursday) of `month`, and stay through `seasonEndMonth`. */
  thanksgiving: { month: number; weekday: number; nth: number };
  seasonEndMonth: number;
  /** The sun is down, so the lights come on, when it is this far below the horizon (degrees). */
  sunsetElevationDeg: number;
  bulbSpacingFt: number;
  bulbRadiusFt: number;
  glowRadiusFt: number;
  glowOpacity: number;
  /** How bright an unlit bulb looks, as a share of lit. */
  offDim: number;
  colors: string[];
  wireColor: string;
  /** The string hangs this far out toward the street from the roof edge, and this far above it. */
  outwardFt: number;
  liftFt: number;
  twinkleHz: number;
}

export interface EngineConfig {
  holiday: HolidayCfg;
  litter: LitterCfg;
  /** The growth-stages view: the ages shown and the two camera heights (angled, side-on). */
  growthStages: { years: number[]; anglePitch: number; sidePitch: number };
  crops: CropCfg;
  branches: BranchCfg;
  life: LifeCfg;
  fruit: FruitCfg;
  shuffle: ShuffleCfg;
  concept: ConceptCfg;
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
  scene: { snapDefaultFt: number; snapOptionsFt: number[]; treeCanopyRings: number; /** Shift with an arrow key moves this many times as far. */ arrowShiftMultiplier: number };
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
    /** Sections of a plant's crown used to build its shadow solid, bottom to top. */
    shadowLevels: number;
    /** How far a blooming plant's foliage color moves toward its bloom color (0-1). */
    bloomTintFraction: number;
  };
  timeline: { maxYears: number; presets: number[]; /** Days the calendar moves for each month of growth while growth plays. */ daysPerStep: number };
  conflicts: {
    overlapToleranceFt: number;
    understoryHeightRatio: number;
    ignoreHabits: string[];
    structureClearanceFt: number;
    trunkAvoidTypes: HardscapeType[];
    lotLineMinFt: Record<PlantType, number>;
    ignoreVinesAtStructures: boolean;
    source: string;
  };
  suggest: {
    weights: { sun: number; clearance: number; hydrozone: number };
    gridFt: number;
    hydrozoneRadiusFt: number;
    minSeparationFt: number;
    topCount: number;
  };
  hardscape: {
    permeableThreshold: number;
    sampleCellFt: number;
    /** Types that older plans may still contain but that can no longer be drawn or generated. */
    notDrawable?: HardscapeType[];
    snapToleranceFt: number;
    rootZoneFactor: number;
    drawOrder: HardscapeType[];
    types: Record<
      HardscapeType,
      {
        label: string;
        shape: 'polygon' | 'line';
        material: string;
        height: number;
        depthIn: number;
        width: number;
        /** Furniture and fixtures: one click places a rectangle of this size (long side, short side, feet) that is then turned or resized like any element. */
        placeSize?: [number, number];
        /** How it is drawn in 3D (a table with chairs, a grill between counters). Without it the outline is extruded. */
        model?: 'table' | 'grill';
        /** Stands on the ground, not part of it: ignored when working out what covers the lot. */
        furniture?: boolean;
      }
    >;
  };
}

export type PlantType = 'tree' | 'shrub' | 'perennial' | 'grass' | 'groundcover' | 'vine' | 'succulent' | 'edible';
export type Habit = 'columnar' | 'round' | 'vase' | 'spreading' | 'weeping' | 'clump' | 'mat' | 'vine';
export type ContainerId = '1gal' | '5gal' | '15gal' | '24box';
export type Confidence = 'high' | 'medium' | 'low';
export type PollinatorValue = 'high' | 'moderate' | 'low';
export type PollinatorGroup = 'native bees' | 'honey bees' | 'butterflies' | 'moths' | 'hummingbirds';

/** How a plant's crown is drawn and how much light it lets through. */
export interface CrownData {
  /** The crown's outline as [share of canopy height, share of canopy radius] points, bottom to top; replaces the habit's stock outline. */
  profile?: [number, number][];
  /** Share of sunlight the crown blocks in leaf (0 to 1); without it the plant type's value is used. */
  density?: number;
  /** Share of sunlight a bare crown blocks; without it a share of `density` is used. */
  leafOffDensity?: number;
}

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
  /** Crown outline and light transmission (shadow and drawing share the outline). */
  crown?: CrownData;
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
  /** Fruit drawn on the plant when in season (edible fruiting species). */
  fruit?: SpeciesFruit;
  roots: { behavior: 'shallow' | 'moderate' | 'sensitive' | 'aggressive'; minFoundationFt: number; minPavingFt: number };
  soil: { drainageNeed: 'fast' | 'moderate' | 'tolerant'; textures: string[]; phMin: number; phMax: number };
  /** The owner's data sheet (2026-11-21): how well this row is verified and what is left to check. */
  sheet?: { confidence: string; verified: string | null; toVerify: string | null };
  provenance?: Partial<Record<'size' | 'light' | 'water' | 'pollinator' | 'soil', { source: string; confidence: Confidence }>>;
}

export interface SpeciesLibrary {
  version: string;
  provenanceDefault: { source: string; confidence: Confidence };
  soilNote?: string;
  rootsNote?: string;
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

export type HardscapeType = 'patio' | 'path' | 'bed' | 'lawn' | 'deck' | 'gravel' | 'raisedBed' | 'wall' | 'fence' | 'table' | 'grill';

export interface Material {
  id: string;
  name: string;
  category: 'paving' | 'loose' | 'planting' | 'turf' | 'deck' | 'structure' | 'furniture';
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
  /** Display color chosen by the owner; falls back to the material's color. */
  color?: string;
  /** Existing elements a scenario removes. */
  removed?: boolean;
  /** New work must not cover this (the driveway). */
  keepClear?: boolean;
  /** Raised beds: the crops grown there. Without it the bed gets a default rotation from its id. */
  crops?: CropPlan;
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

export interface Crop {
  id: string;
  name: string;
  kind: 'vegetable' | 'fruit' | 'herb';
  /** Which half of the year the crop is grown in; strawberries stand all year. */
  season: 'cool' | 'warm' | 'any';
  form: 'rosette' | 'bush' | 'upright' | 'vine' | 'mound';
  heightFt: number;
  widthFt: number;
  spacingFt: number;
  /** Calendar months (1-12): sown or planted, first harvest, last month standing. */
  sowMonth: number;
  harvestStart: number;
  endMonth: number;
  leafColor: string;
  produce?: { color: string; sizeFt: number; count: number };
  perennial?: boolean;
  dormantMonths?: number[];
  regrowMonths?: number[];
  fruitMonths?: number[];
  note?: string;
}

export interface CropCfg {
  seasons: { cool: number[]; warm: number[] };
  seedlingFraction: number;
  dormantFraction: number;
  regrowFraction: number;
  spentFraction: number;
  spentColor: string;
  spentBlend: number;
  insetFt: number;
  maxPlants: number;
  produceDisplayScale: number;
  produceMinFt: number;
  soilDepthFt: number;
}

/** The crop grown in a raised bed in each half of the year, by crop id. */
export interface CropPlan {
  cool: string;
  warm: string;
}
