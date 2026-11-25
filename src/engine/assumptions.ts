import type { Confidence, EngineConfig, Material, SiteConfig, SoilConfig, SpeciesLibrary, WaterConfig } from './types';

export interface AssumptionItem {
  label: string;
  value: string;
  source: string;
  confidence?: Confidence;
  /** True when the number is a stand-in that must be replaced. */
  placeholder?: boolean;
}

export interface AssumptionGroup {
  title: string;
  items: AssumptionItem[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const row12 = (a: number[]) => a.map((v, i) => `${MONTHS[i]} ${v}`).join(', ');

/** Every coefficient and data source behind the numbers shown (OUT-3, NF-5). */
export function buildAssumptions(args: {
  engine: EngineConfig;
  water: WaterConfig;
  soil: SoilConfig;
  site: SiteConfig;
  library: SpeciesLibrary;
  materials?: Material[];
}): AssumptionGroup[] {
  const { engine, water, soil, site, library } = args;
  const materials = args.materials ?? [];
  const g = engine.growth;
  const irr = (k: keyof WaterConfig['irrigation']) => `${water.irrigation[k].label} ${water.irrigation[k].efficiency}`;
  return [
    {
      title: 'Water demand',
      items: [
        { label: 'Formula', value: 'Monthly gallons = ETo x 0.62 x (PF x A) / IE', source: water.formula.source, confidence: water.formula.confidence },
        { label: 'A (area)', value: 'Canopy area at the timeline year, pi x (width / 2)^2. Overlapping canopies are counted separately.', source: 'Design choice' },
        { label: 'Monthly ETo (in)', value: row12(water.eto.monthly), source: `${water.eto.station}. ${water.eto.source}`, confidence: water.eto.confidence, placeholder: water.eto.status !== 'verified' },
        { label: 'Plant factor by category', value: Object.entries(g.wucolsPlantFactor).map(([k, v]) => `${k} ${v}`).join(', '), source: water.plantFactorSource, confidence: 'medium' },
        { label: 'Plant factor ranges', value: Object.entries(water.plantFactorRanges).map(([k, v]) => `${k} ${v[0]}-${v[1]}`).join(', '), source: 'MWELO', confidence: 'high' },
        { label: 'Irrigation efficiency (IE)', value: ['drip', 'spray', 'hand', 'none'].map((k) => irr(k as keyof WaterConfig['irrigation'])).join(', '), source: `Drip and spray: MWELO. Hand: ${water.irrigation.hand.source}.`, confidence: 'medium' },
        { label: 'Watered area floor (young plants)', value: `At least ${water.wetting.ballDiameterFactor} x the root ball's diameter across, by container (${Object.entries(soil.containers).map(([k, v]) => `${k} ${Math.round((v.ballDiaIn * water.wetting.ballDiameterFactor / 12) * 10) / 10} ft`).join(', ')}); canopy area once it is wider`, source: water.wetting.source, confidence: water.wetting.confidence, placeholder: true },
        { label: 'Establishment multiplier', value: Object.entries(water.establishment).map(([k, v]) => `${k} x${v.multiplier} for ${v.months} mo`).join(', '), source: water.establishmentSource, confidence: 'low' },
        { label: 'Lawn plant factor', value: `${water.lawn.plantFactor}, ${water.irrigation[water.lawn.irrigation].label}`, source: water.lawn.source, confidence: water.lawn.confidence },
        { label: 'Effective rainfall (optional)', value: `${row12(water.rainfall.monthly)} in, x ${water.rainfall.effectiveFraction} effective`, source: `${water.rainfall.station}: ${water.rainfall.source} Effective share: ${water.rainfall.effectiveFractionSource}`, confidence: water.rainfall.effectiveFractionConfidence },
        { label: 'Water budget (benchmark)', value: `MAWA = ETo x 0.62 x ETAF ${water.budget.etaf} x landscape area`, source: water.budget.source, confidence: water.budget.confidence },
      ],
    },
    {
      title: 'Soil and planting',
      items: [
        { label: 'Default soil profile', value: `${soil.defaultProfile.texture}, ${soil.defaultProfile.drainageInHr} in/hr, pH ${soil.defaultProfile.ph}, ${soil.defaultProfile.organicMatterPct}% organic matter`, source: 'Assumed per zone until tested (brief)', confidence: 'low' },
        { label: 'Drainage classes', value: `fast >= ${soil.drainageClasses.fastMinInHr} in/hr, moderate >= ${soil.drainageClasses.moderateMinInHr}, else slow`, source: soil.drainageSource },
        { label: 'pH tolerance', value: `${soil.phTolerance} beyond a species' range before flagging`, source: 'Design choice' },
        { label: 'Species soil needs', value: `${library.species.length} species: drainage, textures, pH`, source: library.soilNote ?? 'Unverified', confidence: 'low' },
        { label: 'Root ball by container', value: Object.entries(soil.containers).map(([k, v]) => `${k} ${v.ballDiaIn} x ${v.ballDepthIn} in`).join(', '), source: soil.containerSource, confidence: 'low' },
        { label: 'Planting hole', value: `${soil.hole.widthFactor} x ball width, ${soil.hole.depthFactor} x ball depth`, source: soil.hole.source },
        { label: 'Amendment', value: `${soil.amendment.fractionOfBackfill * 100}% of backfill; skipped for ${soil.amendment.skipForDrainageNeed.join(', ')}-drainage plants`, source: soil.amendment.source, confidence: 'low' },
        { label: 'Mulch', value: `${soil.mulch.depthIn} in deep; ${soil.mulch.ringDiameterFt} ft ring for plants outside beds`, source: soil.mulch.source },
        { label: 'Tree rootable soil', value: `${soil.rootableSoil.cuFtPerSfCanopy} cu ft per sq ft of mature canopy, ${soil.rootableSoil.depthFt} ft deep, searching ${soil.rootableSoil.searchRadiusFactor} x canopy radius`, source: soil.rootableSoil.source, confidence: soil.rootableSoil.confidence },
        { label: 'Raised bed fill', value: `fill stops ${soil.raisedBed.freeboardIn} in below the rim`, source: soil.raisedBed.source },
      ],
    },
    {
      title: 'Growth and light',
      items: [
        { label: 'Growth curve', value: `Logistic S-curve, steepness ${g.steepness} / years to maturity, from container size to mature size`, source: 'Requirements brief' },
        { label: 'Container size at planting', value: Object.entries(g.containers).map(([k, v]) => `${k} ${v.height} ft tall, ${v.width} ft wide`).join('; '), source: 'Design choice; capped at ' + g.maxStartFractionOfMature * 100 + '% of mature size' },
        { label: 'Sun model', value: `Clear sky only, ${engine.sun.stepMinutes}-minute steps, ${engine.sun.cellSizeFt} ft cells, sun above ${engine.sun.minElevationDeg} deg`, source: 'NOAA solar position. Clouds and the marine layer are not modeled.' },
        { label: 'Sun classes', value: `full >= ${engine.sun.classes.fullSunHours} h, part sun >= ${engine.sun.classes.partSunHours}, part shade >= ${engine.sun.classes.partShadeHours}`, source: 'Requirements brief' },
        { label: 'Light need check', value: `full sun needs ${g.sunNeedHours.full.min}+ h; part sun ${g.sunNeedHours.part.min} to ${g.sunNeedHours.part.max} h; shade under ${g.sunNeedHours.shade.max} h (growing season Mar to Oct)`, source: 'Design choice' },
        { label: 'Canopy shade density', value: Object.entries(g.shadowDensityByType).map(([k, v]) => `${k} ${v}`).join(', ') + `; leafless deciduous x${g.leafOffDensityFactor}`, source: 'Design choice' },
      ],
    },
    {
      title: 'Pollinators and outputs',
      items: [
        { label: 'Bloom score weights', value: `high ${water.pollinator.weights.high}, moderate ${water.pollinator.weights.moderate}, low ${water.pollinator.weights.low}; up to ${water.pollinator.countCap} plants per species`, source: water.pollinator.source },
        { label: 'Bloom gap', value: 'A month with no high-value pollinator plant in bloom', source: 'Requirements brief' },
        { label: 'Plant library values', value: `${library.species.length} species`, source: library.provenanceDefault.source, confidence: library.provenanceDefault.confidence },
        { label: 'Plant spacing', value: `${water.outputs.spacingFactor} x mature width, on center`, source: water.outputs.spacingSource },
        { label: 'Hardscape quantities', value: 'Net of waste. Surface = area x depth; base = area x material base depth', source: 'Design choice' },
      ],
    },
    {
      title: 'Prices and costs',
      items: [
        { label: 'Water rate (cost readout)', value: `${engine.pricing.currency}${engine.pricing.water.perCcf} per hundred cubic feet (${engine.pricing.water.galPerCcf} gal), applied to the irrigation plan's gallons a year`, source: engine.pricing.water.source, confidence: 'low' as Confidence, placeholder: true },
        { label: 'Plant prices', value: `Per plant by container: ${Object.entries(engine.pricing.plantByContainer).map(([k, v]) => `${k} ${engine.pricing.currency}${v}`).join(', ')}, unless set per species or per plant`, source: engine.pricing.source, confidence: 'medium' },
        ...(materials.length ? [{ label: 'Hardscape prices', value: materials.filter((m) => m.price !== undefined).map((m) => `${m.name} ${engine.pricing.currency}${m.price}/${m.priceBasis === 'each' ? 'each' : m.priceBasis === 'lf' ? 'lin ft' : 'sq ft'}`).join('; '), source: 'Stand-in installed prices for the Los Angeles area; no public data set was used. Replace them with quotes.', confidence: 'low' as Confidence, placeholder: true }] : []),
        ...(engine.pricing.references ?? []).map((r) => ({ label: `Price source: ${r.name}`, value: `${r.covers}. ${r.note}`, source: r.url, confidence: 'medium' as Confidence })),
        { label: 'What the cost covers', value: 'New plants and new hardscape only; installed prices for hardscape, nursery prices for plants. Not included: tax, delivery, soil and amendments, irrigation, design fees.', source: 'Design choice' },
      ],
    },
    {
      title: 'Site',
      items: site.assumptions.map((a) => ({ label: a.id, value: a.text, source: 'Site file', placeholder: !!a.estimate })),
    },
  ];
}

/** Items that are stand-ins and must be replaced before the numbers are relied on. */
export function placeholders(groups: AssumptionGroup[]): AssumptionItem[] {
  return groups.flatMap((g) => g.items).filter((i) => i.placeholder);
}
