import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import type { EngineConfig } from '../src/engine/types';
import { BEE, beeGeometry } from '../src/scene/forms';
import * as THREE from 'three';

const engine = engineRaw as unknown as EngineConfig;

describe('the bee', () => {
  const g = beeGeometry();
  g.computeBoundingBox();
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');
  const hex = (i: number) => new THREE.Color(col.getX(i), col.getY(i), col.getZ(i)).getHexString();
  const [head, body, stripe] = [BEE.head, BEE.body, BEE.stripe].map((c) => new THREE.Color(c).getHexString());

  it('is a unit long, facing +X, and about half as wide', () => {
    const b = g.boundingBox!;
    expect(b.max.x - b.min.x).toBeCloseTo(1, 3);
    expect(b.max.y - b.min.y).toBeCloseTo(0.52, 3);
    expect(b.max.z - b.min.z).toBeCloseTo(0.52, 3);
  });

  it('is smaller than before: a small fraction of a foot long', () => {
    expect(engine.life.bees.displayFt).toBeLessThan(0.4);
    expect(engine.life.bees.displayFt).toBeGreaterThan(0.2);
  });

  it('has a dark head and thorax at the front, a yellow abdomen, and exactly two thin black stripes across it', () => {
    const colors = new Set<string>();
    const stripeBands: [number, number][] = [];
    let inBand = false, bandStart = 0, last = -Infinity;
    const rows = Array.from({ length: pos.count }, (_, i) => ({ x: pos.getX(i) + 0.5, color: hex(i) })).sort((a, b) => a.x - b.x);
    for (const r of rows) {
      colors.add(r.color);
      if (r.x >= 0.7) expect(r.color).toBe(head);
      if (r.x >= 0.06 && r.x < 0.7) {
        const dark = r.color === stripe;
        if (dark && !inBand) {
          inBand = true;
          bandStart = r.x;
        }
        if (!dark && inBand) {
          inBand = false;
          stripeBands.push([bandStart, last]);
        }
        last = r.x;
      }
    }
    expect([...colors].sort()).toEqual([head, body, stripe].sort());
    expect(stripeBands).toHaveLength(2);
    for (const [a, b] of stripeBands) {
      expect(b - a).toBeLessThan(0.14); // thin
      expect(b - a).toBeGreaterThan(0.03);
    }
    // yellow between and around the stripes
    expect(rows.filter((r) => r.x > 0.34 && r.x < 0.43).every((r) => r.color === body)).toBe(true);
    expect(rows.filter((r) => r.x > 0.53 && r.x < 0.69).every((r) => r.color === body)).toBe(true);
  });

  it('puts the stripes all the way around the body, not on one side', () => {
    const around = new Set<string>();
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getX(i) + 0.5;
      if (t > 0.26 && t < 0.32 && hex(i) === stripe) around.add(`${Math.sign(Math.round(pos.getY(i) * 20))}${Math.sign(Math.round(pos.getZ(i) * 20))}`);
    }
    expect(around.size).toBeGreaterThanOrEqual(4);
  });
});
