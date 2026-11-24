import type { AnatomyCfg, AnatomyKey } from './types';

/**
 * A person's body from their age, height, sex and build: segment lengths and widths in feet, all measured from the same
 * stature so the parts add up. Pure functions, no React or three.js. The shares are general estimates (see `anatomy` in
 * engine.json); what matters here is that the figure is consistent and measurable.
 */
export interface Body {
  height: number;
  /** Height of the hip joint above the ground, and the leg segments below it. */
  hipH: number;
  thighL: number;
  shankL: number;
  /** Height of the ankle joint, and the foot's length and width. */
  ankleH: number;
  footL: number;
  footW: number;
  /** Hip joint to shoulder joint line. */
  trunkL: number;
  /** Height of the shoulder line, then the neck, and the head's length, width and depth. */
  shoulderH: number;
  neckL: number;
  headH: number;
  headW: number;
  headD: number;
  upperArmL: number;
  forearmL: number;
  handL: number;
  /** Half the distance between the shoulder joints and between the hip joints. */
  shoulderHalf: number;
  hipHalf: number;
  chestW: number; chestD: number; waistW: number; waistD: number; hipW: number; hipD: number;
  /** Radii at the joints and the middle of the limbs. */
  r: { thigh: number; knee: number; calf: number; ankle: number; upperArm: number; elbow: number; forearm: number; wrist: number; neck: number };
  /** Eye height above the ground. */
  eyeH: number;
}

function keyAt(age: number, keys: AnatomyKey[]): AnatomyKey {
  if (age <= keys[0].age) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    if (age <= keys[i].age) {
      const a = keys[i - 1], b = keys[i], t = (age - a.age) / (b.age - a.age);
      const out = { ...a } as Record<string, number>;
      for (const k of Object.keys(a)) out[k] = (a as unknown as Record<string, number>)[k] + ((b as unknown as Record<string, number>)[k] - (a as unknown as Record<string, number>)[k]) * t;
      return out as unknown as AnatomyKey;
    }
  }
  return keys[keys.length - 1];
}

export function bodyOf(age: number, heightFt: number, cfg: AnatomyCfg, sex?: 'f' | 'm', build: 'slim' | 'average' | 'broad' = 'average'): Body {
  const k = { ...keyAt(age, cfg.keys) } as AnatomyKey;
  if (sex) {
    const [a0, a1] = cfg.sexFromAge;
    const t = Math.min(1, Math.max(0, (age - a0) / (a1 - a0)));
    for (const [field, mult] of Object.entries(cfg.sex[sex]) as [keyof AnatomyKey, number][]) k[field] = k[field] * (1 + (mult - 1) * t);
  }
  const H = heightFt, w = cfg.build[build];
  const legSpan = k.hipJoint - k.ankle;
  const shoulderH = H * (1 - k.head - k.neck);
  const rd = cfg.radii;
  return {
    height: H,
    hipH: H * k.hipJoint, thighL: H * legSpan * 0.5, shankL: H * legSpan * 0.5,
    ankleH: H * k.ankle, footL: H * k.foot, footW: H * k.foot * rd.footWidth,
    trunkL: shoulderH - H * k.hipJoint, shoulderH, neckL: H * k.neck,
    headH: H * k.head, headW: H * k.head * rd.headWidth, headD: H * k.head * rd.headDepth,
    upperArmL: H * k.upperArm, forearmL: H * k.forearm, handL: H * k.hand,
    shoulderHalf: H * k.shoulderHalf, hipHalf: H * k.hipHalf,
    chestW: H * k.chestW * w, chestD: H * k.chestD * Math.sqrt(w), waistW: H * k.waistW * w, waistD: H * k.waistD * Math.sqrt(w), hipW: H * k.hipW * w, hipD: H * k.hipD * Math.sqrt(w),
    r: { thigh: H * rd.thigh * w, knee: H * rd.knee * w, calf: H * rd.calf * w, ankle: H * rd.ankle, upperArm: H * rd.upperArm * w, elbow: H * rd.elbow * w, forearm: H * rd.forearm * w, wrist: H * rd.wrist, neck: H * rd.neck * Math.sqrt(w) },
    eyeH: H - H * k.head * cfg.eyeFromTopShare,
  };
}

/** The reach of an arm held straight up from the shoulder: the highest a person can touch. */
export const reachUpFt = (b: Body): number => b.shoulderH + b.upperArmL + b.forearmL + b.handL;

/** How far a hand hangs above the ground with the arm straight down. */
export const fingertipFt = (b: Body): number => b.shoulderH - b.upperArmL - b.forearmL - b.handL;

/** The length of a leg, hip joint to ankle joint. */
export const legLengthFt = (b: Body): number => b.thighL + b.shankL;

/**
 * How far the hip joint is above the sole of a flat foot for a leg swung `hip` radians back from vertical (negative is
 * forward) with the knee bent `knee` radians (the shin swinging back from the thigh): thigh and shin projected on the
 * vertical, plus the ankle's height.
 */
