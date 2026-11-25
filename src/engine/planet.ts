import { mulberry32 } from './shuffle';
import type { CloudKind, PlanetCfg } from './types';

type V3 = [number, number, number];

/**
 * The ground as one surface of revolution about a vertical axis through the lot's middle: a flat plateau (so the lot, whose
 * corners are about 80 ft out, sits level) that rolls over into a sphere of the planet's radius, tangent to the plateau at its
 * edge, round the far side and shut at the bottom. Each entry is [horizontal distance from the axis, height], in feet, from the
 * middle outward and down.
 */
export function planetProfile(cfg: Pick<PlanetCfg, 'radiusFt' | 'plateauFt' | 'ringsCurved'>): [number, number][] {
  const { radiusFt: R, plateauFt: r0, ringsCurved: n } = cfg;
  const out: [number, number][] = [[0, 0], [r0 * 0.5, 0], [r0, 0]];
  // The sphere's middle sits R below the plateau's edge: a point at angle t from the top is (r0 + R sin t, -R (1 - cos t)).
  // Rings are packed more closely near the top, where the surface is seen at a grazing angle.
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const t = Math.PI * (u * u * 0.35 + u * 0.65);
    out.push([r0 + R * Math.sin(t), -R * (1 - Math.cos(t))]);
  }
  // The arc ends at angle pi: back at r0 on the underside. Close the bottom with a flat disc.
  out.push([r0 * 0.5, -2 * R], [0, -2 * R]);
  return out;
}

/** How far below the plateau the ground is at a horizontal distance from the lot's middle (zero over the plateau). */
export function groundDropFt(r: number, cfg: Pick<PlanetCfg, 'radiusFt' | 'plateauFt'>): number {
  if (r <= cfg.plateauFt) return 0;
  const d = Math.min(r - cfg.plateauFt, cfg.radiusFt);
  return cfg.radiusFt - Math.sqrt(cfg.radiusFt * cfg.radiusFt - d * d);
}

/** Smooth patchy noise in [0, 1] at a point, for the colors of the ground; deterministic. */
export function patchNoise(x: number, y: number, patchFt: number): number {
  const f = (k: number) => Math.sin(x / patchFt * k + Math.cos(y / patchFt * 0.7 * k) * 1.7) * Math.cos(y / patchFt * k * 0.9 - Math.sin(x / patchFt * 0.6 * k) * 1.3);
  return Math.min(1, Math.max(0, 0.5 + 0.28 * f(1) + 0.17 * f(2.3) + 0.08 * f(5.1)));
}

/** Directions on the unit sphere for the stars (uniform), seeded. */
export function starDirections(count: number, seed: number): V3[] {
  const r = mulberry32(seed);
  const out: V3[] = [];
  for (let i = 0; i < count; i++) {
    const z = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - z * z);
    out.push([s * Math.cos(a), z, s * Math.sin(a)]);
  }
  return out;
}

/** How much of the stars shows for a sun elevation: none while the sun is up, all in the dark of night. */
export function starVisibility(sunElevationDeg: number, cfg: Pick<PlanetCfg['stars'], 'fullDeg' | 'fadeEndDeg'>): number {
  if (sunElevationDeg >= cfg.fadeEndDeg) return 0;
  if (sunElevationDeg <= cfg.fullDeg) return 1;
  return (cfg.fadeEndDeg - sunElevationDeg) / (cfg.fadeEndDeg - cfg.fullDeg);
}

/** One cloud: where its middle is on the shell round the planet (a unit direction and its height above the ground), the way it lies (a unit vector along the ground), and its puffs. */
export interface CloudSpec {
  dir: V3;
  altitudeFt: number;
  /** The direction along the wind at this place, tangent to the shell. */
  along: V3;
  puffs: { dx: number; dy: number; dz: number; size: number }[];
}

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** The wind's direction at a point of the shell: the wind vector with its upward part taken out, as a unit vector (any tangent when it blows straight up). */
export function windAlong(dir: V3, wind: V3 | null): V3 {
  if (wind) {
    const k = dir[0] * wind[0] + dir[1] * wind[1] + dir[2] * wind[2];
    const t: V3 = [wind[0] - dir[0] * k, wind[1] - dir[1] * k, wind[2] - dir[2] * k];
    if (Math.hypot(...t) > 1e-4) return norm(t);
  }
  const t = cross(dir, [0, 0, 1]);
  return Math.hypot(...t) > 1e-4 ? norm(t) : [1, 0, 0];
}

/**
 * Clouds scattered over the whole shell round the planet (the ones round the far side come over the horizon as the shell
 * turns). The kind decides how many, how high and the shape of the puffs: cumulus heaps, flat stratus sheets, thin cirrus
 * streaks stretched along the wind, tall dark storm heads. `cover` scales the number (0 none, 1 the usual, up to 2). Seeded, so
 * the same every time; kinds share one seed so changing the kind keeps the clouds where they were.
 */
