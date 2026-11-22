import { expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import { skyColor } from '../src/engine/sky';
import type { EngineConfig } from '../src/engine/types';
const c = (engineRaw as unknown as EngineConfig).sky;
it('goes from day through a sunset glow to night', () => {
  expect(skyColor(40, c)).toBe(c.day);
  expect(skyColor(c.duskElevationDeg, c)).toBe(c.dusk);
  expect(skyColor(-30, c)).toBe(c.night);
  const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
  expect(lum(skyColor(-6, c))).toBeLessThan(lum(c.dusk));
  expect(lum(skyColor(-6, c))).toBeGreaterThan(lum(c.night));
});
