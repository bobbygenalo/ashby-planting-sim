import { describe, expect, it } from 'vitest';
import engineRaw from '../src/data/engine.json';
import { armIK, bodyOf, fingertipFt, legDropFt, legLengthFt, reachUpFt, sitPose, standingHipFt, stepLengthFt, swingRad } from '../src/engine/anatomy';
import type { EngineConfig } from '../src/engine/types';

const engine = engineRaw as unknown as EngineConfig;
const cfg = engine.anatomy;
const roster = engine.life.people.roster;
const bodyFor = (r: (typeof roster)[number]) => bodyOf(r.age, r.heightFt, cfg, r.sex, r.build);

describe('every person is built from their height', () => {
  it('adds up to the stature: legs, trunk, neck and head stack to the top of the head, and the ankle is below the foot', () => {
    for (const r of roster) {
      const b = bodyFor(r);
      expect(b.hipH + b.trunkL + b.neckL + b.headH, `${r.age} ${r.heightFt}`).toBeCloseTo(r.heightFt, 9);
      expect(b.thighL + b.shankL + b.ankleH).toBeCloseTo(b.hipH, 9);
      expect(b.height).toBe(r.heightFt);
    }
  });

  it('puts an adult near the textbook proportions: eyes at about 0.936 of height, head about an eighth, reach overhead about 1.26, fingertips near mid-thigh', () => {
    for (const r of roster.filter((q) => q.age >= 18)) {
      const b = bodyFor(r);
      expect(b.eyeH / b.height).toBeGreaterThan(0.925);
      expect(b.eyeH / b.height).toBeLessThan(0.945);
      expect(b.headH / b.height).toBeGreaterThan(0.125);
      expect(b.headH / b.height).toBeLessThan(0.14);
      expect(reachUpFt(b) / b.height).toBeGreaterThan(1.22);
      expect(reachUpFt(b) / b.height).toBeLessThan(1.3);
      expect(fingertipFt(b)).toBeGreaterThan(b.hipH * 0.55);
      expect(fingertipFt(b)).toBeLessThan(b.hipH * 0.85);
      expect(b.thighL / b.height).toBeGreaterThan(0.23);
      expect(b.thighL / b.height).toBeLessThan(0.26);
    }
  });

  it('gives children bigger heads and shorter legs for their height, by age', () => {
    const at = (age: number) => bodyOf(age, 5, cfg);
    for (const [a, b] of [[3, 9], [9, 11], [11, 14], [14, 30]] as [number, number][]) {
      expect(at(a).headH, `${a}`).toBeGreaterThanOrEqual(at(b).headH);
      expect(at(a).hipH).toBeLessThanOrEqual(at(b).hipH);
    }
    expect(at(3).headH / 5).toBeGreaterThan(0.16); // about 5.7 heads tall
    expect(at(3).headH / 5).toBeLessThan(0.19);
    expect(at(30).headH / 5).toBeLessThan(0.14);
    expect(at(3).hipH / 5).toBeLessThan(at(30).hipH / 5 - 0.08);
  });

  it('keeps the arms within sensible lengths: the arm hangs from the shoulder to about mid-thigh and the wingspan is about the height', () => {
    for (const r of roster) {
      const b = bodyFor(r);
      const span = 2 * (b.shoulderHalf + b.upperArmL + b.forearmL + b.handL);
      expect(span / b.height, `${r.age}`).toBeGreaterThan(0.95);
      expect(span / b.height).toBeLessThan(1.1);
    }
  });

  it('differs by sex and build only a little: women narrower shoulders and wider hips than men of the same height, a broad build wider than a slim one', () => {
    const f = bodyOf(30, 5.6, cfg, 'f'), m = bodyOf(30, 5.6, cfg, 'm');
    expect(f.shoulderHalf).toBeLessThan(m.shoulderHalf);
    expect(f.hipW).toBeGreaterThan(m.hipW);
    expect(Math.abs(f.hipH - m.hipH) / 5.6).toBeLessThan(0.02);
    expect(bodyOf(30, 5.6, cfg, 'm', 'broad').chestW).toBeGreaterThan(bodyOf(30, 5.6, cfg, 'm', 'slim').chestW);
    // children barely differ by sex
    expect(Math.abs(bodyOf(9, 4.3, cfg, 'f').shoulderHalf - bodyOf(9, 4.3, cfg, 'm').shoulderHalf)).toBeLessThan(0.01);
  });

  it('keeps the legs from touching through the middle and the hips wider than the thighs are thick', () => {
    for (const r of roster) {
      const b = bodyFor(r);
      expect(b.hipHalf, `${r.age}`).toBeGreaterThan(b.r.thigh * 0.9);
      expect(b.hipW / 2).toBeGreaterThan(b.hipHalf + b.r.thigh * 0.4);
    }
  });
});

