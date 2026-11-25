import { describe, expect, it } from 'vitest';
import engine from '../src/data/engine.json';
import { ageGroup, approach, fiveArm, greeting, headTurnToward, hourShare, lingerOptions, paceMultiplier, personalityOf, pickWeighted, weaveOffset } from '../src/engine/manner';
import { mulberry32 } from '../src/engine/shuffle';
import type { EngineConfig } from '../src/engine/types';

const cfg = (engine as unknown as EngineConfig).life.people.manner;

describe('personalities', () => {
  it('are repeatable for a seed and differ between people', () => {
    const a = personalityOf(mulberry32(5), cfg), b = personalityOf(mulberry32(5), cfg);
    expect(a).toEqual(b);
    const r = mulberry32(9);
    const cast = Array.from({ length: 8 }, () => personalityOf(r, cfg));
    expect(new Set(cast.map((p) => p.energy.toFixed(3))).size).toBe(8);
    for (const p of cast) {
      expect(p.weaveAmp).toBeGreaterThanOrEqual(cfg.weave.ampFt[0]);
      expect(p.weaveAmp).toBeLessThanOrEqual(cfg.weave.ampFt[1]);
    }
  });
  it('make a brisk walker faster than an easygoing one, and pace rise and fall over time', () => {
    const base = personalityOf(mulberry32(1), cfg);
    const slow = { ...base, energy: 0, phase: 0 }, fast = { ...base, energy: 1, phase: 0 };
    expect(paceMultiplier(fast, cfg, 600, 0)).toBeGreaterThan(paceMultiplier(slow, cfg, 600, 0));
    const seen = Array.from({ length: 60 }, (_, i) => paceMultiplier(slow, cfg, 600, i * 0.5));
    expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(0.1);
    for (const v of seen) expect(v).toBeGreaterThan(0.5), expect(v).toBeLessThan(1.5);
  });
  it('is livelier by day than at night', () => {
    expect(hourShare(cfg.pace.hours, 10 * 60)).toBeGreaterThan(hourShare(cfg.pace.hours, 2 * 60));
  });
});

describe('weaving', () => {
  it('stays within its amplitude and crosses the line', () => {
    const v = Array.from({ length: 200 }, (_, i) => weaveOffset(i * 0.2, 0.4, 10, 0.3));
    expect(Math.max(...v)).toBeLessThanOrEqual(0.4 + 1e-9);
    expect(Math.min(...v)).toBeLessThan(-0.3);
  });
});

describe('what to do when idle', () => {
  const who = { age: 30, energy: 0.5, curious: 0.5 };
  it('keeps phones from small children and spinning from adults', () => {
    const adult = lingerOptions(cfg, who, {}).map((o) => o.item);
    expect(adult).toContain('phone');
    expect(adult).not.toContain('spin');
    const kid = lingerOptions(cfg, { ...who, age: 7 }, {}).map((o) => o.item);
    expect(kid).toContain('spin');
    expect(kid).not.toContain('phone');
    expect(lingerOptions(cfg, { ...who, age: 3 }, {}).map((o) => o.item)).not.toContain('snack');
  });
  it('leaves out what the yard cannot offer, and favors a curious person looking and an easygoing one perching', () => {
    expect(lingerOptions(cfg, who, { perch: false, smell: false }).map((o) => o.item)).not.toContain('perch');
    const w = (o: ReturnType<typeof lingerOptions>, k: string) => o.find((x) => x.item === k)!.w;
    expect(w(lingerOptions(cfg, { ...who, curious: 1 }, {}), 'look')).toBeGreaterThan(w(lingerOptions(cfg, { ...who, curious: 0 }, {}), 'look'));
    expect(w(lingerOptions(cfg, { ...who, energy: 0 }, {}), 'perch')).toBeGreaterThan(w(lingerOptions(cfg, { ...who, energy: 1 }, {}), 'perch'));
  });
  it('picks by weight', () => {
    expect(pickWeighted([{ item: 'a', w: 0 }, { item: 'b', w: 3 }], 0.2)).toBe('b');
    expect(pickWeighted([{ item: 'a', w: 0 }], 0.5)).toBeNull();
    const r = mulberry32(2);
    let a = 0;
    for (let i = 0; i < 2000; i++) if (pickWeighted([{ item: 'a', w: 1 }, { item: 'b', w: 3 }], r()) === 'a') a++;
    expect(a / 2000).toBeGreaterThan(0.18), expect(a / 2000).toBeLessThan(0.32);
  });
});

describe('gaze', () => {
  it('turns the head toward a point but never past the limit, and not at all when it is dead ahead', () => {
    expect(headTurnToward(0, 0, 0, 10, 0, 1)).toBeCloseTo(0);
    expect(headTurnToward(0, 0, 0, 0, 10, 1.05)).toBeCloseTo(1.05);
    expect(headTurnToward(0, 0, 0, 0, -10, 1.05)).toBeCloseTo(-1.05);
    expect(headTurnToward(Math.PI * 1.9, 0, 0, 10, 0.01, 1)).toBeCloseTo(0.1 * Math.PI, 1); // wrapping around 2 pi
  });
  it('eases a value toward its target without overshooting', () => {
    expect(approach(0, 1, 2, 0.1)).toBeCloseTo(0.2);
    expect(approach(0.95, 1, 2, 0.1)).toBe(1);
    expect(approach(1, 0, 2, 0.1)).toBeCloseTo(0.8);
  });
});

describe('greetings', () => {
  it('offers high fives to kids most, teens next, adults least, and still hugs at the hug rate', () => {
    const tally = (a: number, b: number) => {
      const r = mulberry32(3);
      const t = { hug: 0, five: 0, talk: 0 };
      for (let i = 0; i < 6000; i++) t[greeting(cfg, 0.4, a, b, r())]++;
      return t;
    };
    const kids = tally(9, 9), teens = tally(15, 30), adults = tally(30, 40);
    expect(kids.five).toBeGreaterThan(teens.five);
    expect(teens.five).toBeGreaterThan(adults.five);
    expect(adults.five).toBeGreaterThan(0);
    for (const t of [kids, teens, adults]) expect(t.hug / 6000).toBeGreaterThan(0.36), expect(t.hug / 6000).toBeLessThan(0.44);
    expect(ageGroup(12)).toBe('kid'), expect(ageGroup(14)).toBe('teen'), expect(ageGroup(30)).toBe('adult');
  });
  it('raises the arm, holds it for contact, and lowers it', () => {
    expect(fiveArm(0, 1.5)).toBe(0);
    expect(fiveArm(0.75, 1.5)).toBe(1);
    expect(fiveArm(1.5, 1.5)).toBe(0);
    expect(fiveArm(0.2, 1.5)).toBeGreaterThan(0.3);
    expect(fiveArm(0.2, 1.5)).toBeLessThan(1);
  });
});
