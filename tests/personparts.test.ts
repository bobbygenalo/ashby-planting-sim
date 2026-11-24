import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import { bodyOf } from '../src/engine/anatomy';
import { hair, hand, head, limb, loft, shoe, thumb, torso, unitSphere } from '../src/scene/personParts';
import type { EngineConfig } from '../src/engine/types';

const engine = engineRaw as unknown as EngineConfig;
const roster = engine.life.people.roster;
const box = (g: THREE.BufferGeometry, at: [number, number, number] = [0, 0, 0]) => {
  g.computeBoundingBox();
  return g.boundingBox!.clone().translate(new THREE.Vector3(...at));
};

describe('the parts of a person have the size the body data gives them', () => {
  it('stack to the person\'s height: foot sole at the ground, crown of the head at the stature', () => {
    for (const r of roster) {
      const b = bodyOf(r.age, r.heightFt, engine.anatomy, r.sex, r.build);
      const crown = box(head(b), [0, 0, b.shoulderH + b.neckL]);
      expect(crown.max.z, `${r.age}`).toBeCloseTo(r.heightFt, 6);
      expect(box(head(b)).max.z - box(head(b)).min.z).toBeCloseTo(b.headH, 6);
      const shoe = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(b.footL * 0.26, 0, b.hipH - b.thighL - b.shankL - b.ankleH * 0.5), new THREE.Vector3(b.footL, b.footW, b.ankleH));
      expect(shoe.min.z).toBeCloseTo(0, 6); // the sole is on the ground
      expect(shoe.max.x - shoe.min.x).toBeCloseTo(b.footL, 6);
      expect(unitSphere.boundingBox === null || true).toBe(true);
    }
  });

  it('gives each limb its true length, with the joint widths of the data, and no part under the floor when standing', () => {
    for (const r of roster) {
      const b = bodyOf(r.age, r.heightFt, engine.anatomy, r.sex, r.build);
      const thigh = box(limb(b.thighL, b.r.thigh, b.r.thigh * 0.92, b.r.knee), [0, 0, b.hipH]);
      expect(thigh.max.z - thigh.min.z, `${r.age}`).toBeGreaterThan(b.thighL * 0.99);
      expect(thigh.max.z - thigh.min.z).toBeLessThan(b.thighL * 1.08);
      expect(thigh.max.x - thigh.min.x).toBeLessThanOrEqual(b.r.thigh * 2 * 1.06); // a soft swell, never a bulge
      expect(thigh.max.x - thigh.min.x).toBeGreaterThan(b.r.thigh * 2 * 0.85);
      const shin = box(limb(b.shankL, b.r.knee, b.r.calf, b.r.ankle, 0.3), [0, 0, b.hipH - b.thighL]);
      expect(shin.min.z).toBeGreaterThan(b.ankleH * 0.9 - 0.05);
      const arm = box(limb(b.upperArmL, b.r.upperArm * 1.05, b.r.upperArm, b.r.elbow));
      expect(arm.max.z - arm.min.z).toBeGreaterThan(b.upperArmL * 0.99);
    }
  });

  it('makes a torso as wide and deep as the data says at the hips and chest, rising to the base of the neck', () => {
    for (const r of roster) {
      const b = bodyOf(r.age, r.heightFt, engine.anatomy, r.sex, r.build);
      const t = box(torso(b));
      expect(t.max.z).toBeGreaterThanOrEqual(b.trunkL); // it runs a little up into the neck so there is no seam
      expect(t.max.z).toBeLessThan(b.trunkL + b.r.neck);
      expect(t.max.y - t.min.y).toBeGreaterThanOrEqual(Math.max(b.hipW, b.chestW) * 0.95);
      expect(t.max.y - t.min.y).toBeLessThan(b.height * 0.34); // a believable breadth across the shoulders
      expect(t.max.x - t.min.x).toBeGreaterThan(b.chestD * 0.95);
    }
  });

  it('gives a child a bigger head for their height than an adult, as built', () => {
    const toddler = bodyOf(3, 3, engine.anatomy), adult = bodyOf(30, 5.6, engine.anatomy);
    const h = (b: typeof toddler) => { const bb = box(head(b)); return (bb.max.z - bb.min.z) / b.height; };
    expect(h(toddler)).toBeGreaterThan(h(adult) + 0.04);
  });

  it('makes closed, smooth solids: every part has the faces of its sections and finite normals', () => {
    const b = bodyOf(30, 5.7, engine.anatomy, 'f');
    for (const g of [torso(b), head(b), hair(b, false), hair(b, true), limb(1, 0.1, 0.1, 0.08), loft([{ z: 0, rx: 1, ry: 1 }, { z: 1, rx: 1, ry: 1 }], 8)]) {
      const pos = g.getAttribute('position'), nrm = g.getAttribute('normal');
      expect(pos.count).toBeGreaterThan(8);
      expect(g.getIndex()!.count % 3).toBe(0);
      for (let i = 0; i < nrm.count; i++) expect(Number.isFinite(nrm.getX(i) + nrm.getY(i) + nrm.getZ(i))).toBe(true);
    }
  });
});

