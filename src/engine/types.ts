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
  /** 'walk' is the first-person view: you stand in the yard and move with the keyboard (`position` is where you start, `target` is where you face). */
  kind: 'perspective' | 'plan' | 'walk';
  position?: Pt3;
  target?: Pt3;
  /** The camera slowly circles the target, counter-clockwise seen from above, at this many degrees a second; it waits `resumeS` seconds after the viewer last touched the view. */
  drift?: { degPerSecond: number; resumeS: number };
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

/** Someone who lives here, and the day of the year they have a birthday. */
export interface Resident {
  name: string;
  month: number;
  day: number;
}

export interface BirthdayCfg {
  /** The yard people gather in (a zone id in the site file). */
  zone: string;
  /** The party runs this many hours either side of sunset. */
  partyHoursBefore: number;
  partyHoursAfter: number;
  /** Everyone crowds the table for cake from this many minutes before sunset to this many after. */
  cakeMinutesBefore: number;
  cakeMinutesAfter: number;
  presents: {
    count: number;
    /** Share of the presents placed close around the communal table. */
    nearTableShare: number;
    /** How far from the table's edge the near ones lie, in feet, as [least, most]. */
    nearTableFt: [number, number];
    sizeFt: [number, number];
    colors: string[];
    ribbons: string[];
  };
  hat: { heightFt: number; radiusFt: number; colors: string[] };
  /** Bunches of balloons tied outside each door: how many to a bunch, how far out from the wall and to the side of the door, how long the strings are, how big the balloons, how far they sway. */
  balloons: { perBunch: number; sideFt: number; outFt: number; stringFt: [number, number]; sizeFt: number; colors: string[]; swayFt: number };
  cake: { widthFt: number; heightFt: number; candles: number };
}

export interface SiteConfig {
  residents?: Resident[];
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
  /** Raised beds: the set shapes (ids from `hardscape.raisedBedModule`) a concept draws from; each is turned at random. */
  shapes?: string[];
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
  plants: {
    count: [number, number];
    /** The most plants in a concept, drifts and companions included. */
    maxTotal: number;
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
    companions: CompanionCfg;
  };
  minPoolSize: number;
}

/**
 * When plants may stand closer than their crowns allow: a pair must share a watering need and a light that suits both,
 * and be purposeful (a drift of one species, a low plant at the foot of a tall one, groundcover round a shrub) or beautiful
 * (a clear contrast of foliage or bloom). Anything else keeps its crowns apart.
 */
export interface CompanionCfg {
  /** A drift of one species: centers this share of the crowns' summed radii apart (under 1 means the crowns interweave). */
  driftSpacing: number;
  /** A low plant counts as layered under a taller one when the taller is at least this many times higher. */
  layerHeightRatio: number;
  /** A layered plant stays at least this share of the taller one's radius from its trunk. */
  coreFraction: number;
  /** A plant this tall or taller (or any tree) casts shade a full-sun plant would not want. */
  shadeHeightFt: number;
  /** Contrasting neighbors of a similar size: centers this share of the crowns' summed radii apart. */
  contrastSpacing: number;
  /** Foliage lightness difference (0 to 1), or bloom hue difference (degrees) with a shared bloom month, that counts as a contrast. */
  contrastLightness: number;
  contrastHue: number;
  /** A concept turns this share of its small plants into a drift, of this many, for plants up to this wide. */
  driftChance: number;
  driftGroup: [number, number];
  driftMaxWidthFt: number;
  /** A concept gives this share of its trees and big shrubs a few low companions at their feet, up to this many. */
  understoryChance: number;
  understoryMax: number;
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
  /** Draw this species' fruit this many times its real size, instead of the usual scale (small berries want less than the olives do). */
  displayScale?: number;
  /** The smallest this fruit is drawn, in feet, instead of the usual minimum. */
  minDisplayFt?: number;
  /** Fruit shown on a full-size plant. */
  count: number;
  source?: string;
}