export function cloudLayout(cfg: PlanetCfg['clouds'], kind: CloudKind = 'cumulus', cover = 1, wind: V3 | null = null): CloudSpec[] {
  const t = cfg.types[kind];
  const total = Math.max(0, Math.round(cfg.count * t.countShare * cover));
  const out: CloudSpec[] = [];
  for (let i = 0; i < total; i++) {
    // Where a cloud is comes from its own number, so it stays put when the kind or the cover changes.
    const where = mulberry32(cfg.seed + i * 7919);
    const z = where() * 2 - 1, a = where() * Math.PI * 2, s = Math.sqrt(1 - z * z);
    const dir: V3 = [s * Math.cos(a), z, s * Math.sin(a)];
    const r = mulberry32(cfg.seed * 31 + i * 104729);
    const n = Math.round(t.puffs[0] + r() * (t.puffs[1] - t.puffs[0]));
    const base = t.puffFt[0] + r() * (t.puffFt[1] - t.puffFt[0]);
    const puffs = Array.from({ length: n }, (_, k) => {
      const u = k / Math.max(1, n - 1);
      // A long, low heap: puffs strung along the cloud with the biggest in the middle.
      const size = base * (0.55 + 0.6 * Math.sin(Math.PI * (0.15 + 0.7 * u)) + 0.15 * r());
      return {
        dx: (u - 0.5) * base * t.spread * n * 0.5 * t.stretch + (r() - 0.5) * base * 0.4,
        dy: (r() - 0.5) * base * t.spread * 0.9,
        dz: (r() - 0.35) * base * 0.35 * (t.flatten > 0.8 ? 3 : 1),
        size,
      };
    });
    out.push({ dir, altitudeFt: t.altitudeFt[0] + r() * (t.altitudeFt[1] - t.altitudeFt[0]), along: windAlong(dir, wind), puffs });
  }
  return out;
}

/** The wind as a unit vector in the planet's world (x east-ish, y up, z) given its horizontal direction in that world, or null for none. */
export const windVector = (dx: number, dz: number): V3 | null => (Math.hypot(dx, dz) > 1e-6 ? norm([dx, 0, dz]) : null);

/** One shooting star: where it starts on the sky (a unit direction), the direction it travels (a unit tangent), how fast and how long it lives, and how long its trail is. */
export interface Meteor {
  dir: V3;
  tangent: V3;
  speedDegPerS: number;
  lifeS: number;
  lengthDeg: number;
}

/** A shooting star somewhere in the upper sky, streaking mostly downward. `rng` gives numbers in [0, 1). */
export function spawnMeteor(rng: () => number, cfg: Pick<PlanetCfg['meteors'], 'minElevationDeg' | 'speedDegPerS' | 'lengthDeg' | 'lifeS'>): Meteor {
  const el = (cfg.minElevationDeg + rng() * (82 - cfg.minElevationDeg)) * (Math.PI / 180), az = rng() * Math.PI * 2;
  const dir: V3 = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
  // A random tangent at that point, turned to head downward.
  const a = rng() * Math.PI * 2;
  const east = norm(cross([0, 1, 0], dir)), north = cross(dir, east);
  let t = norm([east[0] * Math.cos(a) + north[0] * Math.sin(a), east[1] * Math.cos(a) + north[1] * Math.sin(a), east[2] * Math.cos(a) + north[2] * Math.sin(a)]);
  if (t[1] > 0) t = [-t[0], -t[1], -t[2]];
  const lerp = (r: [number, number]) => r[0] + rng() * (r[1] - r[0]);
  return { dir, tangent: t, speedDegPerS: lerp(cfg.speedDegPerS), lifeS: lerp(cfg.lifeS), lengthDeg: lerp(cfg.lengthDeg) };
}

/** Where a meteor's head and the end of its trail are `age` seconds after it appeared, and how bright it is (0 to 1, rising then falling); null once it is over. */
export function meteorFrame(m: Meteor, age: number): { head: V3; tail: V3; brightness: number } | null {
  if (age < 0 || age >= m.lifeS) return null;
  const at = (deg: number): V3 => {
    const p = (deg * Math.PI) / 180, c = Math.cos(p), s = Math.sin(p);
    return [m.dir[0] * c + m.tangent[0] * s, m.dir[1] * c + m.tangent[1] * s, m.dir[2] * c + m.tangent[2] * s];
  };
  const headDeg = m.speedDegPerS * age;
  const u = age / m.lifeS;
  return { head: at(headDeg), tail: at(Math.max(0, headDeg - m.lengthDeg)), brightness: Math.pow(Math.sin(Math.PI * u), 0.7) };
}

/** Seconds until the next meteor, for a steady rate in meteors a minute (a Poisson process: exponential gaps); infinite for none. */
export function meteorGapS(perMinute: number, rng: () => number): number {
  if (perMinute <= 0) return Infinity;
  return -Math.log(1 - Math.min(0.999999, rng())) * (60 / perMinute);
}

