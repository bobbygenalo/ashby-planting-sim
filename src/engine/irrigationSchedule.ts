import type { Family, IrrigationCfg, IrrigationPlan, Valve } from './irrigation';
import { monthlyGallons, WATER_ORDER, type DemandRow } from './water';
import type { WaterConfig } from './types';
import { weekdayOf } from './vehicle';

/** Water one valve gives in a month, and how that is split into runs. */
export interface MonthSchedule {
  /** Gallons the valve gives in a week of this month. */
  weeklyGal: number;
  runsPerWeek: number;
  minutesPerRun: number;
  galPerRun: number;
  /** Days of the week it runs, 0 Sunday to 6 Saturday. */
  weekdays: number[];
}

export interface ValveSchedule {
  valveId: string;
  /** The water access it is fed from; each access runs its own valves one after another, so two accesses water at the same time. */
  sourceId: string;
  /** Gallons it applies in each month (applied water: what leaves the emitters and heads). */
  monthlyGal: number[];
  annualGal: number;
  months: MonthSchedule[];
}

/** One run of a valve on a given day. Times are minutes after midnight. */
export interface ValveRun {
  valveId: string;
  startMin: number;
  endMin: number;
  gal: number;
  /** True when the day's runs did not fit the allowed watering windows. */
  overflow: boolean;
}

export interface IrrigationSchedule {
  valves: ValveSchedule[];
  /** Applied water through valves, by month, and by hand, by month. */
  valveMonthlyGal: number[];
  handMonthlyGal: number[];
  totalMonthlyGal: number[];
  valveAnnualGal: number;
  handAnnualGal: number;
  totalAnnualGal: number;
  warnings: string[];
}

