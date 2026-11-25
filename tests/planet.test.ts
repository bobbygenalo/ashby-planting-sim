import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import siteRaw from '../src/data/site.json';
import { airPathFt, cloudColor, cloudLayout, compassMark, defaultSkySettings, groundDropFt, hazeShare, meteorFrame, meteorGapS, patchNoise, planetProfile, sanitizeSky, spawnMeteor, starDirections, starVisibility, windAlong, windVector } from '../src/engine/planet';
import { mulberry32 } from '../src/engine/shuffle';
import type { CloudKind, EngineConfig } from '../src/engine/types';

const cfg = (engineRaw as unknown as EngineConfig).planet;
const engine = engineRaw as unknown as EngineConfig;
const lot = (siteRaw as { lot: { width: number; depth: number } }).lot;

describe('the planet under the lot', () => {
  const prof = planetProfile(cfg);
  it('is flat under the whole lot: every corner is on the plateau', () => {
    const corner = Math.hypot(lot.width / 2, lot.depth / 2);
    expect(corner).toBeLessThan(cfg.plateauFt);
    // the top of the profile, before it curves away: flat at zero out to the plateau's edge
    const top = prof.slice(0, prof.findIndex(([r]) => r > cfg.plateauFt));
    expect(top.length).toBeGreaterThan(2);
    for (const [r, z] of top) { expect(r).toBeLessThanOrEqual(cfg.plateauFt); expect(z).toBe(0); }
  });

  it('rolls over smoothly into a sphere of the planet radius, tangent at the plateau edge', () => {
    const centre = [cfg.plateauFt, -cfg.radiusFt];
    for (const [r, z] of prof) {
      if (r < cfg.plateauFt - 1e-9 || z > 1e-9 || r > cfg.plateauFt + cfg.radiusFt + 1e-6) continue;
      if (z < -2 * cfg.radiusFt + 1e-6) continue;
      // points on the arc are the radius from its centre
      if (r > cfg.plateauFt + 1e-6) expect(Math.hypot(r - centre[0], z - centre[1])).toBeCloseTo(cfg.radiusFt, 3);
    }
    // the first curved ring leaves the plateau almost horizontally
    const after = prof.find(([r]) => r > cfg.plateauFt + 1e-6)!;
    expect(Math.abs(after[1]) / (after[0] - cfg.plateauFt)).toBeLessThan(0.1);
  });

  it('goes right round the far side and is shut at the bottom', () => {
    const lowest = Math.min(...prof.map(([, z]) => z));
    expect(lowest).toBeCloseTo(-2 * cfg.radiusFt, 3);
    expect(prof[prof.length - 1][0]).toBe(0);
    expect(Math.abs(Math.max(...prof.map(([r]) => r)) - (cfg.plateauFt + cfg.radiusFt))).toBeLessThan(0.5); // the widest ring, at the equator, to within a ring's spacing
  });

  it('drops away with distance the way a sphere does, and not at all over the plateau', () => {
    expect(groundDropFt(cfg.plateauFt, cfg)).toBe(0);
    expect(groundDropFt(10, cfg)).toBe(0);
    const d1 = groundDropFt(cfg.plateauFt + 100, cfg), d2 = groundDropFt(cfg.plateauFt + 200, cfg);
    expect(d1).toBeGreaterThan(5);
    expect(d2).toBeGreaterThan(d1 * 3.5); // about quadratic
    expect(groundDropFt(cfg.plateauFt + cfg.radiusFt, cfg)).toBeCloseTo(cfg.radiusFt);
  });

  it('has patchy ground colors in range and repeatable', () => {
    for (let i = 0; i < 200; i++) {
      const v = patchNoise(i * 13.7, i * 5.1, cfg.patchFt);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(patchNoise(30, 40, cfg.patchFt)).toBe(patchNoise(30, 40, cfg.patchFt));
    const seen = new Set(Array.from({ length: 100 }, (_, i) => patchNoise(i * 40, i * 17, cfg.patchFt).toFixed(2)));
    expect(seen.size).toBeGreaterThan(20);
  });
});

describe('stars', () => {
  it('are unit directions all over the sky, the same every time', () => {
    const a = starDirections(cfg.stars.count, cfg.stars.seed), b = starDirections(cfg.stars.count, cfg.stars.seed);
    expect(a).toEqual(b);
    expect(a).toHaveLength(cfg.stars.count);
    for (const d of a) expect(Math.hypot(...d)).toBeCloseTo(1, 6);
    const up = a.filter((d) => d[1] > 0).length / a.length;
    expect(up).toBeGreaterThan(0.45);
    expect(up).toBeLessThan(0.55);
  });
  it('are out at night, gone by day, and fade in between', () => {
    expect(starVisibility(30, cfg.stars)).toBe(0);
    expect(starVisibility(cfg.stars.fadeEndDeg, cfg.stars)).toBe(0);
    expect(starVisibility(cfg.stars.fullDeg, cfg.stars)).toBe(1);
    expect(starVisibility(-40, cfg.stars)).toBe(1);
    const mid = starVisibility((cfg.stars.fullDeg + cfg.stars.fadeEndDeg) / 2, cfg.stars);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    let last = 1;
    for (let e = cfg.stars.fullDeg; e <= 5; e += 0.5) { const v = starVisibility(e, cfg.stars); expect(v).toBeLessThanOrEqual(last + 1e-9); last = v; }
  });
});

describe('clouds', () => {
  const kinds = Object.keys(cfg.clouds.types) as CloudKind[];
  const clouds = cloudLayout(cfg.clouds);
  it('are the same every time, at the configured count, altitude and size, for every kind', () => {
    expect(cloudLayout(cfg.clouds)).toEqual(clouds);
    for (const k of kinds) {
      const t = cfg.clouds.types[k], list = cloudLayout(cfg.clouds, k, 1);
      expect(cloudLayout(cfg.clouds, k, 1), k).toEqual(list);
      expect(list, k).toHaveLength(Math.round(cfg.clouds.count * t.countShare));
      for (const c of list) {
        expect(Math.hypot(...c.dir)).toBeCloseTo(1, 6);
        expect(c.altitudeFt, k).toBeGreaterThanOrEqual(t.altitudeFt[0]);
        expect(c.altitudeFt, k).toBeLessThanOrEqual(t.altitudeFt[1]);
        expect(c.puffs.length, k).toBeGreaterThanOrEqual(t.puffs[0]);
        expect(c.puffs.length, k).toBeLessThanOrEqual(t.puffs[1]);
        expect(Math.hypot(...c.along), k).toBeCloseTo(1, 6);
        expect(Math.abs(c.along[0] * c.dir[0] + c.along[1] * c.dir[1] + c.along[2] * c.dir[2]), k).toBeLessThan(1e-6); // lies along the ground
      }
    }
  });
  it('differ by kind: cirrus high and thin, stratus low and wide, storm heads dark and tall, cumulus in between', () => {
    const t = cfg.clouds.types;
    expect(t.cirrus.altitudeFt[0]).toBeGreaterThan(t.cumulus.altitudeFt[1]);
    expect(t.stratus.altitudeFt[1]).toBeLessThanOrEqual(t.cumulus.altitudeFt[0] + 30);
    expect(t.cirrus.stretch).toBeGreaterThan(t.cumulus.stretch * 3);
    expect(t.cirrus.flatten).toBeLessThan(t.stratus.flatten);
    expect(t.stratus.flatten).toBeLessThan(t.cumulus.flatten);
    expect(t.storm.flatten).toBeGreaterThan(t.cumulus.flatten);
    expect(t.storm.shade).toBeLessThan(t.cumulus.shade);
    expect(t.cirrus.opacity).toBeLessThan(1);
    expect(t.stratus.puffFt[0]).toBeGreaterThan(t.cumulus.puffFt[1] * 0.9); // sheets are wide
  });
  it('are as many as the cover says: none when clear, more when overcast', () => {
    expect(cloudLayout(cfg.clouds, 'cumulus', 0)).toHaveLength(0);
    const some = cloudLayout(cfg.clouds, 'cumulus', 0.5).length, usual = cloudLayout(cfg.clouds, 'cumulus', 1).length, many = cloudLayout(cfg.clouds, 'cumulus', 2).length;
    expect(some).toBeLessThan(usual);
    expect(many).toBeGreaterThan(usual * 1.8);
  });
  it('keep their places when the kind changes (one seed), so changing the type does not shuffle the sky', () => {
    const a = cloudLayout(cfg.clouds, 'cumulus', 1), b = cloudLayout(cfg.clouds, 'stratus', 1);
    for (let i = 0; i < Math.min(a.length, b.length); i++) expect(b[i].dir).toEqual(a[i].dir);
  });
  it('lie along the wind, wherever they are, and streak along it', () => {
    const wind = windVector(1, 0)!; // blowing toward +x
    for (const c of cloudLayout(cfg.clouds, 'cirrus', 1, wind)) {
      const k = c.along[0] * wind[0];
      // the tangent keeps the wind's direction as far as the curve of the shell allows: never against it
      expect(k).toBeGreaterThanOrEqual(-1e-6);
    }
    expect(windVector(0, 0)).toBeNull();
    expect(Math.hypot(...windVector(3, 4)!)).toBeCloseTo(1, 6);
    const w = windAlong([0, 1, 0], [1, 0, 0]); // at the top of the shell the tangent is the wind itself
    expect(w[0]).toBeCloseTo(1, 6);
  });
  it('cover the whole shell, so some are always over the lot and others come over the horizon', () => {
    const overhead = clouds.filter((c) => c.dir[1] > 0.5).length;
    expect(overhead).toBeGreaterThan(3);
    expect(clouds.some((c) => c.dir[1] < -0.5)).toBe(true);
  });
  it('are white by day, warm at sunset and dark blue at night', () => {
    const day = cloudColor(40, cfg.clouds.colors, engine.sky), dusk = cloudColor(engine.sky.duskElevationDeg, cfg.clouds.colors, engine.sky), night = cloudColor(-30, cfg.clouds.colors, engine.sky);
    expect(day).toBe('#ffffff');
    expect(night).toBe(cfg.clouds.colors.night);
    expect(dusk).toBe(cfg.clouds.colors.dusk);
    const r = (h: string) => parseInt(h.slice(1, 3), 16), b = (h: string) => parseInt(h.slice(5, 7), 16);
    expect(r(dusk)).toBeGreaterThan(b(dusk)); // warm
    expect(b(night)).toBeGreaterThan(r(night)); // cool
  });
});

describe('meteors', () => {
  const rng = (seed: number) => mulberry32(seed);
  it('start in the upper sky and streak downward along the sky, as unit directions', () => {
    const r = rng(5);
    for (let i = 0; i < 300; i++) {
      const m = spawnMeteor(r, cfg.meteors);
      expect(Math.hypot(...m.dir)).toBeCloseTo(1, 6);
      expect(Math.hypot(...m.tangent)).toBeCloseTo(1, 6);
      expect(m.dir[0] * m.tangent[0] + m.dir[1] * m.tangent[1] + m.dir[2] * m.tangent[2]).toBeCloseTo(0, 6);
      expect(Math.asin(m.dir[1]) * (180 / Math.PI)).toBeGreaterThanOrEqual(cfg.meteors.minElevationDeg - 1e-6);
      expect(m.tangent[1]).toBeLessThanOrEqual(1e-9);
      expect(m.speedDegPerS).toBeGreaterThanOrEqual(cfg.meteors.speedDegPerS[0]);
      expect(m.speedDegPerS).toBeLessThanOrEqual(cfg.meteors.speedDegPerS[1]);
      expect(m.lifeS).toBeLessThanOrEqual(cfg.meteors.lifeS[1]);
    }
  });
  it('flare and fade: dark at the start and end of their life, brightest in the middle, gone after', () => {
    const m = spawnMeteor(rng(2), cfg.meteors);
    expect(meteorFrame(m, 0)!.brightness).toBeCloseTo(0, 3);
    const mid = meteorFrame(m, m.lifeS / 2)!;
    expect(mid.brightness).toBeCloseTo(1, 3);
    expect(meteorFrame(m, m.lifeS * 0.99)!.brightness).toBeLessThan(0.2);
    expect(meteorFrame(m, m.lifeS)).toBeNull();
    expect(meteorFrame(m, -1)).toBeNull();
  });
  it('move along the sky at their speed with a trail of their length behind the head, always on the sphere', () => {
    const m = spawnMeteor(rng(9), cfg.meteors);
    const age = m.lifeS * 0.7;
    const f = meteorFrame(m, age)!;
    expect(Math.hypot(...f.head)).toBeCloseTo(1, 6);
    expect(Math.hypot(...f.tail)).toBeCloseTo(1, 6);
    const ang = (a: number[], b: number[]) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * (180 / Math.PI);
    expect(ang(m.dir, f.head)).toBeCloseTo(m.speedDegPerS * age, 3);
    expect(ang(f.tail, f.head)).toBeCloseTo(Math.min(m.lengthDeg, m.speedDegPerS * age), 3);
  });
  it('arrive at the rate asked for, at random: a steady stream with exponential gaps', () => {
    for (const perMin of [1, 6, 30]) {
      const r = rng(11);
      let t = 0, n = 0;
      while (t < 36000) { t += meteorGapS(perMin, r); n++; }
      // ten hours of nights: the rate asked for, within chance
      expect(n / 600).toBeGreaterThan(perMin * 0.88);
      expect(n / 600).toBeLessThan(perMin * 1.12);
    }
    expect(meteorGapS(0, rng(1))).toBe(Infinity);
    const gaps = Array.from({ length: 200 }, () => meteorGapS(6, rng(Math.random() * 1e6)));
    expect(new Set(gaps.map((g) => g.toFixed(3))).size).toBeGreaterThan(150);
  });
});

describe('the sky settings', () => {
  it('start at the configured defaults', () => {
    const d = defaultSkySettings(cfg);
    expect(d.cloudType).toBe(cfg.defaults.cloudType);
    expect(d.windFtPerS).toBe(cfg.wind.defaultFtPerS);
    expect(d.meteorsPerMin).toBe(cfg.meteors.defaultPerMin);
    expect(d.planetRadiusFt).toBe(cfg.radiusFt);
    expect(sanitizeSky(null, cfg)).toEqual(d);
  });
  it('are kept in range and a bad value falls back to its default', () => {
    const s = sanitizeSky({ cloudType: 'plasma', cloudCover: 9, windFtPerS: -4, windFromDeg: 725, meteorsPerMin: 1e9, planetRadiusFt: 5 }, cfg);
    expect(s.cloudType).toBe(cfg.defaults.cloudType);
    expect(s.cloudCover).toBe(2);
    expect(s.windFtPerS).toBe(0);
    expect(s.windFromDeg).toBe(5);
    expect(s.meteorsPerMin).toBe(cfg.meteors.maxPerMin);
    expect(s.planetRadiusFt).toBe(cfg.radiusRangeFt[0]);
    const ok = sanitizeSky({ cloudType: 'cirrus', cloudCover: 0.5, windFtPerS: 12, windFromDeg: -90, meteorsPerMin: 8, planetRadiusFt: 900 }, cfg);
    expect(ok).toEqual({ cloudType: 'cirrus', cloudCover: 0.5, windFtPerS: 12, windFromDeg: 270, meteorsPerMin: 8, planetRadiusFt: 900 });
    expect(sanitizeSky('junk', cfg)).toEqual(defaultSkySettings(cfg));
  });
});

describe('the haze of air round the planet', () => {
  const R = cfg.radiusFt, A = R + cfg.atmosphere.thicknessFt;
  it('is zero for a ray that misses the atmosphere, and the shell depth straight up from the surface', () => {
    expect(airPathFt([0, R + 5000, 0], [0, 1, 0], R, A)).toBe(0);
    expect(airPathFt([0, R, 0], [0, 1, 0], R, A)).toBeCloseTo(cfg.atmosphere.thicknessFt, 6);
    expect(airPathFt([0, R + 20, 0], [0, 1, 0], R, A)).toBeCloseTo(cfg.atmosphere.thicknessFt - 20, 6);
  });
  it('is longest along the limb and falls smoothly to nothing past it, with no jump (no hard edge)', () => {
    // seen from far away, looking at the planet with the ray's closest approach swept from inside the planet to outside the air
    const origin: [number, number, number] = [0, 0, 3000];
    const lens: number[] = [];
    for (let h = 0; h <= A + 50; h += 1) {
      const dirLen = Math.hypot(h, 3000);
      lens.push(airPathFt(origin, [-h / dirLen * -1, 0, -3000 / dirLen].map((v, i) => (i === 0 ? v : v)) as [number, number, number], R, A));
    }
    expect(lens[lens.length - 1]).toBe(0);
    const peak = Math.max(...lens);
    expect(peak).toBeGreaterThan(cfg.atmosphere.thicknessFt);
    let biggestJump = 0;
    for (let i = 1; i < lens.length; i++) biggestJump = Math.max(biggestJump, Math.abs(lens[i] - lens[i - 1]));
    // on the way out past the limb the path shrinks gradually (a square-root curve, so a few feet a step), never off a cliff
    const past = lens.slice(lens.indexOf(peak));
    for (let i = 1; i < past.length; i++) expect(past[i - 1] - past[i]).toBeLessThan(peak * 0.2);
    expect(hazeShare(0, cfg.atmosphere.scaleFt)).toBe(0);
    expect(hazeShare(peak, cfg.atmosphere.scaleFt)).toBeLessThan(1);
    expect(hazeShare(2 * peak, cfg.atmosphere.scaleFt)).toBeGreaterThan(hazeShare(peak, cfg.atmosphere.scaleFt));
  });
  it('stops at the ground for a ray that hits the planet, so air behind the planet never counts', () => {
    const toGround = airPathFt([0, R + 10, 0], [0, -1, 0], R, A);
    expect(toGround).toBeCloseTo(10, 6);
  });
});

describe('the compass rose on the ground', () => {
  const lotSize = { width: 44, depth: 150 };
  it('lies just beyond the lot toward north, clear of every corner, and is turned to point north', () => {
    for (const bearing of [0, 37, 90, 180, 250]) {
      const r = (bearing * Math.PI) / 180;
      const north: [number, number] = [Math.sin(r), Math.cos(r)];
      const m = compassMark(lotSize, north, 18);
      // beyond the lot: farther toward north than any corner by the margin
      const corners = [[0, 0], [44, 0], [44, 150], [0, 150]];
      const mine = (m.x - 22) * north[0] + (m.y - 75) * north[1];
      for (const [x, y] of corners) expect(mine).toBeGreaterThanOrEqual((x - 22) * north[0] + (y - 75) * north[1] + 17.9);
      // the top of the picture (its +y turned by `angle`) points along north
      const up = [-Math.sin(m.angle), Math.cos(m.angle)];
      expect(up[0]).toBeCloseTo(north[0], 6);
      expect(up[1]).toBeCloseTo(north[1], 6);
    }
  });
  it('is on the flat part of the planet for the actual lot', () => {
    const site = siteRaw as unknown as { lot: { width: number; depth: number }; rearBearingDeg: number };
    const m = compassMark(site.lot, [0, 1], 18);
    expect(Math.hypot(m.x - site.lot.width / 2, m.y - site.lot.depth / 2)).toBeLessThan(cfg.plateauFt + 40);
  });
});