export interface PersonSpec {
  /** Age in years: under 6 follows an adult, 6 to 17 wanders on their own, 18 and over is an adult. */
  age: number;
  heightFt: number;
  /** Placeholders until the real cast is known: they set the proportions and the hair. */
  sex?: 'f' | 'm';
  build?: 'slim' | 'average' | 'broad';
  /** The family they belong to, which sets the color of their shirt; and their hair color when it is not left to chance (gray). */
  family?: string;
  shirt?: string;
  hair?: string;
  speedFt: [number, number];
}

export interface MeetCfg {
  /** The chance, when a free person chooses what to do and another is free within `rangeFt`, of going to meet them. */
  bias: number;
  rangeFt: number;
  /** How far apart (feet between centers) they stand to talk, and the chance they hug when they meet. */
  talkFt: number;
  hugChance: number;
  /** In a hug, bodies come to within this gap (feet), and hold it for `hugS` seconds; they close in at `hugMoveFtS`. */
  hugFt: number;
  hugS: [number, number];
  hugMoveFtS: number;
  /** How long they talk, and how long one speaks before the other takes a turn. */
  talkS: [number, number];
  speakerS: [number, number];
  /** Nobody who has just met starts another meeting for this long. */
  cooldownS: number;
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
  /** The height of a chair's seat above the ground, in feet: a seated person's hips come to rest here, whatever their size. */
  seatHeightFt: number;
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

export interface BirdSpeciesCfg {
  id: string;
  name: string;
  /** Months it is here (1 to 12): resident birds all year, winter visitors October to April, summer visitors April to August. */
  months: number[];
  /** What it does in a yard: scratch on the ground, work the shrubs and trees, come for fruit and berries, or sip nectar. */
  guild: 'ground' | 'canopy' | 'fruit' | 'nectar';
  /** How many come together, as [fewest, most]. */
  flock: [number, number];
  body: string;
  belly: string;
  accent: string;
  /** Length in feet. */
  sizeFt: number;
  note: string;
}

export interface CritterCfg {
  birds: {
    /** The most birds in the yard at once. */
    max: number;
    /** They are about between these minutes of the day (360 is 6 am, 1110 is 6:30 pm). */
    fromMin: number;
    toMin: number;
    speedFt: [number, number];
    hopFt: number;
    perchS: [number, number];
    forageS: [number, number];
    fadeS: number;
    species: BirdSpeciesCfg[];
  };
  hummer: {
    max: number;
    /** One hummingbird for this many flowers in bloom that they visit (rounded up, up to the most). */
    bloomsPerBird: number;
    /** They are about between these minutes of the day (360 is 6 am, 1140 is 7 pm). */
    fromMin: number;
    toMin: number;
    speedFt: [number, number];
    hoverS: [number, number];
    perchS: [number, number];
    bodyFt: number;
    flapHz: number;
    bobFt: number;
    fadeS: number;
  };
  butterfly: {
    max: number;
    perFlower: number;
    /** Months they are about (3 to 11: March to November). */
    months: number[];
    fromMin: number;
    toMin: number;
    /** They keep to flowers that get at least this many hours of growing-season sun a day. */
    minSunHours: number;
    speedFt: [number, number];
    landS: [number, number];
    wingFt: number;
    flapHz: [number, number];
    altFt: [number, number];
    fadeS: number;
  };
  worms: {
    max: number;
    /** How active worms are in each month, January first, 0 to 1: most in the cool wet months. */
    activityByMonth: number[];
    /** They come up at night, from nightFromMin until nightToMin; by day only in the shade. */
    nightFromMin: number;
    nightToMin: number;
    dayShade: number;
    daySun: number;
    /** Ground getting no more than this many hours of sun counts as shade. */
    shadeMaxSunHours: number;
    lengthFt: number;
    thickFt: number;
    wiggleHz: number;
    /** Every this-many cells is a candidate spot, at most spotCap of them. */
    spotStride: number;
    spotCap: number;
    litterWeight: number;
    compostWeight: number;
    richWeight: number;
    shadeWeight: number;
    sunWeight: number;
    emergeRate: number;
    segments: number;
  };
}

/** People picking ripe fruit into a basket. */
export interface HarvestCfg {
  /** The chance, each time a free person chooses what to do, of going to pick when something is ripe. */
  bias: number;
  /** Children this old and up pick. */
  minAge: number;
  /** Only in these hours (minutes of the day). */
  fromMin: number;
  toMin: number;
  /** At most this many people picking at once. */
  maxPickers: number;
  /** The volumes of the baskets people bring, in cubic feet (0.3 is about 8.5 litres, 0.65 about 18); each picker brings one. How much fits is set by this and the size of the fruit. */
  basketVolumesFt3: number[];
  /** The share of a basket's volume that fruit fills once piled in (loose spheres pack to about 0.62). */
  packing: number;
  /** The most fruit a person takes in one pick, as a volume in cubic feet (about one medium apple): small fruit comes by the handful, big fruit one at a time. */
  handfulFt3: number;
  /** How full the basket should be before they take it in, as a share of its capacity. */
  fillShare: [number, number];
  /** How many picks they take from one plant before they move to a different one, as [least, most]. */
  chunk: [number, number];
  /** Seconds for one pick, from the hand leaving rest to its return: it reaches the fruit, pulls it free at `pluckAt` of the way through, carries it to the basket and lets go at `releaseAt`, then comes back. */
  pickEveryS: number;
  pluckAt: number;
  releaseAt: number;
  /** The arm reaches this far (feet) from where they stand; fruit higher than the person's reach is picked from lower down. */
  reachFt: number;
  /** They stand this far (feet) beyond the plant's canopy, and no further than `standMaxFt`. */
  standMinFt: number;
  standMaxFt: number;
  /** A basket is a flared bowl: the bottom is `flare` of the top's radius and it is `heightShare` of the top radius deep; its size comes from its volume. */
  basket: { color: string; flare: number; heightShare: number };
}

export interface LifeCfg {
  harvest: HarvestCfg;
  /** At a birthday party: the chance, when choosing where to go next, of heading for the party yard; the chance of joining the cake when it comes out; and how much less often people go indoors. */
  party: { backyardBias: number; cakeBias: number; visitFactor: number; /** The balloons are tied up from this minute of a birthday (480 is 8 am) until night. */ balloonsFromMin: number };
  critters: CritterCfg;
  night: NightCfg;
  dining: DiningCfg;
  movie: MovieCfg;
  fireworks: FireworksCfg;
  cellFt: number;
  margins: { plantFt: number; structureFt: number; lotFt: number; hiveFt: number; nearBlockedFt: number; nearBlockedExtraCost: number };
  /** What it costs to walk one foot over each kind of ground; paths are cheapest, so people drift toward them. */
  costs: { open: number; path: number; hard: number; lawn: number; gravel: number; mulch: number; bed: number };
  people: {
    max: number;
    /** How many people there are to begin with: the first this many of the roster. */
    defaultCount: number;
    /** People keep this much clear space (feet, between bodies) when they pass each other, unless they are hugging. A body is `bodyRadiusShare` of the person's height in radius. Someone held up by another waits this long before choosing a new way. */
    spaceFt: number;
    bodyRadiusShare: number;
    blockedReplanS: number;
    /** Someone who has made no headway for this many seconds (held up by others, or going round in circles) gives up that errand and chooses another. */
    giveUpS: number;
    /** Two free people sometimes meet to talk, and sometimes hug first. */
    meet: MeetCfg;
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

/** How a species looks up close: what it grows from, its leaves and its flowers (see `engine/foliage.ts`). */
export interface LookData {
  /** tree: leafy twigs on forking branches; stems: soft stems with paired leaves; blades: arching blades; rosette: leaves around a center. */
  kind: 'tree' | 'stems' | 'blades' | 'rosette';
  leaf: {
    shape: 'lanceolate' | 'elliptic' | 'oval' | 'strap' | 'blade' | 'frond';
    /** Real leaf size, feet. For blades and rosettes the length comes from the plant's size and only the width is used. */
    lengthFt: number;
    widthFt: number;
    /** Leaves per foot of twig or stem. */
    perFt?: number;
    /** Drawn this much larger again than the general display scale (a thin leaf like an olive's needs more to be seen). */
    display?: number;
    /** The underside, shown by leaves that hang or flip. */
    underColor?: string;
    /** Share of leaves that show their underside, 0 to 1. */
    underShare?: number;
    /** Lengthwise fold (0 flat to 1 deeply folded) and droop of the tip. */
    fold?: number;
    droop?: number;
  };
  /** Trees: twig tips at full size, and main limbs. The crown is filled by growing twigs toward points inside its outline. */
  twigs?: number;
  limbs?: number;
  trunkColor?: string;
  /** Blades, stems or rosette leaves at full size. */
  count?: number;
  /** Stems: the share of the canopy height their tips reach, [lowest, highest] (a groundcover's stay low). */
  zRange?: [number, number];
  /** Stems: a rosette of this many leaves at every stem tip (aeonium). */
  tipRosette?: number;
  /** Blades and rosettes: leaves reach only this share of the plant's height, the flower stalks carry on to the rest. */
  leafHeightFrac?: number;
  flower?: {
    /** blossom: flat five-petal flowers on the twigs; spike: whorls of tubes up a stalk; raceme: tubes hanging off one stalk; plume: slender seed heads above grass. */
    form: 'blossom' | 'spike' | 'raceme' | 'plume' | 'head';
    color?: string;
    centerColor?: string;
    /** Real flower size, feet (a blossom's width, a tube's length, a plume's length). */
    sizeFt: number;
    /** Blossoms, or flowers per spike, at full size. */
    count: number;
    /** Stalk length above where it starts, feet, for spikes, racemes and plumes. */
    stalkFt?: number;
    /** Heads: how many heads at full size, the radius of one (feet), whether it is a flat plate (yarrow), and its florets as small flat flowers or tubes. */
    heads?: number;
    headFt?: number;
    flat?: boolean;
    unit?: 'petal' | 'tube';
  };
}

/** Level of detail for the closer-up plants. */
export interface FoliageCfg {
  /** Most leaves drawn on one plant; past it they are fewer and larger. */
  maxLeaves: number;
  /** Leaves and flowers are drawn this much larger than life so they read at yard scale. */
  leafDisplayScale: number;
  flowerDisplayScale: number;
  /** How much larger leaves may grow when capped. */
  maxInflate: number;
  /** A plant is rebuilt only when its size changes by this much (a log step), and stretched to its exact size in between. */
  quantizeStep: number;
}

/** A raised bed's frame: boards about 5.5 in tall and 1.5 in thick stacked up to the cap, 4x4 corner posts, and a flat cap rail. */
export interface RaisedBedFrameCfg {
  boardHeightFt: number;
  boardThicknessFt: number;
  /** A hairline gap between stacked boards, so each reads as its own plank. */
  seamGapFt: number;
  postFt: number;
  /** The posts stand this much above the cap. */
  postRiseFt: number;
  capThicknessFt: number;
  capWidthFt: number;
  /** The cap overhangs the outside of the boards by this much. */
  capOverhangFt: number;
  /** Boards differ in lightness by up to this share, so the wood is not uniform. */
  colorJitter: number;
  /** The grain texture repeats every this many feet along a board. */
  grainFtPerTile: number;
}

/** Trunks: taper, a flare at the ground, and slightly ridged, sinuous bark. */
export interface TrunkCfg {
  /** Radius at the base as a share of the whole plant height, kept between the two limits (feet). */
  radiusPerHeight: number;
  minRadiusFt: number;
  maxRadiusFt: number;
  /** Radius at the top of the trunk as a share of the radius just above the flare. */
  topRatio: number;
  /** The base is this many times wider at the ground, falling off over this share of the trunk height. */
  flare: number;
  flareHeightFrac: number;
  /** Ridges in the bark: how deep (share of the radius) and how many around. */
  ridgeAmp: number;
  ridges: number;
  /** The trunk wanders sideways by up to this share of its height, and is zero at the top where the limbs begin. */
  sway: number;
  sides: number;
  rings: number;
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

/** The white sedan parked at the street end of the driveway on weekday evenings and nights. */
export interface VehicleCfg {
  /** Days it is home, 0 Sunday to 6 Saturday. */
  weekdays: number[];
  /** Gone from this minute of the day (420 is 7 am) until this one (1140 is 7 pm); home the rest of the day. */
  awayFromMin: number;
  backAtMin: number;
  lengthFt: number;
  widthFt: number;
  /** The nose of the car points toward the garage; its tail is this far from the street edge of the lot. */
  tailFromStreetFt: number;
  color: string;
  /** People and dogs keep this far from it. */
  marginFt: number;
}

/** The Fourth of July display shown beyond the back of the lot, and the neighbors who come out to watch. */
export interface FireworksCfg {
  month: number;
  day: number;
  /** On from this minute of the day to this one (1200 is 8 pm, 1380 is 11 pm). */
  startMin: number;
  endMin: number;
  /** Chance that someone free when it starts, or choosing where to go next, goes to watch. */
  attendBias: number;
  /** Watchers stand this far apart. */
  spotGapFt: number;
  /** Seconds between shells, the height of a burst, its radius and how long it lasts. */
  burstEveryS: [number, number];
  distanceFt: [number, number];
  spreadFt: number;
  heightFt: [number, number];
  radiusFt: [number, number];
  lifeS: number;
  sparks: number;
  /** Downward pull on the sparks (ft/s^2). */
  gravityFt: number;
  /** A shell that goes off this high lights the yard for a moment, up to this much (a light intensity). */
  flashIntensity: number;
  colors: string[];
  /** How far up the watchers tip their heads (radians) and how long they cheer after a big burst. */
  lookUpRad: number;
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

export interface PricingCfg {
  currency: string;
  /** What one plant costs by container size when nothing else says. */
  plantByContainer: Record<string, number>;
  source: string;
  /** The public price lists the container defaults come from. */
  references?: { name: string; url: string; covers: string; note: string }[];
  /** Spread of the prices found in those lists, by container: count, lowest, quartiles, median, highest. */
  reference?: Record<string, { n: number; min: number; p25: number; median: number; p75: number; max: number }>;
}

export interface EngineConfig {
  birthday: BirthdayCfg;
  pricing: PricingCfg;
  holiday: HolidayCfg;
  vehicle: VehicleCfg;
  player: PlayerCfg;
  anatomy: AnatomyCfg;
  foliage: FoliageCfg;
  trunk: TrunkCfg;
  /** Background colors by sun height: bright day, the glow around sunset, and night. */
  sky: { day: string; dusk: string; night: string; fullDayElevationDeg: number; duskElevationDeg: number; fullNightElevationDeg: number };
  litter: LitterCfg;
  /** The growth-stages view: the ages shown and the two camera heights (angled, side-on). */
  growthStages: { years: number[]; anglePitch: number; sidePitch: number; /** The most plants shown side by side, the one opened included. */ maxPlants: number };
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
    /** Nothing is planted on the driveway (any element marked keep-clear) or this close to it, in feet. */
    drivewayBufferFt: number;
    /** How a raised bed is built: stacked boards on corner posts under a cap rail, all in feet. */
    raisedBedFrame: RaisedBedFrameCfg;
    /** Raised beds come in a few shapes made of square modules; modules placed near each other snap together into one. */
    raisedBedModule: RaisedBedModuleCfg;
    /** The color every element of a material shows, chosen so materials can be told apart on the plan. An element's own `color` overrides it; a material missing here uses its own `color` in the materials list. */
    materialColors: Record<string, string>;
    /** How far flat surfaces stand above the ground, by type, so they show an edge: a slab is about half an inch proud, loose fill a little more. */
    surfaceThicknessFt: Partial<Record<HardscapeType, number>>;
    /** How the lot's fences are built: posts, spacing, how far the posts and the cap rail stand proud. */
    fence: { postFt: number; postSpacingFt: number; postRiseFt: number; capFt: number; capOverhangFt: number };
    /** Flat ground elements start this far above the ground, and where two overlap the later one stands at least `layerStepFt` above the earlier one, so their tops never share a depth and flicker. */
    groundLiftFt: number;
    layerStepFt: number;
    /** Overlays drawn flat over the ground (the sun map, the easement, the placement heatmap, the lot lines) sit this far above the tallest flat surface, so none of them is cut by a patio or a bed. */
    overlayGapFt: number;
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
  /** How it looks up close; species without it keep the simple shape. */
  look?: LookData;
  /** Berries and seeds birds eat, in these months, besides any `fruit`. */
  birdFood?: { months: number[] };
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
  /** The owner's price for this one plant in dollars, replacing the species and container prices. */
  price?: number;
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
  /** Stand-in installed price in dollars per `priceBasis`: per square foot, per linear foot, or each. The owner can override it. */
  price?: number;
  priceBasis?: 'sf' | 'lf' | 'each';
  /** How the surface looks up close: a pattern, how many feet one repeat of its texture covers, and how rough it is (0 to 1). */
  surface?: { pattern: SurfacePattern; tileFt: number; bump: number };
}

/** The look of a surface: slab concrete with joints, pavers, mortared or dry-laid flagstone, fine granules, gravel, wood chips, turf, deck boards, composite decking, block wall, fence boards. */
export type SurfacePattern = 'slab' | 'pavers' | 'flagstone-mortar' | 'flagstone-dry' | 'granular' | 'gravel' | 'mulch' | 'turf' | 'planks' | 'composite' | 'cmu' | 'boards';

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
  /** The owner's price for this element in dollars, replacing the one worked out from its material and size. */
  price?: number;
  /** Display color chosen by the owner; falls back to the material's color. */
  color?: string;
  /** Existing elements a scenario removes. */
  removed?: boolean;
  /** New work must not cover this (the driveway). */
  keepClear?: boolean;
  /** Raised beds: the crops grown there. Without it the bed gets a default rotation from its id. */
  crops?: CropPlan;
  /**
   * Raised beds are built from square modules on a grid (`hardscape.raisedBedModule.cellFt`): the [column, row] of each
   * module counted from the lower-left corner of the bed's bounding box, which is the lower-left of `points`. `points`
   * is the outline of the modules. A bed without it is an older free-form bed and is left alone.
   */
  cells?: [number, number][];
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
  produce?: { color: string; sizeFt: number; count: number; /** What it looks like, and where it sits on the plant. */ shape: 'sphere' | 'pepper' | 'eggplant' | 'zucchini' | 'cucumber' | 'pod' | 'head' | 'berry' | 'carrot'; place: 'stems' | 'center' | 'ground' | 'edge' };
  /** How the leaves and stems look up close (the same data the garden plants use). */
  look: LookData;
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
  /** Plants are laid out no closer than their drawn size allows: the canopy may touch, and produce keeps this share of its own width as a gap. */
  canopyShare: number;
  produceGapShare: number;
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

/** Prices the owner has set for this scenario, in dollars; anything not set falls back to the defaults. */
export interface Prices {
  /** Per plant, by species id: applies to every container of that species. */
  plant: Record<string, number>;
  /** Per material, by material id: per square foot, linear foot or each, as the material's basis says. */
  material: Record<string, number>;
}

/** The first-person "Walk" view: a person you steer with WASD, run with Shift and jump with the space bar. */
export interface PlayerCfg {
  eyeHeightFt: number;
  /** Entering the Walk view from another view drops the person from this height (feet) onto the ground where that view was looking, or the nearest open ground within `dropSearchFt`. */
  dropHeightFt: number;
  dropSearchFt: number;
  /** Holding C crouches: the eyes drop to this height (to look into a raised bed), speed falls to this share of walking speed, and there is no running or jumping while crouched. */
  crouchEyeHeightFt: number;
  crouchSpeedShare: number;
  /** How quickly the crouch comes on and off, in changes of the whole movement per second. */
  crouchRate: number;
  /** Speeds in feet per second. */
  walkFtS: number;
  runFtS: number;
  /** How fast speed changes on the ground and in the air (feet per second squared). */
  groundAccel: number;
  airAccel: number;
  gravityFtS2: number;
  jumpFtS: number;
  /** The tallest edge walked up without jumping. */
  stepUpFt: number;
  /** Body radius, so you cannot squeeze into a wall or a trunk. */
  radiusFt: number;
  /** Stay this far inside the lot edge. */
  lotMarginFt: number;
  /** Arrow keys turn this fast (radians per second); the mouse turns `lookRadPerPx` per pixel dragged. */
  turnRadS: number;
  lookRadPerPx: number;
  pitchLimitRad: number;
  fovDeg: number;
  /** Plants this short (share of their height at the feet) can be stepped or jumped over. */
  plantClearShare: number;
  /** A plant blocks within this share of its canopy radius; a tree only at its trunk. */
  plantBlockShare: number;
}

/** The raised bed shapes an owner can place, built from square modules. */
export interface RaisedBedModuleCfg {
  /** Side of one module, in feet (3 ft: the smallest bed, and an arm's reach to the middle from either side). */
  cellFt: number;
  /** Modules this close edge to edge (feet) snap flush and join, when together they make one of the shapes below. */
  snapFt: number;
  /** The shapes: `cells` are [column, row]. Turning and mirroring give the same shape, so only one orientation is listed. */
  shapes: { id: string; label: string; cells: [number, number][] }[];
}

/** What a person's body is made of, as shares of stature (see `engine/anatomy.ts`). */
export interface AnatomyKey {
  age: number;
  /** Height of the hip joint, the ankle, and the length of the head (crown to chin), neck, upper arm, forearm, hand and foot. */
  hipJoint: number; ankle: number; head: number; neck: number; upperArm: number; forearm: number; hand: number; foot: number;
  /** Half the distance between the shoulder joints and between the hip joints. */
  shoulderHalf: number; hipHalf: number;
  /** Width and depth of the chest, waist and hips. */
  chestW: number; chestD: number; waistW: number; waistD: number; hipW: number; hipD: number;
}

export interface AnatomyCfg {
  note: string;
  keys: AnatomyKey[];
  /** Multipliers by sex for the fields they name, phasing in between the two ages in `sexFromAge`. */
  sex: Record<'f' | 'm', Partial<Record<keyof AnatomyKey, number>>>;
  sexFromAge: [number, number];
  /** Width multipliers by build (chest, waist, hips and the limbs). */
  build: Record<'slim' | 'average' | 'broad', number>;
  /** Radii as shares of stature at each joint and the middle of each limb. */
  radii: { thigh: number; knee: number; calf: number; ankle: number; upperArm: number; elbow: number; forearm: number; wrist: number; neck: number; footWidth: number; headWidth: number; headDepth: number };
  /** The eyes sit this share of the head's length below its top. */
  eyeFromTopShare: number;
  /** The hip joint is this share of stature above the seat when sitting. */
  seatHipAboveSeat: number;
  gait: { froude: number; stepOverLeg: number; stepExponent: number; gravity: number; maxSwing: number; kneeFlex: number; armSwingShare: number; /** Sitting on a seat too high for the feet to reach, the thighs tilt down by up to this many radians. */ maxSitTilt: number };
}