export const legDropFt = (b: Body, hip: number, knee: number): number => b.thighL * Math.cos(hip) + b.shankL * Math.cos(hip + knee) + b.ankleH;

/** The hip height that keeps the lower of two feet on the ground. */
export const standingHipFt = (b: Body, hipA: number, kneeA: number, hipB: number, kneeB: number): number => Math.max(legDropFt(b, hipA, kneeA), legDropFt(b, hipB, kneeB));

/**
 * Length of one step (heel strike to the other heel strike) at a walking speed. A person's comfortable pace scales with the
 * square root of leg length (a Froude number near 0.25) and the step with speed to a power below one; a longer leg takes
 * a longer step, and a child a shorter one, so legs and feet agree with how far they travel.
 */
export function stepLengthFt(b: Body, speedFtS: number, cfg: AnatomyCfg): number {
  const g = cfg.gait, L = legLengthFt(b);
  const preferred = Math.sqrt(g.froude * g.gravity * L);
  return g.stepOverLeg * L * Math.pow(Math.max(speedFtS, 0.05) / preferred, g.stepExponent);
}

/** How far a leg swings from the vertical each way to take a step of this length. */
export const swingRad = (b: Body, step: number, cfg: AnatomyCfg): number => Math.asin(Math.min(cfg.gait.maxSwing * 0.92, step / (2 * legLengthFt(b))));

/**
 * Sitting on a seat at a height: where the hip joint is, how far the thighs tilt down from level (only when the seat is too
 * high for the feet to reach, and only so far), and how far the soles are still off the floor (a child's legs are too short).
 */
export function sitPose(b: Body, seatTop: number, cfg: AnatomyCfg): { hipZ: number; thighTilt: number; soleZ: number } {
  const hipZ = seatTop + b.height * cfg.seatHipAboveSeat;
  const deficit = Math.max(0, hipZ - b.shankL - b.ankleH);
  const tilt = Math.min(cfg.gait.maxSitTilt, Math.asin(Math.min(1, deficit / b.thighL)));
  return { hipZ, thighTilt: tilt, soleZ: Math.max(0, deficit - b.thighL * Math.sin(tilt)) };
}

/**
 * An arm hanging from the shoulder, in the shoulder's frame (x forward, y to the left, z up): swung `yaw` about the
 * vertical, then raised `pitch` in that plane (forward is negative, as the scene turns arms), with the elbow bent `elbow`
 * (also negative for a bend forward). The tip is the middle of the hand: the forearm plus most of the hand beyond the elbow.
 */
export function armFK(b: Body, yaw: number, pitch: number, elbow: number): [number, number, number] {
  const l2 = b.forearmL + b.handL * 0.6;
  const u = -Math.sin(pitch) * b.upperArmL - Math.sin(pitch + elbow) * l2;
  const z = -Math.cos(pitch) * b.upperArmL - Math.cos(pitch + elbow) * l2;
  return [u * Math.cos(yaw), u * Math.sin(yaw), z];
}

/**
 * The arm angles that put the hand at a target, given relative to the shoulder (x forward, y left, z up): two bones and a
 * hinge elbow that bends the way a real one does (never backward) and lets the elbow hang below the line from shoulder to
 * hand. A target out of reach is clamped to the longest the arm can stretch, along the same line.
 */
export function armIK(b: Body, target: [number, number, number]): { yaw: number; pitch: number; elbow: number; tip: [number, number, number]; reached: boolean } {
  const l1 = b.upperArmL, l2 = b.forearmL + b.handL * 0.6;
  const [tx, ty, tz] = target;
  const yaw = Math.atan2(ty, tx);
  const horizontal = Math.hypot(tx, ty);
  let d = Math.hypot(horizontal, tz);
  const reached = d <= l1 + l2 - 1e-6 && d >= Math.abs(l1 - l2) + 1e-6;
  const dc = Math.min(l1 + l2 - 1e-6, Math.max(Math.abs(l1 - l2) + 1e-6, d));
  // Interior angle at the elbow, from the law of cosines; the bend is what is left of a straight arm.
  const cosE = (l1 * l1 + l2 * l2 - dc * dc) / (2 * l1 * l2);
  const interior = Math.acos(Math.min(1, Math.max(-1, cosE)));
  const bend = Math.PI - interior;
  // The angle of the target from straight down, forward positive, and how far the upper arm sits below that line.
  const gamma = Math.atan2(horizontal, -tz);
  const cosA = (l1 * l1 + dc * dc - l2 * l2) / (2 * l1 * dc);
  const alpha = Math.acos(Math.min(1, Math.max(-1, cosA)));
  const pitch = -(gamma - alpha);
  const elbow = -bend;
  d = dc;
  return { yaw, pitch, elbow, tip: armFK(b, yaw, pitch, elbow), reached };
}