export interface ScheduleInput {
  plan: IrrigationPlan;
  /** Water demand rows of the plants and lawns (`waterDemand().rows`). */
  rows: DemandRow[];
  /** Raised beds in the plan with their footprint areas. */
  beds: { id: string; areaSf: number }[];
  water: WaterConfig;
  useRain: boolean;
  cfg: IrrigationCfg;
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const zeros = () => new Array(12).fill(0) as number[];

/** The driest-to-wettest rank of the most demanding category on a valve (the one that sets how often it runs). */
function wettest(valve: Valve): string {
  return valve.categories.reduce((best, c) => (WATER_ORDER.indexOf(c as (typeof WATER_ORDER)[number]) > WATER_ORDER.indexOf(best as (typeof WATER_ORDER)[number]) ? c : best), valve.categories[0] ?? 'moderate');
}

/**
 * Water the scenario needs, valve by valve and month by month, and a typical weekly schedule to deliver it. Gallons come
 * from the same MWELO-style demand the Water & soil tab shows (`waterDemand`): the sum of the plants and lawn on a valve,
 * plus the raised beds on it, estimated from the bed's area and a vegetable plant factor (crops are not in `waterDemand`).
 * A valve's weekly gallons are spread over a few runs (more often for thirsty plants and for beds) that are short enough
 * for its kind of device, and the valves run one after another in the allowed early-morning and evening windows.
 */
export function buildSchedule(inp: ScheduleInput): IrrigationSchedule {
  const { plan, cfg, water } = inp;
  const rain = inp.useRain ? water.rainfall.monthly.map((r) => r * water.rainfall.effectiveFraction) : null;
  const rowById = new Map(inp.rows.map((r) => [r.id, r]));
  const bedGal = (areaSf: number) =>
    monthlyGallons({ eto: water.eto.monthly, rain, plantFactor: cfg.bed.plantFactor, areaSf, efficiency: water.irrigation.drip.efficiency, conversion: water.formula.conversion });
  const bedArea = new Map(inp.beds.map((b) => [b.id, b.areaSf]));
  const warnings: string[] = [];

  const valves: ValveSchedule[] = plan.valves.map((v) => {
    let monthly = zeros();
    for (const id of v.plantIds) {
      const r = rowById.get(id);
      if (r) monthly = monthly.map((g, m) => g + r.monthlyGal[m]);
    }
    for (const [lawnId, gph] of Object.entries(v.lawnGph)) {
      const r = rowById.get(lawnId);
      const total = plan.plants.find((p) => p.id === lawnId)?.gph ?? 0;
      if (r && total > 0) monthly = monthly.map((g, m) => g + (r.monthlyGal[m] * gph) / total);
    }
    for (const id of v.bedIds) monthly = monthly.map((g, m) => g + bedGal(bedArea.get(id) ?? 0)[m]);
    const cat = wettest(v);
    const baseDays = v.hydrozoneId === 'auto:bed' ? cfg.schedule.bedDaysPerWeek : cfg.schedule.daysPerWeek[cat] ?? 2;
    const months: MonthSchedule[] = monthly.map((g, m) => {
      const weeklyGal = (g * 7) / water.daysInMonth[m];
      if (weeklyGal <= 0.01 || v.gph <= 0) return { weeklyGal: 0, runsPerWeek: 0, minutesPerRun: 0, galPerRun: 0, weekdays: [] };
      const weeklyMin = (weeklyGal / v.gph) * 60;
      let n = baseDays;
      if (weeklyMin / n < cfg.schedule.minRunMin) n = Math.max(1, Math.floor(weeklyMin / cfg.schedule.minRunMin));
      if (weeklyMin / n > cfg.schedule.maxRunMin[v.family]) n = Math.min(7, Math.ceil(weeklyMin / cfg.schedule.maxRunMin[v.family]));
      // position among the valves of its own access, so each access starts its first valve on the same days
      const idx = plan.valves.filter((o) => o.sourceId === v.sourceId).indexOf(v);
      // spread the days evenly, and start each valve on a different day so the week is not all on one morning
      const weekdays = [...new Set(Array.from({ length: n }, (_, j) => (Math.round((j * 7) / n) + idx) % 7))].sort((a, b) => a - b);
      return { weeklyGal, runsPerWeek: weekdays.length, minutesPerRun: weeklyMin / weekdays.length, galPerRun: weeklyGal / weekdays.length, weekdays };
    });
    return { valveId: v.id, sourceId: v.sourceId, monthlyGal: monthly, annualGal: sum(monthly), months };
  });

  // water by hand: hand-watered and dry plants and lawns, and beds left to hand watering
  let hand = zeros();
  for (const r of plan.hand) {
    const row = rowById.get(r.id);
    if (row && r.method === 'hand') hand = hand.map((g, m) => g + row.monthlyGal[m]);
  }
  for (const b of plan.beds) if (b.method === 'hand') hand = hand.map((g, m) => g + bedGal(bedArea.get(b.id) ?? 0)[m]);

  const valveMonthly = valves.reduce((acc, v) => acc.map((g, m) => g + v.monthlyGal[m]), zeros());
  const total = valveMonthly.map((g, m) => g + hand[m]);
  const s: IrrigationSchedule = {
    valves, valveMonthlyGal: valveMonthly, handMonthlyGal: hand, totalMonthlyGal: total,
    valveAnnualGal: sum(valveMonthly), handAnnualGal: sum(hand), totalAnnualGal: sum(total), warnings,
  };
  // a valve with a run too long for the windows
  const windowMin = Math.max(...cfg.schedule.windows.map((w) => w.endMin - w.startMin));
  for (const v of valves) {
    const worst = Math.max(...v.months.map((m) => m.minutesPerRun));
    if (worst > windowMin) warnings.push(`${v.valveId} needs a ${Math.round(worst)} minute run in its thirstiest month, longer than the ${Math.round(windowMin / 60)} hour watering window.`);
  }
  return s;
}

/**
 * The runs on one day of the week in a month. Each water access runs its own valves one after another from the start of
 * the first window (so the front and back yards water at the same time); a run that
 * does not fit what is left of a window goes to the next. A run that fits no window is flagged and follows the last one.
 */
export function runsOnDay(schedule: IrrigationSchedule, month: number, weekday: number, cfg: IrrigationCfg): ValveRun[] {
  const windows = cfg.schedule.windows;
  const cursors = new Map<string, number[]>();
  const out: ValveRun[] = [];
  for (const v of schedule.valves) {
    const m = v.months[month - 1];
    if (!m || !m.weekdays.includes(weekday)) continue;
    const cursor = cursors.get(v.sourceId) ?? windows.map((w) => w.startMin);
    cursors.set(v.sourceId, cursor);
    const need = m.minutesPerRun;
    const w = windows.findIndex((win, i) => cursor[i] + need <= win.endMin + 1e-9);
    if (w >= 0) {
      out.push({ valveId: v.valveId, startMin: cursor[w], endMin: cursor[w] + need, gal: m.galPerRun, overflow: false });
      cursor[w] += need + cfg.schedule.gapMin;
    } else {
      const last = windows.length - 1;
      out.push({ valveId: v.valveId, startMin: cursor[last], endMin: cursor[last] + need, gal: m.galPerRun, overflow: true });
      cursor[last] += need + cfg.schedule.gapMin;
    }
  }
  return out;
}

/** The runs going at a minute of the day. */
export const runsAt = (runs: ValveRun[], minute: number): ValveRun[] => runs.filter((r) => minute >= r.startMin && minute < r.endMin);

/** Day of the week of a month and day in the reference year (0 Sunday to 6 Saturday). */
export const weekdayFor = (referenceYear: number, month: number, day: number): number => weekdayOf(referenceYear, month, day);

/** The first day on or after a day of the year, and the minute, when any valve runs (for jumping to it). */
export function nextRun(
  schedule: IrrigationSchedule, doy: number, minute: number, referenceYear: number, cfg: IrrigationCfg,
  toMonthDay: (doy: number) => [number, number],
): { doy: number; run: ValveRun } | null {
  for (let step = 0; step < 366; step++) {
    const d = ((doy - 1 + step) % 365) + 1;
    const [mo, da] = toMonthDay(d);
    const runs = runsOnDay(schedule, mo, weekdayOf(referenceYear, mo, da), cfg);
    const hit = runs.find((r) => step > 0 || r.endMin > minute);
    if (hit) return { doy: d, run: hit };
  }
  return null;
}

export type { Family };