describe('walking', () => {
  it('takes longer steps with longer legs, and longer steps when faster, never more than the leg allows', () => {
    const tall = bodyOf(30, 6, cfg, 'm'), small = bodyOf(9, 4.3, cfg, 'f'), toddler = bodyOf(3, 3, cfg, 'm');
    expect(stepLengthFt(tall, 3, cfg)).toBeGreaterThan(stepLengthFt(small, 3, cfg));
    expect(stepLengthFt(small, 3, cfg)).toBeGreaterThan(stepLengthFt(toddler, 3, cfg));
    expect(stepLengthFt(tall, 5, cfg)).toBeGreaterThan(stepLengthFt(tall, 3, cfg));
    for (const b of [tall, small, toddler]) {
      const step = stepLengthFt(b, 4, cfg);
      expect(step).toBeLessThan(legLengthFt(b) * 1.3);
      expect(swingRad(b, step, cfg)).toBeLessThan(1);
      expect(swingRad(b, step, cfg)).toBeGreaterThan(0.1);
    }
    // an adult's comfortable step is about 0.41 of height (about 2.4 ft at 5 ft 9) at 4.5 ft/s
    expect(stepLengthFt(bodyOf(30, 5.75, cfg, 'm'), 4.6, cfg) / 5.75).toBeGreaterThan(0.35);
    expect(stepLengthFt(bodyOf(30, 5.75, cfg, 'm'), 4.6, cfg) / 5.75).toBeLessThan(0.48);
  });

  it('keeps the lower foot on the ground at every moment of a stride', () => {
    for (const r of roster) {
      const b = bodyFor(r);
      const A = swingRad(b, stepLengthFt(b, 3.2, cfg), cfg);
      for (let k = 0; k < 24; k++) {
        const phase = (k / 24) * Math.PI * 2;
        const pose = (ph: number) => {
          const hip = A * Math.sin(ph), swing = Math.max(0, -Math.cos(ph));
          return { hip, knee: cfg.gait.kneeFlex * (0.12 + 0.88 * swing) * (hip < A ? 1 : 1) };
        };
        const a = pose(phase), c = pose(phase + Math.PI);
        const hipZ = standingHipFt(b, a.hip, a.knee, c.hip, c.knee);
        // neither foot is below the ground and one is on it
        expect(hipZ - legDropFt(b, a.hip, a.knee)).toBeGreaterThanOrEqual(-1e-9);
        expect(hipZ - legDropFt(b, c.hip, c.knee)).toBeGreaterThanOrEqual(-1e-9);
        expect(Math.min(hipZ - legDropFt(b, a.hip, a.knee), hipZ - legDropFt(b, c.hip, c.knee))).toBeCloseTo(0, 9);
        // and the body never drops more than a few percent of its height as it walks
        expect(hipZ).toBeGreaterThan(b.hipH * 0.88);
        expect(hipZ).toBeLessThanOrEqual(b.hipH + 1e-9);
      }
    }
  });
});

