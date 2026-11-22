import { circleOverlapsPolygon, pointInPolygon } from './geometry';
import { mulberry32 } from './shuffle';
import { solarPosition } from './solar';
import { localToUtc, monthDayToDoy } from './time';
import type { LifeWorld } from './life';
import type { BirthdayCfg, EngineConfig, Pt, Resident, SiteConfig, StructureCfg } from './types';

/** Residents whose birthday falls on a day (two can share one). */
export function birthdaysOn(month: number, day: number, residents: Resident[]): string[] {
  return residents.filter((r) => r.month === month && r.day === day).map((r) => r.name);
}

/** "Jemma", "Madeleine & Abby", "A, B & C": the names as they read on the greeting. */
export function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

export const greeting = (names: string[]): string => `Happy Birthday, ${nameList(names)}!`;

const sunsetCache = new Map<string, number>();

/**
 * The minute of the day (local time) when the sun sets on a date: the first minute after noon when it is under the
 * horizon line, counting refraction. Null when it does not set (polar summer) or never rises.
 */
export function sunsetMinute(site: Pick<SiteConfig, 'timeZone' | 'latitude' | 'longitude'>, engine: Pick<EngineConfig, 'referenceYear' | 'sun'>, month: number, day: number): number | null {
  const key = `${site.timeZone}|${site.latitude}|${site.longitude}|${engine.referenceYear}|${month}|${day}`;
  const hit = sunsetCache.get(key);
  if (hit !== undefined) return hit < 0 ? null : hit;
  const elev = (m: number) => solarPosition(localToUtc(site.timeZone, engine.referenceYear, month, day, 0, m), site.latitude, site.longitude, engine.sun.refraction).elevationDeg;
  let found: number | null = null;
  for (let m = 12 * 60; m < 1440; m++) {
    if (elev(m) <= -0.833) {
      found = m;
      break;
    }
  }
  sunsetCache.set(key, found ?? -1);
  return found;
}

export interface BirthdayDay {
  names: string[];
  sunset: number;
  /** From this minute the party is on, until `partyEnd`. */
  partyStart: number;
  partyEnd: number;
  /** The cake is out from `cakeStart` to `cakeEnd`. */
  cakeStart: number;
  cakeEnd: number;
  /** The projector plays the greeting from sunset on. */
  movieStart: number;
}

/** Everything about a birthday on a date, or null when nobody has one. Times are minutes of the local day. */
export function birthdayDay(site: SiteConfig, engine: EngineConfig, month: number, day: number): BirthdayDay | null {
  const names = birthdaysOn(month, day, site.residents ?? []);
  if (!names.length) return null;
  const sunset = sunsetMinute(site, engine, month, day) ?? 19 * 60;
  const b = engine.birthday;
  return {
    names, sunset,
    partyStart: sunset - b.partyHoursBefore * 60, partyEnd: sunset + b.partyHoursAfter * 60,
    cakeStart: sunset - b.cakeMinutesBefore, cakeEnd: sunset + b.cakeMinutesAfter,
    movieStart: sunset,
  };
}

export const partyOn = (d: BirthdayDay | null, minutes: number): boolean => !!d && minutes >= d.partyStart && minutes < d.partyEnd;
export const cakeOn = (d: BirthdayDay | null, minutes: number): boolean => !!d && minutes >= d.cakeStart && minutes < d.cakeEnd;

/** Every birthday of the year in date order, for jumping to one. */
export function birthdayCalendar(residents: Resident[]): { names: string[]; month: number; day: number; doy: number }[] {
  const byDay = new Map<number, { names: string[]; month: number; day: number; doy: number }>();
  for (const r of residents) {
    const doy = monthDayToDoy(r.month, r.day);
    const e = byDay.get(doy) ?? { names: [], month: r.month, day: r.day, doy };
    e.names.push(r.name);
    byDay.set(doy, e);
  }
  return [...byDay.values()].sort((a, b) => a.doy - b.doy);
}

export interface Present {
  x: number;
  y: number;
  /** Box width and height in feet, a quarter-turn-free yaw, and colors. */
  size: number;
  height: number;
  yaw: number;
  color: string;
  ribbon: string;
}

/**
 * Presents lying about the yard: mostly close around the communal table, the rest scattered over open ground in the party
 * yard. Always on open ground, clear of plants, the table and buildings. Repeatable for a seed.
 */
