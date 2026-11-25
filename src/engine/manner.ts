import type { MannerCfg } from './types';

/** What makes one person move and behave differently from another: three traits from 0 to 1, and how they weave as they walk. */
export interface Personality {
  /** Brisk and restless (high) or easygoing (low): sets pace and how often they linger. */
  energy: number;
  /** Likes company: greets, glances at others, smiles more. */
  social: number;
  /** Notices flowers, birds and plants. */
  curious: number;
  weaveAmp: number;
  weaveLen: number;
  /** Where in its cycle their pace drift starts. */
  phase: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A personality drawn from a random source, so a seeded sim gives the same cast every time. */
export function personalityOf(rng: () => number, cfg: MannerCfg): Personality {
  return {
    energy: rng(), social: rng(), curious: rng(),
    weaveAmp: lerp(cfg.weave.ampFt[0], cfg.weave.ampFt[1], rng()),
    weaveLen: lerp(cfg.weave.lenFt[0], cfg.weave.lenFt[1], rng()),
    phase: rng() * Math.PI * 2,
  };
}

export type AgeGroup = 'kid' | 'teen' | 'adult';
export const ageGroup = (age: number): AgeGroup => (age < 13 ? 'kid' : age < 18 ? 'teen' : 'adult');

/** How lively the hour is, 0 to 1ish, by linear blend between the listed [hour, share] points (hour of day 0 to 24). */
export function hourShare(hours: [number, number][], minutes: number): number {
  const h = (((minutes / 60) % 24) + 24) % 24;
  for (let i = 0; i < hours.length - 1; i++) {
    const [h0, v0] = hours[i], [h1, v1] = hours[i + 1];
    if (h >= h0 && h <= h1) return lerp(v0, v1, h1 === h0 ? 0 : (h - h0) / (h1 - h0));
  }
  return hours[hours.length - 1]?.[1] ?? 1;
}

/**
 * The multiplier on a person's own walking speed: energy sets a steady share (an easygoing walker is slower than a brisk one),
 * a slow drift makes the pace rise and fall, and the hour nudges it (`hourWeight`).
 */
export function paceMultiplier(p: Personality, cfg: MannerCfg, minutes: number, clockS: number): number {
  const steady = lerp(cfg.pace.energyMul[0], cfg.pace.energyMul[1], p.energy);
  const drift = 1 + cfg.pace.driftAmp * Math.sin(clockS * cfg.pace.driftRadS + p.phase);
  const hour = 1 - cfg.pace.hourWeight + cfg.pace.hourWeight * hourShare(cfg.pace.hours, minutes);
  return steady * drift * hour;
}

/** How far to the side of the straight line someone has wandered after walking `distanceFt`. */
export const weaveOffset = (distanceFt: number, amp: number, len: number, phase: number): number => amp * Math.sin((distanceFt / len) * Math.PI * 2 + phase);

/** Pick by weight with a random number in [0, 1); returns null when nothing has weight. */
export function pickWeighted<T>(items: { item: T; w: number }[], r: number): T | null {
  const total = items.reduce((t, i) => t + Math.max(0, i.w), 0);
  if (total <= 0) return null;
  let at = r * total;
  for (const { item, w } of items) {
    at -= Math.max(0, w);
    if (at <= 0) return item;
  }
  return items[items.length - 1].item;
}

export type LingerKind = 'look' | 'sky' | 'phone' | 'smell' | 'lean' | 'perch' | 'snack' | 'spin' | 'puppet';

/**
 * What an idle person might do, by weight: curious people look and smell flowers, easygoing ones sit and lean, kids spin,
 * and nothing is offered that the yard or the person's age rules out (`available`).
 */
export function lingerOptions(cfg: MannerCfg, who: { age: number; energy: number; curious: number }, available: Partial<Record<LingerKind, boolean>>): { item: LingerKind; w: number }[] {
  const L = cfg.linger;
  const out: { item: LingerKind; w: number }[] = [];
  for (const kind of Object.keys(L.weights) as LingerKind[]) {
    if (available[kind] === false) continue;
    let w = L.weights[kind];
    if (kind === 'phone' && who.age < L.phoneMinAge) continue;
    if (kind === 'snack' && who.age < L.snackMinAge) continue;
    if (kind === 'spin' && who.age > L.spinMaxAge) continue;
    if (kind === 'look' || kind === 'smell') w *= 0.5 + who.curious;
    if (kind === 'perch' || kind === 'lean' || kind === 'phone') w *= 1.5 - who.energy;
    if (kind === 'spin') w *= 0.5 + who.energy;
    out.push({ item: kind, w });
  }
  return out;
}

/** The head's turn from straight ahead toward a point, in radians, never past `maxTurn`. */
export function headTurnToward(heading: number, fromX: number, fromY: number, toX: number, toY: number, maxTurn: number): number {
  const diff = Math.atan2(Math.sin(Math.atan2(toY - fromY, toX - fromX) - heading), Math.cos(Math.atan2(toY - fromY, toX - fromX) - heading));
  return Math.max(-maxTurn, Math.min(maxTurn, diff));
}

/** Move a value toward a target at a rate (per second) without overshooting. */
export const approach = (cur: number, target: number, rate: number, dt: number): number => cur + Math.max(-rate * dt, Math.min(rate * dt, target - cur));

/** Which greeting opens a meeting: a hug, a high five (more likely for kids and teens), or just talking. Uses one random number. */
export function greeting(cfg: MannerCfg, hugChance: number, ageA: number, ageB: number, r: number): 'hug' | 'five' | 'talk' {
  if (r < hugChance) return 'hug';
  // The younger of the two sets the odds: a kid's high five is the likeliest to be offered, and taken.
  const g = ageGroup(Math.min(ageA, ageB));
  return r - hugChance < (1 - hugChance) * cfg.greet.highFive[g] ? 'five' : 'talk';
}

/** How raised the arm is through a high five, 0 to 1 over its `fiveS` seconds: up, a moment of contact, and down. */
export function fiveArm(t: number, total: number): number {
  const u = t / Math.max(0.1, total);
  if (u < 0.25) return u / 0.25;
  if (u < 0.65) return 1;
  if (u < 0.9) return 1 - (u - 0.65) / 0.25;
  return 0;
}
