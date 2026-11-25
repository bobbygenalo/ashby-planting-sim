import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { armIK, bodyOf, legDropFt, sitPose, standingHipFt, swingRad } from '../engine/anatomy';
import { basketDims, isInside, type LifeSim } from '../engine/life';
import { useApp } from '../store/store';
import { basketAt, handTipAt } from './harvestState';
import { hand as handGeo, head as headGeo, hair as hairGeo, limb, shoe as shoeGeo, thumb as thumbGeo, torso as torsoGeo, unitSphere } from './personParts';

/** Nothing here should catch a click meant for the ground or a plant. */
const noHit = { raycast: () => null } as const;

const SHIRTS = ['#c0392b', '#2e86c1', '#27ae60', '#f39c12', '#8e44ad', '#16a085', '#d35400', '#34495e'];
const PANTS = ['#2c3e50', '#4a4a4a', '#5d4037', '#1f3a5f', '#6b705c'];
const SKIN = ['#eebb97', '#d29866', '#a9693f', '#7b4a2c', '#f4cdb0'];
const HAIR = ['#2b1d14', '#4a3222', '#7a5230', '#c8a45a', '#1b1b1b', '#8c8c8c', '#a0522d'];
const SHOES = ['#2b2b2b', '#4b3b2b', '#e8e8e8', '#34495e'];

const tmpObj = new THREE.Object3D();
const tmpColor = new THREE.Color();

/**
 * A person in site coordinates, facing +X with Z up, built from their real proportions (`engine/anatomy.ts`): a tapered
 * torso, neck and an egg-shaped head, limbs with an elbow and a knee, hands and shoes. Legs swing by the length of their
 * stride, knees bend, the lower foot stays on the ground, and a seated person's hips sit at the seat for their size.
 */