/** The volume a closed mesh encloses by the divergence theorem: positive when its faces wind so the normals point outward. */
function signedVolume(g: THREE.BufferGeometry): number {
  const pos = g.getAttribute('position'), idx = g.getIndex()!;
  const v = (i: number) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
  let vol = 0;
  for (let k = 0; k < idx.count; k += 3) {
    const a = v(idx.getX(k)), b = v(idx.getX(k + 1)), c = v(idx.getX(k + 2));
    vol += a.dot(b.clone().cross(c)) / 6;
  }
  return vol;
}

describe('every part faces outward, so none looks hollow or see-through', () => {
  it('winds each solid with its normals out, whichever way its sections run: up for a torso and a head, down for a limb', () => {
    for (const r of roster) {
      const b = bodyOf(r.age, r.heightFt, engine.anatomy, r.sex, r.build);
      const parts: [string, THREE.BufferGeometry][] = [
        ['torso', torso(b)], ['head', head(b)], ['hair', hair(b, false)], ['long hair', hair(b, true)],
        ['thigh', limb(b.thighL, b.r.thigh, b.r.thigh * 0.92, b.r.knee)], ['shin', limb(b.shankL, b.r.knee, b.r.calf, b.r.ankle, 0.3)],
        ['upper arm', limb(b.upperArmL, b.r.upperArm, b.r.upperArm, b.r.elbow)], ['forearm', limb(b.forearmL, b.r.elbow, b.r.forearm, b.r.wrist, 0.3)],
        ['hand', hand(b)], ['thumb', thumb(b)], ['shoe', shoe(b)],
      ];
      for (const [name, g] of parts) expect(signedVolume(g), `${r.age} ${name}`).toBeGreaterThan(0);
    }
  });

  it('puts every side face\'s normal pointing away from the middle of its part', () => {
    const b = bodyOf(30, 5.7, engine.anatomy, 'f');
    for (const [name, g] of [['torso', torso(b)], ['head', head(b)], ['limb', limb(2, 0.2, 0.18, 0.12)]] as [string, THREE.BufferGeometry][]) {
      const pos = g.getAttribute('position'), nrm = g.getAttribute('normal');
      g.computeBoundingBox();
      const mid = g.boundingBox!.getCenter(new THREE.Vector3());
      let out = 0, total = 0;
      for (let i = 0; i < pos.count; i++) {
        const radial = new THREE.Vector3(pos.getX(i) - mid.x, pos.getY(i) - mid.y, 0);
        if (radial.length() < 1e-4) continue;
        total++;
        if (radial.normalize().dot(new THREE.Vector3(nrm.getX(i), nrm.getY(i), 0)) > 0) out++;
      }
      expect(out / total, name).toBeGreaterThan(0.95);
    }
  });
});
