import { describe, expect, it } from 'vitest';
import { applyDome } from '../src/scene/forms';

describe('dome form for spreading plants', () => {
  const r = 4, h = 7;
  const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));

  it('puts the top of the hemisphere straight up at the plant height', () => {
    close(applyDome([0, 1, 0], r, h), [0, 0, h]);
  });

  it('spreads the rim flat on the ground at the plant radius, in both directions', () => {
    close(applyDome([1, 0, 0], r, h), [r, 0, 0]);
    close(applyDome([-1, 0, 0], r, h), [-r, 0, 0]);
    close(applyDome([0, 0, 1], r, h), [0, -r, 0]);
    close(applyDome([0, 0, -1], r, h), [0, r, 0]);
  });

  it('never dips below the ground, so the dome is seen from every side', () => {
    // The unit hemisphere has y >= 0; every point must land at or above z = 0.
    for (let a = 0; a < 24; a++) for (let b = 0; b <= 6; b++) {
      const theta = (b / 6) * (Math.PI / 2), phi = (a / 24) * Math.PI * 2;
      const p: [number, number, number] = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
      expect(applyDome(p, r, h)[2]).toBeGreaterThanOrEqual(-1e-9);
    }
  });
});