export function Person({ sim, index }: { sim: React.MutableRefObject<LifeSim | null>; index: number }) {
  const anatomy = useApp((s) => s.engine.anatomy);
  const hatCfg = useApp((s) => s.engine.birthday.hat);
  const lookUpRad = useApp((s) => s.engine.life.fireworks.lookUpRad);
  const hv = useApp((s) => s.engine.life.harvest);
  const manner = useApp((s) => s.engine.life.people.manner);
  const seatTop = useApp((s) => s.engine.life.dining.seatHeightFt);
  const who = sim.current?.walkers[index];
  const variant = who?.variant ?? index;
  const b = useMemo(() => bodyOf(who?.age ?? 30, who?.heightFt ?? 5.6, anatomy, who?.sex, who?.build), [who?.age, who?.heightFt, who?.sex, who?.build, anatomy]);
  const swing0 = useMemo(() => swingRad(b, who?.stepFt ?? 1.5, anatomy), [b, who?.stepFt, anatomy]);
  const sit = useMemo(() => sitPose(b, seatTop, anatomy), [b, seatTop, anatomy]);
  const hat = useRef<THREE.Group>(null);
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const upper = useRef<THREE.Group>(null);
  const mouth = [0, 1, 2, 3, 4].map(() => useRef<THREE.Mesh>(null)); // eslint-disable-line react-hooks/rules-of-hooks
  const snackMesh = useRef<THREE.Mesh>(null);
  const hips = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const knees = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const ankles = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const shoulders = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const elbows = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const dots = [useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null)];
  const basketGroup = useRef<THREE.Group>(null);
  const fruitInBasket = useRef<THREE.InstancedMesh>(null);

  const look = useMemo(() => {
    const female = who?.sex === 'f';
    const skin = SKIN[(variant >> 4) % SKIN.length];
    return {
      // The family's shirt color, and gray hair where the cast has it; otherwise left to the person's own variant.
      shirt: who?.shirt ?? SHIRTS[variant % SHIRTS.length], pants: PANTS[(variant >> 2) % PANTS.length], skin,
      hair: who?.hair ?? HAIR[(variant >> 6) % HAIR.length], shoe: SHOES[(variant >> 3) % SHOES.length],
      // Shorts leave the shins bare on about one person in four; some women have long hair.
      shorts: (variant >> 5) % 8 === 0 && b.height > 3.5,
      longHair: female && (variant >> 7) % 3 !== 0 && b.height > 3.5,
    };
  }, [variant, who?.sex, who?.shirt, who?.hair, b.height]);
  const mats = useMemo(() => ({
    skin: new THREE.MeshStandardMaterial({ color: look.skin, roughness: 0.8 }),
    shirt: new THREE.MeshStandardMaterial({ color: look.shirt, roughness: 0.9 }),
    pants: new THREE.MeshStandardMaterial({ color: look.pants, roughness: 0.9 }),
    hair: new THREE.MeshStandardMaterial({ color: look.hair, roughness: 0.95 }),
    shoe: new THREE.MeshStandardMaterial({ color: look.shoe, roughness: 0.7 }),
    eye: new THREE.MeshStandardMaterial({ color: '#2a1d16', roughness: 0.4 }),
    mouth: new THREE.MeshStandardMaterial({ color: '#9a4a45', roughness: 0.6 }),
  }), [look]);
  const geo = useMemo(() => ({
    torso: torsoGeo(b),
    head: headGeo(b),
    hair: hairGeo(b, look.longHair),
    thigh: limb(b.thighL, b.r.thigh, b.r.thigh * 0.92, b.r.knee),
    shin: limb(b.shankL, b.r.knee, b.r.calf, b.r.ankle, 0.3),
    upperArm: limb(b.upperArmL, b.r.upperArm * 1.05, b.r.upperArm, b.r.elbow),
    forearm: limb(b.forearmL, b.r.elbow, b.r.forearm, b.r.wrist, 0.3),
    sleeve: limb(b.upperArmL * 0.58, b.r.upperArm * 1.16, b.r.upperArm * 1.13, b.r.upperArm * 1.12, 0.5),
    trouserThigh: limb(b.thighL, b.r.thigh * 1.08, b.r.thigh * 1.0, b.r.knee * 1.08),
    shortThigh: limb(b.thighL * 0.62, b.r.thigh * 1.08, b.r.thigh * 1.04, b.r.thigh * 0.98, 0.5),
    trouserShin: limb(b.shankL, b.r.knee * 1.08, b.r.calf * 1.08, b.r.ankle * 1.45, 0.3),
    neck: limb(b.neckL + b.r.neck, b.r.neck * 1.08, b.r.neck, b.r.neck * 1.0, 0.5),
    shoe: shoeGeo(b),
    hand: handGeo(b),
    thumb: thumbGeo(b),
  }), [b, look.longHair]);
  useEffect(() => () => { Object.values(geo).forEach((g) => g.dispose()); }, [geo]);
  useEffect(() => () => { Object.values(mats).forEach((m) => m.dispose()); }, [mats]);

  useFrame(({ clock }) => {
    const w = sim.current?.walkers[index];
    const g = root.current;
    if (!g) return;
    if (!w) { g.visible = false; return; }
    g.visible = !isInside(w);
    g.position.set(w.x, w.y, 0);
    g.rotation.z = w.heading;
    const t = clock.elapsedTime;
    const seated = w.sit;
    const gc = anatomy.gait;
    // How much of a full stride this moment's speed asks for, from the legs' own swing at their walking speed.
    const ratio = Math.min(1.2, w.speed / Math.max(w.cruise, 0.4)) * (1 - seated);
    const amp = swing0 * ratio;
    const poses = [0, 1].map((n) => {
      const ph = w.gait + n * Math.PI;
      const hipW = amp * Math.sin(ph);
      const kneeW = gc.kneeFlex * Math.min(1, ratio) * (0.12 + 0.88 * Math.max(0, -Math.cos(ph)));
      const hipS = -(Math.PI / 2 - sit.thighTilt), kneeS = Math.PI / 2 - sit.thighTilt;
      const hip = hipW * (1 - seated) + hipS * seated, knee = kneeW * (1 - seated) + kneeS * seated;
      return { hip, knee, ph };
    });
    poses.forEach((p, n) => {
      hips[n].current?.rotation.set(0, p.hip, 0);
      knees[n].current?.rotation.set(0, p.knee, 0);
      ankles[n].current?.rotation.set(0, -(p.hip + p.knee) * 0.9, 0);
    });
    // The pelvis rides at the height that keeps the lower foot on the ground; seated, it sits at the seat.
    const hipZ = standingHipFt(b, poses[0].hip, poses[0].knee, poses[1].hip, poses[1].knee);
    const seatHip = w.seatZ != null ? sit.hipZ + (w.seatZ - seatTop) : sit.hipZ;
    // Skipping: a little hop with each stride.
    const hop = w.skip > 0 && w.speed > 0.5 ? Math.abs(Math.sin(w.gait)) * manner.play.skipHopFt : 0;
    const z = hipZ * (1 - seated) + seatHip * seated + hop;
    if (body.current) body.current.position.z = z - b.hipH;
    void legDropFt;
    // Arms swing against the legs; a speaker gestures, a seated listener rests their hands forward; a picker reaches.
    const armSwing = amp * gc.armSwingShare * (w.skip > 0 ? 1.8 : 1);
    const gesture = w.talking ? -0.9 - Math.sin(t * 5.5) * 0.35 : 0;
    const rest = seated * -0.5;
    const set = (n: number, shoulder: number, elbow: number, roll = 0.07) => {
      // A relaxed arm hangs a little away from the body, never ramrod straight.
      shoulders[n].current?.rotation.set((n === 0 ? 1 : -1) * roll, shoulder, 0);
      elbows[n].current?.rotation.set(0, elbow, 0);
    };
    let carry = 0, carryElbow = 0, pickingArm = false, handsOnKnees = false;
    if (w.hug > 0.02) {
      // A hug: both arms come up and round the other person, the elbows bent.
      const k = w.hug;
      set(0, -(0.3 + 1.0 * k), -0.35 - 0.7 * k);
      set(1, -(0.3 + 1.0 * k), -0.35 - 0.7 * k);
    } else if (w.cheer) {
      set(0, -2.7 + Math.sin(t * 6 + index) * 0.45, -0.25);
      set(1, -2.7 + Math.sin(t * 6 + index + 1.9) * 0.45, -0.25);
    } else if (w.basket) {
      // One arm holds the basket out in front, the other reaches up to the fruit and back.
      carry = w.act?.kind === 'harvest' ? -0.6 : -0.4 + armSwing * 0.1;
      carryElbow = w.act?.kind === 'harvest' ? -1.15 : -1.0;
      set(1, carry, carryElbow);
      pickingArm = true;
    } else if (w.sit > 0.02 && w.act?.kind !== 'dine') {
      // Seated with no table: the upper arms hang by the sides and the forearms rest forward, the hands on the knees.
      const kneeX = b.thighL * Math.cos(sit.thighTilt) * 0.92;
      const kneeZ = -b.trunkL - b.thighL * Math.sin(sit.thighTilt) * 0.92 + b.r.thigh;
      const ik = armIK(b, [kneeX, 0, kneeZ]);
      const k = seated;
      for (const n of [0, 1]) {
        const sh = shoulders[n].current;
        if (!sh) continue;
        sh.rotation.order = 'ZYX';
        sh.rotation.set((n === 0 ? 1 : -1) * 0.07 * (1 - k), ik.pitch * k + (-0.05) * (1 - k), 0);
        elbows[n].current?.rotation.set(0, ik.elbow * k - 0.24 * (1 - k), 0);
      }
      handsOnKnees = true;
    } else {
      const a0 = -armSwing * Math.sin(poses[0].ph) + gesture + rest, a1 = armSwing * Math.sin(poses[0].ph) + (w.talking ? -0.9 - Math.sin(t * 5.5 + 1.7) * 0.35 : 0) + rest;
      let l: [number, number, number] = [a0 - 0.05, -0.24 - 0.4 * Math.max(0, -a0) - seated * 0.5, 0.07];
      let r: [number, number, number] = [a1 - 0.05, -0.24 - 0.4 * Math.max(0, -a1) - seated * 0.5, 0.07];
      if (w.five > 0.02) {
        // A high five: the right arm comes up to meet the other's hand.
        r = [-2.3 * w.five + a1 * (1 - w.five), -0.2 - 0.3 * (1 - w.five), 0.12];
      } else if (w.shoo > 0) {
        // "Get out of the light": the right arm up and sweeping wide from side to side, as if to move someone along.
        const k = Math.min(1, w.shoo * 5);
        const sweep = Math.sin(t * 7.5);
        r = [(-1.9 + 0.15 * sweep) * k + a1 * (1 - k), (-0.35 - 0.45 * (0.5 + 0.5 * sweep)) * k, (0.25 + 0.55 * sweep) * k + 0.07 * (1 - k)];
      } else if (w.wave > 0) {
        // A wave: the arm up, the forearm waggling.
        const k = Math.min(1, w.wave * 4);
        r = [-2.45 * k + a1 * (1 - k), -0.5 - 0.5 * k * Math.sin(t * 9), 0.2];
      } else if (w.pose === 'phone') {
        l = [-0.08, -0.2, 0.07];
        r = [-0.45, -2.35, 0.0];
      } else if (w.pose === 'snack') {
        // Hand to the mouth and back down, a bite at a time.
        const c = 0.5 + 0.5 * Math.sin((t / manner.linger.eatCycleS) * Math.PI * 2);
        l = [-0.08, -0.2, 0.07];
        r = [-0.2 - 0.1 * c, -1.0 - 1.9 * c, 0.05];
      } else if (w.pose === 'folded') {
        l = [-0.2, -1.8, 0.0];
        r = [-0.2, -1.8, 0.0];
      } else if (w.pose === 'spin') {
        l = [0, -0.1, 1.35];
        r = [0, -0.1, 1.35];
      } else if (w.pose === 'door') {
        // Reaching for the door handle: the right arm out in front, a little bent.
        r = [-1.3, -0.45, 0.08];
      } else if (w.pose === 'tag') {
        r = [-1.4, -0.15, 0.1];
      } else if (w.pose === 'puppet') {
        // Shadow puppets: both hands up in front of the light, fingers and wrists wiggling.
        l = [-2.55 + Math.sin(t * 6) * 0.25, -0.3 + Math.sin(t * 9) * 0.55, 0.4 + Math.sin(t * 4) * 0.2];
        r = [-2.55 + Math.sin(t * 6 + 1.7) * 0.25, -0.3 + Math.sin(t * 9 + 2.2) * 0.55, 0.4 + Math.sin(t * 4 + 1) * 0.2];
      }
      set(0, l[0], l[1], l[2]);
      set(1, r[0], r[1], r[2]);
    }
    if (hat.current) hat.current.visible = !!sim.current?.party && g.visible;
    if (headRef.current) {
      headRef.current.rotation.z = w.headTurn;
      headRef.current.rotation.y = w.lookUp ? -lookUpRad : (w.talking ? Math.sin(t * 7) * 0.07 : 0) + 0.04 + w.headPitch;
    }
    // The trunk bends forward from the hips to smell a flower, or leans back against a wall.
    if (upper.current) upper.current.rotation.y = w.bend;
    // A smile: a curve of five small beads at the mouth, the corners rising and the whole widening as it grows.
    const sm = Math.max(0, Math.min(1, w.smile));
    mouth.forEach((m, n) => {
      const mesh = m.current;
      if (!mesh) return;
      const u = (n - 2) / 2;
      mesh.position.set(b.headD * 0.43, u * b.headW * (0.1 + 0.05 * sm), b.headH * (0.095 + 0.05 * sm * u * u - 0.01 * sm));
    });
    if (snackMesh.current) {
      snackMesh.current.visible = w.pose === 'snack' && !!w.snackColor;
      if (w.snackColor) (snackMesh.current.material as THREE.MeshStandardMaterial).color.set(w.snackColor);
    }
    dots.forEach((d, n) => {
      const m = d.current;
      if (!m) return;
      m.visible = w.talking;
      if (w.talking) m.scale.setScalar(0.55 + 0.45 * Math.max(0, Math.sin(t * 6 - n * 0.9)));
    });
    // The basket hangs from the carrying hand and stays upright; its fruit piles up as it fills.
    const bg = basketGroup.current;
    if (bg) {
      bg.visible = !!w.basket && g.visible;
      if (w.basket && g.visible) {
        const dims = basketDims(w.basket.volume, hv);
        bg.rotation.set(0, -(carry + carryElbow), 0);
        bg.scale.setScalar(dims.top);
        // The hand, by walking the arm: shoulder, upper arm, forearm, then most of the hand.
        const reach2 = b.forearmL + b.handL * 0.8;
        const lx = -Math.sin(carry) * b.upperArmL - Math.sin(carry + carryElbow) * reach2;
        const lz = b.shoulderH - Math.cos(carry) * b.upperArmL - Math.cos(carry + carryElbow) * reach2 - z + b.hipH;
        const ly = -b.shoulderHalf;
        const cos = Math.cos(w.heading), sin = Math.sin(w.heading);
        basketAt.set(index, [w.x + cos * lx - sin * ly, w.y + sin * lx + cos * ly, lz + z - b.hipH + 0.05]);
        const items = w.basket.items;
        const mesh = fruitInBasket.current;
        if (mesh) {
          // One ball per pick, piled from the bottom in rings; in units of the basket's top radius.
          const n = Math.min(items.length, 80);
          mesh.count = n;
          const R = dims.top;
          const avg = n ? items.reduce((tot, it) => tot + it.d, 0) / items.length / R : 0.3;
          const bottomZ = -hv.basket.heightShare;
          const inner = 0.86 * (1 + hv.basket.flare) / 2;
          const perLayer = Math.max(1, Math.floor((inner * inner) / ((avg / 2) * (avg / 2)) * 0.78));
          for (let i = 0; i < n; i++) {
            const it = items[i];
            const u = it.d / R;
            const layer = Math.floor(i / perLayer), k = i % perLayer;
            const a = k * 2.399963 + layer * 0.9;
            const zz = bottomZ + avg * 0.5 + layer * avg * 0.8;
            const over = Math.max(0, zz / (hv.basket.heightShare * 0.6));
            const rr = inner * Math.sqrt((k + 0.5) / perLayer) * (1 - Math.min(0.55, over * 0.25));
            tmpObj.position.set(Math.cos(a) * rr, Math.sin(a) * rr, zz);
            tmpObj.rotation.set(0, 0, 0);
            tmpObj.scale.set(u, u, u * it.aspect);
            tmpObj.updateMatrix();
            mesh.setMatrixAt(i, tmpObj.matrix);
            tmpColor.set(it.color);
            mesh.setColorAt(i, tmpColor);
          }
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
      } else basketAt.delete(index);
    }
    // The picking hand: from rest out to the fruit, a tug to pull it free, then over to the basket, then back. The arm bends
    // at the elbow to do it (two-bone IK), the shoulder turning to the side the fruit is on.
    const cosH = Math.cos(w.heading), sinH = Math.sin(w.heading);
    if (pickingArm && g.visible) {
      const shoulderZ = b.shoulderH + (z - b.hipH);
      const S: [number, number, number] = [0, b.shoulderHalf, shoulderZ];
      const toLocal = (p: [number, number, number]): [number, number, number] => [cosH * (p[0] - w.x) + sinH * (p[1] - w.y), -sinH * (p[0] - w.x) + cosH * (p[1] - w.y), p[2]];
      const arm = b.upperArmL + b.forearmL + b.handL * 0.6;
      const rest: [number, number, number] = [S[0] + 0.3 * arm, S[1] + 0.05, S[2] - 0.88 * arm];
      const mouth = basketAt.get(index);
      const fruit = w.aim ? toLocal(w.aim) : null;
      let hand = rest;
      if (fruit && mouth) {
        const basket = toLocal(mouth);
        const u = w.pickU, ph = hv;
        const ease = (x: number) => x * x * (3 - 2 * x);
        const mix = (p: [number, number, number], q: [number, number, number], k: number): [number, number, number] => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k];
        // A short tug back toward the body once the hand has the fruit.
        const dx = S[0] - fruit[0], dy = S[1] - fruit[1], dz = S[2] - fruit[2], dl = Math.hypot(dx, dy, dz) || 1;
        const tugged: [number, number, number] = [fruit[0] + (dx / dl) * 0.25, fruit[1] + (dy / dl) * 0.25, fruit[2] + (dz / dl) * 0.25];
        const grabEnd = ph.pluckAt - 0.08;
        if (u < grabEnd) hand = mix(rest, fruit, ease(u / grabEnd));
        else if (u < ph.pluckAt) hand = fruit;
        else if (u < ph.releaseAt) {
          // Pull free, then carry it over the basket in a low arc.
          const k = (u - ph.pluckAt) / (ph.releaseAt - ph.pluckAt);
          const tug = ease(Math.min(1, k / 0.25));
          const start = mix(fruit, tugged, tug);
          const m = mix(start, basket, ease(Math.max(0, (k - 0.1) / 0.9)));
          hand = [m[0], m[1], m[2] + Math.sin(Math.PI * k) * 0.2];
        } else hand = mix(basket, rest, ease((u - ph.releaseAt) / (1 - ph.releaseAt)));
      }
      const t2: [number, number, number] = [hand[0] - S[0], hand[1] - S[1], hand[2] - S[2]];
      const ik = armIK(b, t2);
      const sh = shoulders[0].current;
      if (sh) { sh.rotation.order = 'ZYX'; sh.rotation.set(0, ik.pitch, ik.yaw); }
      elbows[0].current?.rotation.set(0, ik.elbow, 0);
      // Where the hand ended up, in site coordinates, for the fruit to ride in.
      const tx = S[0] + ik.tip[0], ty = S[1] + ik.tip[1], tz = S[2] + ik.tip[2];
      handTipAt.set(index, [w.x + cosH * tx - sinH * ty, w.y + sinH * tx + cosH * ty, tz]);
    } else {
      handTipAt.delete(index);
      const sh0 = shoulders[0].current;
      if (sh0) sh0.rotation.order = 'XYZ';
      if (!handsOnKnees) { const sh1 = shoulders[1].current; if (sh1) sh1.rotation.order = 'XYZ'; }
    }
  });

  const hatS = b.headW * 0.9;
  return (
    <group ref={root} {...noHit}>
      <group ref={body}>
        {/* Legs: thigh, knee, shin, ankle, shoe. */}
        {[1, -1].map((side, n) => (
          <group key={side} ref={hips[n]} position={[0, side * b.hipHalf, b.hipH]}>
            <mesh {...noHit} geometry={geo.thigh} material={mats.skin} castShadow />
            <mesh {...noHit} geometry={look.shorts ? geo.shortThigh : geo.trouserThigh} material={mats.pants} castShadow />
            <group ref={knees[n]} position={[0, 0, -b.thighL]}>
              <mesh {...noHit} geometry={unitSphere} material={look.shorts ? mats.skin : mats.pants} scale={b.r.knee * 1.1} />
              <mesh {...noHit} geometry={geo.shin} material={mats.skin} castShadow />
              {!look.shorts && <mesh {...noHit} geometry={geo.trouserShin} material={mats.pants} castShadow />}
              <group ref={ankles[n]} position={[0, 0, -b.shankL]}>
                <mesh {...noHit} geometry={geo.shoe} material={mats.shoe} castShadow />
              </group>
            </group>
          </group>
        ))}
        {/* Everything above the hips bends together. */}
        <group ref={upper} position={[0, 0, b.hipH]}>
        <group position={[0, 0, -b.hipH]}>
        {/* Trunk, neck and head. */}
        <mesh {...noHit} geometry={geo.torso} material={mats.shirt} position={[0, 0, b.hipH]} castShadow />
        <mesh {...noHit} geometry={geo.neck} material={mats.skin} position={[0, 0, b.shoulderH + b.neckL]} />
        <group ref={headRef} position={[0, 0, b.shoulderH + b.neckL]}>
          <mesh {...noHit} geometry={geo.head} material={mats.skin} castShadow />
          <mesh {...noHit} geometry={geo.hair} material={mats.hair} castShadow />
          {mouth.map((m, n) => (
            <mesh key={n} ref={m} {...noHit} geometry={unitSphere} material={mats.mouth} scale={[b.headD * 0.022, b.headW * 0.03, b.headH * 0.02]} />
          ))}
          {/* A small nose and two ears, so a turned head reads as looking somewhere. */}
          <mesh {...noHit} geometry={unitSphere} material={mats.mouth} position={[b.headD * 0.455, 0, b.headH * 0.2]} scale={[b.headD * 0.03, b.headW * 0.2, b.headH * 0.02]} />
          <mesh {...noHit} geometry={unitSphere} material={mats.skin} position={[b.headD * 0.47, 0, b.headH * 0.41]} scale={[b.headD * 0.07, b.headW * 0.055, b.headH * 0.075]} />
          {[1, -1].map((s) => (
            <group key={s}>
              <mesh {...noHit} geometry={unitSphere} material={mats.skin} position={[-b.headD * 0.03, s * b.headW * 0.5, b.headH * 0.5]} scale={[b.headD * 0.08, b.headW * 0.045, b.headH * 0.11]} />
              <mesh {...noHit} geometry={unitSphere} material={mats.eye} position={[b.headD * 0.405, s * b.headW * 0.2, b.headH * 0.53]} scale={[b.headD * 0.035, b.headW * 0.05, b.headH * 0.038]} />
            </group>
          ))}
        </group>
        {/* Arms: shoulder, upper arm (a sleeve), elbow, forearm, hand. */}
        {[1, -1].map((side, n) => (
          <group key={side} ref={shoulders[n]} position={[0, side * b.shoulderHalf, b.shoulderH]}>
            <mesh {...noHit} geometry={geo.upperArm} material={mats.skin} castShadow />
            <mesh {...noHit} geometry={geo.sleeve} material={mats.shirt} castShadow />
            <group ref={elbows[n]} position={[0, 0, -b.upperArmL]}>
              <mesh {...noHit} geometry={unitSphere} material={mats.skin} scale={b.r.elbow * 1.05} />
              <mesh {...noHit} geometry={geo.forearm} material={mats.skin} castShadow />
              <group position={[0, 0, -b.forearmL]}>
                <mesh {...noHit} geometry={geo.hand} material={mats.skin} castShadow />
                <mesh {...noHit} geometry={geo.thumb} material={mats.skin} position={[b.handL * 0.09, 0, -b.handL * 0.16]} rotation={[0, -0.55, 0]} />
                {side === -1 && (
                  <mesh ref={snackMesh} {...noHit} visible={false} position={[b.handL * 0.12, 0, -b.handL * 0.5]} castShadow>
                    <sphereGeometry args={[b.handL * 0.22, 10, 8]} />
                    <meshStandardMaterial color="#c0392b" roughness={0.6} />
                  </mesh>
                )}
                {side === -1 && (
                  <group ref={basketGroup} visible={false} position={[0, 0, -b.handL * 0.8]}>
                    {/* A wicker basket hanging from the hand, drawn at unit size and scaled to its volume: a flared bowl, a rim, a handle over the top, and its fruit. */}
                    <mesh {...noHit} position={[0, 0, -hv.basket.heightShare / 2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                      <cylinderGeometry args={[1, hv.basket.flare, hv.basket.heightShare, 16, 1, true]} />
                      <meshStandardMaterial color={hv.basket.color} side={THREE.DoubleSide} roughness={1} />
                    </mesh>
                    <mesh {...noHit} position={[0, 0, -hv.basket.heightShare]} rotation={[Math.PI / 2, 0, 0]}>
                      <circleGeometry args={[hv.basket.flare, 16]} />
                      <meshStandardMaterial color={hv.basket.color} side={THREE.DoubleSide} roughness={1} />
                    </mesh>
                    <mesh {...noHit}>
                      <torusGeometry args={[1, 0.06, 6, 20]} />
                      <meshStandardMaterial color={hv.basket.color} roughness={1} />
                    </mesh>
                    <mesh {...noHit} rotation={[Math.PI / 2, 0, 0]}>
                      <torusGeometry args={[0.98, 0.045, 5, 16, Math.PI]} />
                      <meshStandardMaterial color={hv.basket.color} roughness={1} />
                    </mesh>
                    <instancedMesh ref={fruitInBasket} args={[undefined, undefined, 80]} {...noHit} castShadow frustumCulled={false}>
                      <sphereGeometry args={[0.5, 10, 8]} />
                      <meshStandardMaterial roughness={0.6} />
                    </instancedMesh>
                  </group>
                )}
              </group>
            </group>
          </group>
        ))}
        {/* A party hat on the crown. */}
        <group ref={hat} visible={false} position={[0, 0, b.shoulderH + b.neckL + b.headH * 0.97]} rotation={[0, -0.12, 0]}>
          <mesh {...noHit} position={[0, 0, hatCfg.heightFt * (b.height / 5.6) / 2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <coneGeometry args={[hatS * 0.5, hatCfg.heightFt * (b.height / 5.6), 14]} />
            <meshStandardMaterial color={hatCfg.colors[variant % hatCfg.colors.length]} />
          </mesh>
          <mesh {...noHit} position={[0, 0, hatCfg.heightFt * (b.height / 5.6)]}>
            <sphereGeometry args={[hatS * 0.16, 8, 6]} />
            <meshStandardMaterial color={hatCfg.colors[(variant + 2) % hatCfg.colors.length]} />
          </mesh>
        </group>
        {dots.map((d, n) => (
          <mesh key={n} ref={d} {...noHit} visible={false} position={[0, (n - 1) * b.headH * 0.3, b.shoulderH + b.neckL + b.headH * 1.45]}>
            <sphereGeometry args={[b.headH * 0.09, 8, 6]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        ))}
        </group>
        </group>
      </group>
    </group>
  );
}
