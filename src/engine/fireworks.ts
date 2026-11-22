import { mulberry32 } from './shuffle';
import type { FireworksCfg, Pt, Pt3 } from './types';

/** The Fourth of July (the configured date) at the given time: the display is on from 8 pm to 11 pm. */
export function fireworksDay(month: number, day: number, cfg: FireworksCfg): boolean {
  return month === cfg.month && day === cfg.day;
}
export function fireworksOn(month: number, day: number, minutes: number, cfg: FireworksCfg): boolean {
  return fireworksDay(month, day, cfg) && minutes >= cfg.startMin && minutes < cfg.endMin;
}

export interface Burst {
  /** Where the shell goes off, site feet. */
  pos: Pt3;
  radius: number;
  color: string;
  /** Seconds since it went off. */
  age: number;
  seed: number;
}

/** Where a spark is, relative to the burst's center, after `age` seconds: out along its own direction, slowing, and drooping. */
export function sparkOffset(b: Pick<Burst, 'radius' | 'seed'>, k: number, n: number, age: number, cfg: Pick<FireworksCfg, 'gravityFt' | 'lifeS'>): Pt3 {
  // Evenly spread directions on a sphere (a Fibonacci spiral), turned a little by the burst's seed.
  const golden = Math.PI * (3 - Math.sqrt(5));
  const z = 1 - (2 * (k + 0.5)) / n;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  const turn = (b.seed % 628) / 100;
  const th = k * golden + turn;
  // Fast at first, easing to a stop at the burst's full radius: 1 - (1 - t)^2.
  const t = Math.min(1, age / cfg.lifeS);
  const out = b.radius * (1 - (1 - t) * (1 - t));
  const speedJitter = 0.85 + 0.3 * (((k * 7919 + b.seed) % 100) / 100);
  return [Math.cos(th) * r * out * speedJitter, Math.sin(th) * r * out * speedJitter, z * out * speedJitter - 0.5 * cfg.gravityFt * age * age * 0.25];
}

/** How bright a burst is at an age, 0 to 1: it flares, holds, then fades out by the end of its life. */
export function burstBrightness(age: number, lifeS: number): number {
  if (age < 0 || age >= lifeS) return 0;
  const t = age / lifeS;
  return t < 0.08 ? t / 0.08 : Math.pow(1 - (t - 0.08) / 0.92, 1.4);
}

/** A running show: shells go off beyond the back of the lot at random gaps, each a different color and size. */
export class FireworkShow {
  bursts: Burst[] = [];
  private rng: () => number;
  private next = 0;
  constructor(private lot: { width: number; depth: number }, private cfg: FireworksCfg, seed = 1) {
    this.rng = mulberry32(seed);
  }
  private between(r: [number, number]) {
    return r[0] + (r[1] - r[0]) * this.rng();
  }
  /** Advance by `dt` seconds. Returns the bursts that went off during this step. */
  step(dt: number): Burst[] {
    const fresh: Burst[] = [];
    for (const b of this.bursts) b.age += dt;
    this.bursts = this.bursts.filter((b) => b.age < this.cfg.lifeS);
    this.next -= dt;
    while (this.next <= 0) {
      const c = this.cfg;
      const b: Burst = {
        pos: [this.lot.width / 2 + (this.rng() - 0.5) * c.spreadFt, this.lot.depth + this.between(c.distanceFt), this.between(c.heightFt)],
        radius: this.between(c.radiusFt),
        color: c.colors[Math.floor(this.rng() * c.colors.length)],
        age: -this.next,
        seed: Math.floor(this.rng() * 1e6),
      };
      this.bursts.push(b);
      fresh.push(b);
      this.next += this.between(c.burstEveryS);
    }
    return fresh;
  }
  reset() {
    this.bursts = [];
    this.next = 0;
  }
}

/** Open ground to watch from: the party yard's open cells, or failing that the back half of the lot, spread out. */
export function skyWatchSpots(cells: Pt[], gap: number, rng: () => number): Pt[] {
  const order = cells.map((c) => ({ c, r: rng() })).sort((a, b) => a.r - b.r).map((o) => o.c);
  const out: Pt[] = [];
  for (const c of order) if (out.every((o) => Math.hypot(o[0] - c[0], o[1] - c[1]) >= gap)) out.push(c);
  return out;
}
