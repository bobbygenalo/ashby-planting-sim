import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import { driftAngle, driftOffset } from '../src/engine/drift';
import { loadSite } from '../src/engine/site';

const site = loadSite(siteRaw);
const orbit = site.views.find((v) => v.id === 'orbit')!;

describe('the Orbit view circles the property', () => {
  it('is set up as a slow drift on the Orbit view only', () => {
    expect(orbit.drift).toBeDefined();
    expect(orbit.drift!.degPerSecond).toBeGreaterThan(0.5);
    expect(orbit.drift!.degPerSecond).toBeLessThan(5); // gentle: a full circle in well over a minute
    expect(orbit.drift!.resumeS).toBe(0); // it carries on as soon as the viewer lets go
    for (const v of site.views.filter((q) => q.id !== 'orbit')) expect(v.drift, v.id).toBeUndefined();
  });

  it('goes counter-clockwise seen from above with north (the rear of the lot) at the top, from where the Orbit camera starts', () => {
    // three.js ground coordinates: site (x, y) is (x, -z), so the camera's offset from the target is (dx, -dy_site)
    const [cx, cy] = orbit.position!, [tx, ty] = orbit.target!;
    let x = cx - tx, z = -(cy - ty);
    let angle = driftAngle(x, z);
    for (let i = 0; i < 20; i++) {
      const o = driftOffset(x, z, orbit.drift!.degPerSecond, 0.5);
      x = o.x; z = o.z;
      const next = driftAngle(x, z);
      const turned = Math.atan2(Math.sin(next - angle), Math.cos(next - angle));
      expect(turned, `step ${i}`).toBeGreaterThan(0); // the bearing grows: counter-clockwise
      angle = next;
    }
  });

  it('keeps the camera at the same distance and takes the same time to go round at any frame rate', () => {
    const start = { x: 80 - 25, z: -(-70 - 70) };
    const r = Math.hypot(start.x, start.z);
    let a = { ...start }, b = { ...start };
    const deg = 2.4;
    for (let i = 0; i < 60; i++) a = driftOffset(a.x, a.z, deg, 1 / 60); // one second at 60 frames a second
    for (let i = 0; i < 120; i++) b = driftOffset(b.x, b.z, deg, 1 / 120); // and at 120
    expect(Math.hypot(a.x, a.z)).toBeCloseTo(r, 9);
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.z).toBeCloseTo(b.z, 9);
    // 150 seconds for a whole turn at 2.4 degrees a second
    let c = { ...start };
    for (let i = 0; i < 150; i++) c = driftOffset(c.x, c.z, deg, 1);
    expect(c.x).toBeCloseTo(start.x, 6);
    expect(c.z).toBeCloseTo(start.z, 6);
  });

  it('is a layer the viewer can turn off, on to begin with', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return import('../src/store/store').then(({ makeAppStore }) => {
      const s = makeAppStore('edit');
      expect(s.getState().layers.drift).toBe(true);
      s.getState().setLayer('drift', false);
      expect(s.getState().layers.drift).toBe(false);
    });
  });
});