export function presentSpots(world: LifeWorld, b: BirthdayCfg, seed: number, backyard: Pt[][]): Present[] {
  const rng = mulberry32(seed);
  const pc = b.presents;
  const cells = world.reachable.map((k) => [((k % world.nx) + 0.5) * world.cell, (Math.floor(k / world.nx) + 0.5) * world.cell] as Pt);
  const table = world.tables[0];
  const tablePoly = table ? ([] as Pt[]) : [];
  void tablePoly;
  const nearN = table ? Math.round(pc.count * pc.nearTableShare) : 0;
  const out: Present[] = [];
  const free = (x: number, y: number, size: number) =>
    out.every((o) => Math.hypot(o.x - x, o.y - y) > (o.size + size) * 0.9) &&
    !world.plants.some((p) => circleOverlapsPolygon(x, y, size / 2, [[p.x - p.r, p.y - p.r], [p.x + p.r, p.y - p.r], [p.x + p.r, p.y + p.r], [p.x - p.r, p.y + p.r]]));
  const make = (x: number, y: number): Present => {
    const size = pc.sizeFt[0] + rng() * (pc.sizeFt[1] - pc.sizeFt[0]);
    return { x, y, size, height: size * (0.6 + rng() * 0.5), yaw: rng() * Math.PI, color: pc.colors[Math.floor(rng() * pc.colors.length)], ribbon: pc.ribbons[Math.floor(rng() * pc.ribbons.length)] };
  };
  if (table) {
    const near = cells.filter(([x, y]) => {
      const d = Math.hypot(x - table.center[0], y - table.center[1]);
      return d >= pc.nearTableFt[0] && d <= pc.nearTableFt[1] + 4;
    });
    for (let tries = 0; tries < 600 && out.length < nearN && near.length; tries++) {
      const [x, y] = near[Math.floor(rng() * near.length)];
      const p = make(x, y);
      if (free(x, y, p.size)) out.push(p);
    }
  }
  const yard = cells.filter(([x, y]) => backyard.some((poly) => pointInPolygon(x, y, poly)));
  const pool = yard.length ? yard : cells;
  for (let tries = 0; tries < 800 && out.length < pc.count && pool.length; tries++) {
    const [x, y] = pool[Math.floor(rng() * pool.length)];
    const p = make(x, y);
    if (free(x, y, p.size)) out.push(p);
  }
  return out;
}

export interface Balloon {
  /** Where its string is tied, on the ground. */
  x: number;
  y: number;
  /** String length: how high the balloon floats, in feet. */
  length: number;
  /** Lean of the string at rest, so a bunch fans out. */
  lean: [number, number];
  color: string;
  phase: number;
}

export interface BalloonBunch {
  door: string;
  x: number;
  y: number;
  balloons: Balloon[];
}

/**
 * Bunches of balloons tied just outside each door of the buildings in the plan: one on each side of the door, a little out
 * from the wall, the balloons fanning out at different heights. Repeatable for a seed.
 */
export function balloonBunches(site: Pick<SiteConfig, 'doors'>, structures: StructureCfg[], b: BirthdayCfg, seed: number): BalloonBunch[] {
  const bc = b.balloons;
  const rng = mulberry32(seed);
  const buildings = new Set(structures.map((s) => s.group ?? s.id));
  const out: BalloonBunch[] = [];
  for (const d of site.doors ?? []) {
    if (!buildings.has(d.building)) continue;
    const [ox, oy] = d.outward;
    const [px, py] = [-oy, ox]; // across the door
    for (const side of [-1, 1]) {
      const x = d.point[0] + ox * bc.outFt + px * side * bc.sideFt;
      const y = d.point[1] + oy * bc.outFt + py * side * bc.sideFt;
      const balloons: Balloon[] = Array.from({ length: bc.perBunch }, (_, i) => ({
        x, y,
        length: bc.stringFt[0] + rng() * (bc.stringFt[1] - bc.stringFt[0]),
        lean: [(rng() - 0.5) * 0.5, (rng() - 0.5) * 0.5],
        color: bc.colors[(i + Math.floor(rng() * bc.colors.length)) % bc.colors.length],
        phase: rng() * Math.PI * 2,
      }));
      out.push({ door: d.id, x, y, balloons });
    }
  }
  return out;
}

/** Birthdays by "month-day" key with the names joined ("Madeleine & Abby"), for marking them on a calendar. */
export function birthdayKeys(residents: Resident[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of residents) {
    const k = `${r.month}-${r.day}`;
    out.set(k, out.has(k) ? `${out.get(k)} & ${r.name}` : r.name);
  }
  return out;
}