const hex = (c: string): V3 => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as V3;
const mix = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const toHex = (c: V3) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** Cloud color for the sun's elevation: white by day, warm at sunset, dark blue at night (the same breakpoints as the sky). */
export function cloudColor(sunElevationDeg: number, colors: PlanetCfg['clouds']['colors'], sky: { fullDayElevationDeg: number; duskElevationDeg: number; fullNightElevationDeg: number }): string {
  const day = hex(colors.day), dusk = hex(colors.dusk), night = hex(colors.night);
  if (sunElevationDeg >= sky.fullDayElevationDeg) return toHex(day);
  if (sunElevationDeg >= sky.duskElevationDeg) return toHex(mix(dusk, day, (sunElevationDeg - sky.duskElevationDeg) / (sky.fullDayElevationDeg - sky.duskElevationDeg)));
  if (sunElevationDeg > sky.fullNightElevationDeg) return toHex(mix(night, dusk, (sunElevationDeg - sky.fullNightElevationDeg) / (sky.duskElevationDeg - sky.fullNightElevationDeg)));
  return toHex(night);
}

/**
 * How many feet of air a ray passes through between the planet's surface and the top of its atmosphere: the part of the ray inside
 * the outer sphere less the part inside the planet (and nothing past the planet when the ray hits it). Pure, and the same
 * calculation the atmosphere shader makes, so the glow thins smoothly to nothing at the edge instead of ending at a hard line.
 * `origin` and `dir` (unit) are relative to the planet's middle.
 */
export function airPathFt(origin: V3, dir: V3, planetR: number, atmosphereR: number): number {
  const b = origin[0] * dir[0] + origin[1] * dir[1] + origin[2] * dir[2];
  const oo = origin[0] * origin[0] + origin[1] * origin[1] + origin[2] * origin[2];
  const chord = (r: number): [number, number] | null => {
    const disc = b * b - (oo - r * r);
    if (disc <= 0) return null;
    const s = Math.sqrt(disc);
    return [-b - s, -b + s];
  };
  const outer = chord(atmosphereR);
  if (!outer) return 0;
  const t0 = Math.max(0, outer[0]), t1 = outer[1];
  if (t1 <= t0) return 0;
  const inner = chord(planetR);
  // A ray that hits the planet stops there: only the air before the surface counts.
  if (inner && inner[1] > 0) return Math.max(0, Math.min(t1, Math.max(t0, inner[0])) - t0);
  return t1 - t0;
}

/** The share of the haze's opacity that a path of air gives: it thickens with the path and levels off. */
export const hazeShare = (pathFt: number, scaleFt: number): number => 1 - Math.exp(-Math.max(0, pathFt) / scaleFt);

/** What a viewer can adjust about the planet and its sky. A view setting: it is not part of a scenario. */
export interface SkySettings {
  cloudType: CloudKind;
  /** 0 (clear) to 2 (overcast); 1 is the usual amount. */
  cloudCover: number;
  windFtPerS: number;
  /** The compass bearing the wind blows from, in degrees. */
  windFromDeg: number;
  meteorsPerMin: number;
  planetRadiusFt: number;
}

export const defaultSkySettings = (cfg: PlanetCfg): SkySettings => ({
  cloudType: cfg.defaults.cloudType, cloudCover: cfg.defaults.cloudCover, windFtPerS: cfg.wind.defaultFtPerS, windFromDeg: cfg.wind.defaultFromDeg,
  meteorsPerMin: cfg.meteors.defaultPerMin, planetRadiusFt: cfg.radiusFt,
});

/** Settings from anything stored or typed, each kept in range and replaced by its default when it is not usable. */
export function sanitizeSky(raw: unknown, cfg: PlanetCfg): SkySettings {
  const d = defaultSkySettings(cfg);
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
  const kind = typeof o.cloudType === 'string' && o.cloudType in cfg.clouds.types ? (o.cloudType as CloudKind) : d.cloudType;
  return {
    cloudType: kind,
    cloudCover: num(o.cloudCover, 0, 2, d.cloudCover),
    windFtPerS: num(o.windFtPerS, 0, cfg.wind.maxFtPerS, d.windFtPerS),
    windFromDeg: ((num(o.windFromDeg, -1e6, 1e6, d.windFromDeg) % 360) + 360) % 360,
    meteorsPerMin: num(o.meteorsPerMin, 0, cfg.meteors.maxPerMin, d.meteorsPerMin),
    planetRadiusFt: num(o.planetRadiusFt, cfg.radiusRangeFt[0], cfg.radiusRangeFt[1], d.planetRadiusFt),
  };
}

/**
 * Where the compass rose lies on the ground and how it is turned: just beyond the lot on the north side (past its farthest
 * corner toward north), turned so that the top of the picture points north. All in site coordinates; `north` is a unit vector.
 */
export function compassMark(lot: { width: number; depth: number }, north: [number, number], marginFt: number): { x: number; y: number; angle: number; distanceFt: number } {
  const cx = lot.width / 2, cy = lot.depth / 2;
  let reach = 0;
  for (const [x, y] of [[0, 0], [lot.width, 0], [lot.width, lot.depth], [0, lot.depth]]) reach = Math.max(reach, (x - cx) * north[0] + (y - cy) * north[1]);
  const d = reach + marginFt;
  return { x: cx + north[0] * d, y: cy + north[1] * d, angle: Math.atan2(north[1], north[0]) - Math.PI / 2, distanceFt: d };
}