describe('sitting', () => {
  it('puts every person\'s hip at the seat plus a little, scaled to them, and a child\'s feet short of the floor on a tall seat', () => {
    const seat = 1.5;
    const adult = sitPose(bodyOf(30, 5.8, cfg, 'm'), seat, cfg), child = sitPose(bodyOf(9, 4.3, cfg, 'f'), seat, cfg), toddler = sitPose(bodyOf(3, 3, cfg), seat, cfg);
    for (const p of [adult, child, toddler]) expect(p.hipZ).toBeGreaterThan(seat);
    expect(adult.hipZ).toBeGreaterThan(child.hipZ);
    expect(adult.soleZ).toBeCloseTo(0, 9); // an adult's feet reach the floor, the thighs tilting a little
    expect(adult.thighTilt).toBeLessThan(0.1);
    expect(child.thighTilt).toBe(cfg.gait.maxSitTilt); // a child's legs are tilted as far as they go and still do not reach
    expect(child.soleZ).toBeGreaterThanOrEqual(0);
    expect(toddler.soleZ).toBeGreaterThan(child.soleZ); // a toddler dangles
    expect(toddler.soleZ).toBeGreaterThan(0.1);
    expect(child.soleZ).toBeGreaterThan(0);
  });
});

describe('arms reach for things', () => {
  const b = bodyOf(30, 5.7, cfg, 'm');
  const l1 = b.upperArmL, l2 = b.forearmL + b.handL * 0.6;

  it('puts the hand exactly on any target within reach, in front, to the side, above or below the shoulder', () => {
    const targets: [number, number, number][] = [[1.2, 0, 0.3], [1.5, 0.6, -0.4], [0.8, -0.5, 0.9], [1.0, 1.0, 0.2], [0.3, 0.2, -1.6], [1.9, 0, 0], [0.6, 0, 1.4], [1.1, -0.9, 0.5]];
    for (const t of targets) {
      const r = armIK(b, t);
      expect(Math.hypot(...t), `${t}`).toBeLessThan(l1 + l2);
      expect(r.reached, `${t}`).toBe(true);
      for (let k = 0; k < 3; k++) expect(r.tip[k], `${t} axis ${k}`).toBeCloseTo(t[k], 6);
    }
  });

  it('bends the elbow forward by the amount that distance needs, never backward and never past a fully folded arm', () => {
    let last = 0;
    for (const reach of [2.2, 1.9, 1.5, 1.1, 0.8]) {
      const r = armIK(b, [reach, 0, 0]);
      expect(r.elbow).toBeLessThanOrEqual(1e-9); // negative is forward
      expect(r.elbow).toBeGreaterThan(-2.9);
      expect(-r.elbow).toBeGreaterThanOrEqual(last - 1e-9); // closer means more bend
      last = -r.elbow;
    }
    expect(armIK(b, [l1 + l2 - 0.001, 0, 0]).elbow).toBeGreaterThan(-0.12); // nearly straight at full stretch
  });

  it('lets the elbow hang below the line from shoulder to hand, as it does for a person reaching forward', () => {
    const r = armIK(b, [1.4, 0, 0.2]);
    const elbowZ = -Math.cos(r.pitch) * l1;
    expect(elbowZ).toBeLessThan(0.1); // below the hand's height
    expect(elbowZ).toBeLessThan(r.tip[2] + 1e-6);
  });

  it('clamps a target out of reach to the longest stretch along the same line', () => {
    const far: [number, number, number] = [4, 3, 1];
    const r = armIK(b, far);
    expect(r.reached).toBe(false);
    expect(Math.hypot(...r.tip)).toBeCloseTo(l1 + l2, 3);
    const dir = Math.hypot(...far);
    for (let k = 0; k < 3; k++) expect(r.tip[k] / (l1 + l2)).toBeCloseTo(far[k] / dir, 2);
  });

  it('reaches less far for a child, in proportion to their arm', () => {
    const child = bodyOf(9, 4.3, cfg, 'f');
    const reachOf = (x: typeof b) => x.upperArmL + x.forearmL + x.handL * 0.6;
    expect(reachOf(child)).toBeLessThan(reachOf(b));
    expect(armIK(child, [reachOf(b) * 0.9, 0, 0]).reached).toBe(false);
  });
});
