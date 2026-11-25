import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import siteRaw from '../src/data/site.json';
import { interiorLight, outdoorLight, seedOf } from '../src/engine/interior';
import { solarPosition } from '../src/engine/solar';
import { loadSite } from '../src/engine/site';
import { localToUtc } from '../src/engine/time';
import type { EngineConfig } from '../src/engine/types';

const engine = engineRaw as unknown as EngineConfig;
const cfg = engine.interior;
const site = loadSite(siteRaw);
const sunAt = (month: number, day: number, minute: number) =>
  solarPosition(localToUtc(site.timeZone, engine.referenceYear, month, day, 0, minute), site.latitude, site.longitude, engine.sun.refraction).elevationDeg;
const evening = (month: number, day: number, seed: number) => {
  const out: number[] = [];
  for (let m = 12 * 60; m < 23 * 60; m += 10) out.push(interiorLight(sunAt(month, day, m), m, cfg, seed));
  return out;
};

describe('interior lights', () => {
  it('are off in full daylight and on once it is dark', () => {
    expect(interiorLight(60, 12 * 60, cfg, 0.5)).toBe(0);
    expect(interiorLight(20, 17 * 60, cfg, 0.5)).toBe(0);
    expect(interiorLight(-10, 21 * 60, cfg, 0.5)).toBe(1);
  });

  it('come on gradually as the sun gets low, never going backwards through the evening', () => {
    const e = evening(6, 21, 0.5);
    expect(e[0]).toBe(0);
    expect(e[e.length - 1]).toBe(1);
    for (let i = 1; i < e.length; i++) expect(e[i]).toBeGreaterThanOrEqual(e[i - 1] - 1e-9);
    // a ramp, not a switch: some steps in between
    expect(e.filter((v) => v > 0.05 && v < 0.95).length).toBeGreaterThan(3);
  });

  it('start a little earlier or later in each building, and keep their own order all year', () => {
    // a higher seed starts at a higher sun, so its lights come on earlier in the evening
    const lowSeed = 0.02, highSeed = 0.98;
    const firstOn = (seed: number) => evening(6, 21, seed).findIndex((v) => v > 0.02);
    expect(firstOn(highSeed)).toBeLessThan(firstOn(lowSeed));
    expect(seedOf('house')).not.toBe(seedOf('garage'));
    expect(seedOf('house')).toBe(seedOf('house'));
    const s = seedOf('adu');
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(1);
  });

  it('come on earlier in the day in winter, when the sun sets earlier', () => {
    const on = (month: number, day: number) => { const e = evening(month, day, 0.5); return 12 * 60 + 10 * e.findIndex((v) => v > 0.5); };
    expect(on(12, 21)).toBeLessThan(on(6, 21) - 120);
  });

  it('go out at bedtime and come back before dawn when the sun is still down', () => {
    expect(interiorLight(-30, cfg.sleepFromMin, cfg, 0.5)).toBe(0);
    expect(interiorLight(-30, 2 * 60, cfg, 0.5)).toBe(0);
    expect(interiorLight(-30, cfg.sleepFromMin - 1, cfg, 0.5)).toBe(1);
    expect(interiorLight(-30, cfg.sleepToMin, cfg, 0.5)).toBe(1); // up and about before sunrise in winter
    expect(interiorLight(-30, cfg.sleepToMin - 1, cfg, 0.5)).toBe(0);
  });
});
describe('outdoor lights', () => {
  it('are off by day, on once the sun is down, and stay on all night, even after the windows go dark', () => {
    expect(outdoorLight(40, cfg)).toBe(0);
    expect(outdoorLight(cfg.outdoorStartDeg + 1, cfg)).toBe(0);
    expect(outdoorLight(-10, cfg)).toBe(1);
    // the windows are out at 2 am, the round lights are not
    expect(interiorLight(-30, 2 * 60, cfg, 0.5)).toBe(0);
    expect(outdoorLight(-30, cfg)).toBe(1);
  });

  it('come on gradually through dusk, and not before the sun is low', () => {
    const e = [4, 3, 2, 1, 0, -1, -2, -3].map((deg) => outdoorLight(deg, cfg));
    for (let i = 1; i < e.length; i++) expect(e[i]).toBeGreaterThanOrEqual(e[i - 1]);
    expect(e.filter((v) => v > 0.02 && v < 0.98).length).toBeGreaterThan(2);
    expect(outdoorLight(cfg.outdoorStartDeg, cfg)).toBe(0);
    expect(outdoorLight(cfg.outdoorFullDeg, cfg)).toBe(1);
  });

  it('go on at about sunset, after the sun is lower than the first windows need', () => {
    expect(cfg.outdoorStartDeg).toBeLessThan(cfg.startDeg);
    expect(cfg.outdoorEmissive).toBeGreaterThan(cfg.emissive);
  });
});
