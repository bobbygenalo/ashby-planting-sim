import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { fireworksDay } from '../engine/fireworks';
import { sedanHome, sedanSpotFor } from '../engine/vehicle';
import { footprint } from '../engine/hardscape';
import { Fireworks } from './Fireworks';
import { Sedan } from './Sedan';
import { balloonBunches, birthdayDay, greeting, presentSpots, type BalloonBunch, type Present } from '../engine/birthday';
import { CritterSim } from '../engine/critters';
import { buildLifeWorld, isInside, LifeSim, type LifeScreen, type LifeWorld } from '../engine/life';
import type { SunMap } from '../engine/placement';
import { activeStructures } from '../engine/site';
import { doyToMonthDay } from '../engine/time';
import { usePlaced } from '../store/derived';
import { sunMapFor, useApp } from '../store/store';
import { beeGeometry } from './forms';
import { Person } from './Person';
import { chairPull } from './chairState';
import { partyState } from './partyState';
import { basketAt, handTipAt } from './harvestState';

/** Nothing here should catch a click meant for the ground or a plant. */
const noHit = { raycast: () => null } as const;

const COATS = ['#a0693a', '#2b2b2b', '#d8b46a', '#ececec', '#7a5a3c'];

const tmpObj = new THREE.Object3D();
const tmpColor = new THREE.Color();

/** Fruit in the air from a plant to a basket: a small arc, shrinking from the size it hangs at to the size it sits in the basket. */
function FruitFlights({ sim }: { sim: React.MutableRefObject<LifeSim | null> }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useFrame(() => {
    const m = mesh.current, sm = sim.current;
    if (!m || !sm) return;
    let n = 0;
    for (const f of sm.flights) {
      const to = basketAt.get(f.walker);
      if (!to || n >= 48) continue;
      const e = f.p * f.p * (3 - 2 * f.p);
      // The fruit rides in the picking hand; with no hand drawn yet it sits where it hung.
      const hand = handTipAt.get(f.walker);
      const x = hand ? hand[0] : f.start[0], y = hand ? hand[1] : f.start[1];
      const z = hand ? hand[2] : f.start[2];
      const size = f.from + (f.d - f.from) * e;
      tmpObj.position.set(x, y, z);
      tmpObj.rotation.set(0, 0, 0);
      tmpObj.scale.set(size, size, size * f.aspect);
      tmpObj.updateMatrix();
      m.setMatrixAt(n, tmpObj.matrix);
      tmpColor.set(f.color);
      m.setColorAt(n, tmpColor);
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, 48]} {...noHit} castShadow frustumCulled={false}>
      <sphereGeometry args={[0.5, 10, 8]} />
      <meshStandardMaterial roughness={0.6} />
    </instancedMesh>
  );
}

/** A dog: body, head, ears, a wagging tail, and four legs that trot. */
function Dog({ sim, index }: { sim: React.MutableRefObject<LifeSim | null>; index: number }) {
  const height = useApp((s) => s.engine.life.dogs.heightFt);
  const root = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  const legs = [useRef<THREE.Group>(null), useRef<THREE.Group>(null), useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const variant = sim.current?.walkers[index]?.variant ?? index;
  const coat = COATS[variant % COATS.length];
  useFrame(({ clock }) => {
    const w = sim.current?.walkers[index];
    const g = root.current;
    if (!g) return;
    if (!w) {
      g.visible = false;
      return;
    }
    g.visible = !isInside(w);
    g.position.set(w.x, w.y, 0);
    g.rotation.z = w.heading;
    const swing = Math.sin(w.gait) * 0.8 * Math.min(1, w.speed / 2.5);
    legs.forEach((l, n) => l.current?.rotation.set(0, n === 0 || n === 3 ? swing : -swing, 0));
    if (tail.current) tail.current.rotation.z = Math.sin(clock.elapsedTime * 13 + index) * 0.55;
  });
  return (
    <group ref={root} scale={height / 1.65} {...noHit}>
      <mesh {...noHit} position={[0, 0, 1.0]} scale={[0.85, 0.3, 0.34]} castShadow>
        <sphereGeometry args={[1, 14, 10]} />
        <meshStandardMaterial color={coat} />
      </mesh>
      <mesh {...noHit} position={[1.0, 0, 1.3]} castShadow>
        <sphereGeometry args={[0.28, 12, 10]} />
        <meshStandardMaterial color={coat} />
      </mesh>
      <mesh {...noHit} position={[1.3, 0, 1.2]} castShadow>
        <boxGeometry args={[0.32, 0.22, 0.2]} />
        <meshStandardMaterial color={coat} />
      </mesh>
      {[1, -1].map((side) => (
        <mesh key={side} {...noHit} position={[0.92, side * 0.2, 1.52]} rotation={[side * 0.3, 0, 0]} castShadow>
          <boxGeometry args={[0.12, 0.08, 0.28]} />
          <meshStandardMaterial color="#3a2a20" />
        </mesh>
      ))}
      <group ref={tail} position={[-0.8, 0, 1.15]}>
        <mesh {...noHit} position={[-0.3, 0, 0.12]} rotation={[0, -0.5, 0]} castShadow>
          <cylinderGeometry args={[0.05, 0.03, 0.7, 6]} />
          <meshStandardMaterial color={coat} />
        </mesh>
      </group>
      {[[0.55, 0.2], [0.55, -0.2], [-0.55, 0.2], [-0.55, -0.2]].map(([x, y], n) => (
        <group key={n} ref={legs[n]} position={[x, y, 0.85]}>
          <mesh {...noHit} position={[0, 0, -0.42]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.06, 0.85, 6]} />
            <meshStandardMaterial color={coat} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Scenes the projected film cycles through: sky colors top and bottom, hill color, and the sun or moon's color. */
const SCENES = [
  { sky: ['#1b2a5a', '#f39c5a'], hill: '#1d1a2e', orb: '#ffe9a8' },
  { sky: ['#0b1d3a', '#2e6f9e'], hill: '#08121f', orb: '#e8f1ff' },
  { sky: ['#2a6f4a', '#d9e8a8'], hill: '#123524', orb: '#fff6c8' },
  { sky: ['#5a1f3a', '#f2b27a'], hill: '#2a0f1e', orb: '#ffd9a0' },
];
const SCENE_S = 7;

/** Paints one frame of the film: a gradient sky, a sun or moon crossing it, two ranges of hills sliding past, and drifting specks. */
function paintFilm(c: HTMLCanvasElement, t: number): string {
  const ctx = c.getContext('2d');
  const n = Math.floor(t / SCENE_S);
  const sc = SCENES[n % SCENES.length];
  const u = (t % SCENE_S) / SCENE_S;
  if (!ctx) return sc.sky[1];
  const { width: W, height: H } = c;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, sc.sky[0]);
  g.addColorStop(1, sc.sky[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = sc.orb;
  ctx.beginPath();
  ctx.arc(W * (0.15 + 0.7 * u), H * (0.62 - 0.4 * Math.sin(u * Math.PI)), H * 0.1, 0, Math.PI * 2);
  ctx.fill();
  for (const [speed, base, amp, shade] of [[0.5, 0.78, 0.07, 0.55], [1.2, 0.9, 0.08, 1]] as const) {
    ctx.fillStyle = sc.hill;
    ctx.globalAlpha = shade;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 6) ctx.lineTo(x, H * base - Math.sin((x + t * 14 * speed) * 0.045 + n) * H * amp - Math.sin((x + t * 9 * speed) * 0.11) * H * amp * 0.4);
    ctx.lineTo(W, H);
    ctx.fill();
  }
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 18; i++) ctx.fillRect(((i * 53 + t * (6 + (i % 5) * 3)) % W), (i * 29 + t * (3 + (i % 3))) % (H * 0.6), 1.5, 1.5);
  ctx.globalAlpha = 1;
  return sc.sky[1];
}

const CONFETTI = ['#ff4d6d', '#ffd60a', '#4cc9f0', '#7ae582', '#b388ff', '#ff9f1c', '#ffffff'];

/**
 * One frame of the birthday film: a rainbow sweeping the background, confetti falling, balloons rising on strings,
 * spinning stars, and the greeting bouncing in the middle in big letters. Returns the color of the light it casts.
 */
function paintBirthday(c: HTMLCanvasElement, t: number, text: string): string {
  const ctx = c.getContext('2d');
  const hue = (t * 40) % 360;
  if (!ctx) return `hsl(${hue}, 80%, 60%)`;
  const { width: W, height: H } = c;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, `hsl(${hue}, 75%, 38%)`);
  g.addColorStop(0.5, `hsl(${(hue + 70) % 360}, 80%, 45%)`);
  g.addColorStop(1, `hsl(${(hue + 160) % 360}, 75%, 36%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // rays turning slowly behind the text
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(t * 0.25);
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 12; i++) {
    ctx.rotate(Math.PI / 6);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(W, -H * 0.09);
    ctx.lineTo(W, H * 0.09);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  // balloons rising
  for (let i = 0; i < 7; i++) {
    const x = ((i * 0.153 + 0.06) % 1) * W + Math.sin(t * 0.9 + i) * 8;
    const y = H + 30 - (((t * 22 + i * 63) % (H + 90)));
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.moveTo(x, y + 14);
    ctx.quadraticCurveTo(x + 5, y + 30, x - 2, y + 48);
    ctx.stroke();
    ctx.fillStyle = CONFETTI[i % 6];
    ctx.beginPath();
    ctx.ellipse(x, y, 11, 14, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // confetti falling and turning
  for (let i = 0; i < 70; i++) {
    const x = (i * 47.3) % W + Math.sin(t * 1.4 + i) * 6;
    const y = ((t * (28 + (i % 7) * 7) + i * 29) % (H + 20)) - 10;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * (2 + (i % 5)) + i);
    ctx.fillStyle = CONFETTI[i % CONFETTI.length];
    ctx.fillRect(-3, -1.5, 6, 3);
    ctx.restore();
  }
  // spinning stars in the corners
  for (const [sx, sy, dir] of [[26, 24, 1], [W - 26, 24, -1], [26, H - 24, -1], [W - 26, H - 24, 1]] as const) {
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(t * 1.6 * dir);
    ctx.scale(1 + 0.2 * Math.sin(t * 4 + sx), 1 + 0.2 * Math.sin(t * 4 + sx));
    ctx.fillStyle = '#ffe066';
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 === 0 ? 15 : 6;
      const a = (k / 10) * Math.PI * 2;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // the greeting, in one or two lines, each letter bobbing in turn
  const lines = text.length > 18 && text.includes(',') ? [text.slice(0, text.indexOf(',') + 1), text.slice(text.indexOf(',') + 2)] : [text];
  const size = Math.min(H * (lines.length === 1 ? 0.2 : 0.22), (W * 0.9) / (Math.max(...lines.map((l) => l.length)) * 0.62));
  ctx.font = `900 ${size}px "Arial Black", Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  lines.forEach((line, li) => {
    const lineY = H / 2 + (li - (lines.length - 1) / 2) * size * 1.25;
    let x = W / 2 - ctx.measureText(line).width / 2;
    [...line].forEach((ch, i) => {
      const w = ctx.measureText(ch).width;
      const y = lineY + Math.sin(t * 5 - i * 0.55 - li) * size * 0.12;
      ctx.lineWidth = size * 0.22;
      ctx.strokeStyle = '#1d1030';
      ctx.strokeText(ch, x + w / 2, y);
      ctx.fillStyle = `hsl(${(hue + i * 22 + li * 90) % 360}, 95%, 72%)`;
      ctx.fillText(ch, x + w / 2, y);
      x += w;
    });
  });
  return `hsl(${(hue + 70) % 360}, 85%, 55%)`;
}

/** The evening movie: a screen on the garage's east wall playing a looping film, a projector behind where people stand, and its beam. Only while it shows. */
function Movie({ sim, screen }: { sim: React.MutableRefObject<LifeSim | null>; screen: LifeScreen }) {
  const mc = useApp((s) => s.engine.life.movie);
  const group = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  const canvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 384;
    c.height = 216;
    return c;
  }, []);
  const tex = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [canvas]);
  useEffect(() => () => tex.dispose(), [tex]);
  const last = useRef(-1);
  const centerZ = screen.bottom + screen.height / 2;
  const lens = useMemo(() => new THREE.Vector3(screen.projector[0] - 0.55, screen.projector[1], mc.projectorHeightFt), [screen, mc]);
  const target = useMemo(() => new THREE.Vector3(screen.x + 0.06, screen.y, centerZ), [screen, centerZ]);
  const beam = useMemo(() => {
    const dir = lens.clone().sub(target);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    return { len, q, mid: lens.clone().add(target).multiplyScalar(0.5), radius: Math.hypot(screen.width, screen.height) / 2 };
  }, [lens, target, screen]);
  useFrame(({ clock }) => {
    const on = !!sim.current?.movieOn;
    if (group.current) group.current.visible = on;
    if (!on) return;
    const t = clock.elapsedTime;
    if (t - last.current < 0.1) return;
    last.current = t;
    const tint = partyState.greeting ? paintBirthday(canvas, t, partyState.greeting) : paintFilm(canvas, t);
    tex.needsUpdate = true;
    if (light.current) {
      light.current.color.set(tint);
      light.current.intensity = 2.4 + Math.sin(t * 9) * 0.25 + Math.sin(t * 3.1) * 0.2;
    }
  });
  return (
    <group ref={group} visible={false} {...noHit}>
      <mesh {...noHit} position={[screen.x + 0.06, screen.y, centerZ]} rotation={new THREE.Euler(Math.PI / 2, 0, Math.PI / 2, 'ZYX')}>
        <planeGeometry args={[screen.width, screen.height]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      <pointLight ref={light} position={[screen.x + 4, screen.y, centerZ]} distance={26} decay={1.6} intensity={2.4} />
      {/* The projector on a tripod, aimed at the screen, and its beam. */}
      <group position={[screen.projector[0], screen.projector[1], 0]}>
        {[0, 1, 2].map((i) => {
          const a = (i / 3) * Math.PI * 2 + 0.4;
          return (
            <mesh key={i} {...noHit} position={[Math.cos(a) * 0.45, Math.sin(a) * 0.45, mc.projectorHeightFt / 2 - 0.2]} rotation={[Math.sin(a) * 0.17, -Math.cos(a) * 0.17, 0]}>
              <cylinderGeometry args={[0.03, 0.03, mc.projectorHeightFt - 0.2, 5]} />
              <meshStandardMaterial color="#1f1f22" />
            </mesh>
          );
        }).map((m) => m)}
        <mesh {...noHit} position={[0, 0, mc.projectorHeightFt]} castShadow>
          <boxGeometry args={[1.0, 0.6, 0.38]} />
          <meshStandardMaterial color="#2b2b30" />
        </mesh>
        <mesh {...noHit} position={[-0.58, 0, mc.projectorHeightFt]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.13, 0.15, 0.2, 10]} />
          <meshStandardMaterial color="#111114" emissive="#9ecbff" emissiveIntensity={1.2} />
        </mesh>
      </group>
      <mesh {...noHit} position={beam.mid} quaternion={beam.q}>
        <coneGeometry args={[beam.radius, beam.len, 20, 1, true]} />
        <meshBasicMaterial color="#bcd7ff" transparent opacity={0.05} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

const BUTTERFLY_COLORS = ['#e8761c', '#f2d230', '#4f7fd6', '#f4f1ea'];

/** A hummingbird: a small green body with a dark head, a long bill, a red throat and two wings beating too fast to see. */
function Hummingbirds({ crit }: { crit: React.MutableRefObject<CritterSim | null> }) {
  const c = useApp((s) => s.engine.life.critters.hummer);
  const groups = useRef<(THREE.Group | null)[]>([]);
  const wings = useRef<{ l: THREE.Mesh | null; r: THREE.Mesh | null }[]>([]);
  const u = c.bodyFt / 0.42;
  useFrame(({ clock }) => {
    const sim = crit.current;
    if (!sim) return;
    sim.hummers.forEach((h, i) => {
      const g = groups.current[i];
      if (!g) return;
      g.visible = h.vis > 0.02;
      if (!g.visible) return;
      g.position.set(h.x, h.y, h.z);
      g.rotation.z = h.heading;
      g.rotation.y = h.state === 'feed' ? -0.5 : -0.1; // hovering with the tail down, nose up
      g.scale.setScalar(h.vis);
      const beat = Math.sin(clock.elapsedTime * c.flapHz + h.phase) * 1.0;
      const w = wings.current[i];
      if (w?.l) w.l.rotation.x = 0.4 + beat;
      if (w?.r) w.r.rotation.x = -0.4 - beat;
    });
  });
  return (
    <group {...noHit}>
      {Array.from({ length: c.max }, (_, i) => (
        <group key={i} ref={(g) => { groups.current[i] = g; }} visible={false} {...noHit} scale={u}>
          <mesh {...noHit} scale={[0.22, 0.09, 0.09]} castShadow>
            <sphereGeometry args={[1, 10, 8]} />
            <meshStandardMaterial color="#2f8f4a" />
          </mesh>
          <mesh {...noHit} position={[0.2, 0, 0.02]}>
            <sphereGeometry args={[0.075, 10, 8]} />
            <meshStandardMaterial color="#1f5a35" />
          </mesh>
          <mesh {...noHit} position={[0.2, 0, -0.04]} scale={[1, 0.8, 0.7]}>
            <sphereGeometry args={[0.05, 8, 6]} />
            <meshStandardMaterial color="#c2185b" />
          </mesh>
          <mesh {...noHit} position={[0.36, 0, 0.02]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.008, 0.012, 0.2, 5]} />
            <meshStandardMaterial color="#222" />
          </mesh>
          <mesh {...noHit} position={[-0.26, 0, -0.03]} scale={[0.12, 0.05, 0.015]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="#1f5a35" />
          </mesh>
          {[1, -1].map((side) => (
            <mesh key={side} {...noHit} ref={(m) => { wings.current[i] = { ...(wings.current[i] ?? { l: null, r: null }), [side === 1 ? 'l' : 'r']: m }; }} position={[0, side * 0.08, 0.04]}>
              <boxGeometry args={[0.12, 0.3, 0.008]} />
              <meshStandardMaterial color="#5c6f63" transparent opacity={0.55} side={THREE.DoubleSide} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** A butterfly: a slim body and four wings of one color that flap fast in the air and slowly, held open, on a flower. */
function Butterflies({ crit }: { crit: React.MutableRefObject<CritterSim | null> }) {
  const c = useApp((s) => s.engine.life.critters.butterfly);
  const groups = useRef<(THREE.Group | null)[]>([]);
  const wings = useRef<{ l: THREE.Group | null; r: THREE.Group | null }[]>([]);
  const wing = useMemo(() => {
    // A rounded wing hinged at one edge, the front lobe bigger than the back.
    const sh = new THREE.Shape();
    sh.moveTo(0, 0);
    sh.bezierCurveTo(0.05, 0.28, 0.4, 0.3, 0.42, 0.1);
    sh.bezierCurveTo(0.44, -0.04, 0.3, -0.08, 0.22, -0.02);
    sh.bezierCurveTo(0.24, -0.2, 0.08, -0.26, 0, 0);
    return new THREE.ShapeGeometry(sh);
  }, []);
  useEffect(() => () => wing.dispose(), [wing]);
  useFrame(({ clock }) => {
    const sim = crit.current;
    if (!sim) return;
    sim.butterflies.forEach((b, i) => {
      const g = groups.current[i];
      if (!g) return;
      g.visible = b.vis > 0.02;
      if (!g.visible) return;
      g.position.set(b.x, b.y, b.z);
      g.rotation.z = b.heading;
      g.scale.setScalar(b.vis * (c.wingFt / 0.5));
      // In the air the wings beat quickly through a wide arc; settled, they open and close slowly.
      const t = clock.elapsedTime;
      const flap = b.state === 'land' ? 0.55 + Math.sin(t * 0.9 + b.phase) * 0.35 : 0.15 + (0.5 + 0.5 * Math.sin(t * b.flapHz * 2 + b.phase)) * 1.1;
      const w = wings.current[i];
      if (w?.l) w.l.rotation.x = flap;
      if (w?.r) w.r.rotation.x = -flap;
    });
  });
  return (
    <group {...noHit}>
      {Array.from({ length: c.max }, (_, i) => {
        const color = BUTTERFLY_COLORS[i % BUTTERFLY_COLORS.length];
        return (
          <group key={i} ref={(g) => { groups.current[i] = g; }} visible={false} {...noHit}>
            <mesh {...noHit} scale={[0.17, 0.025, 0.025]}>
              <sphereGeometry args={[1, 8, 6]} />
              <meshStandardMaterial color="#2a2018" />
            </mesh>
            {[1, -1].map((side) => (
              <group key={side} ref={(g) => { wings.current[i] = { ...(wings.current[i] ?? { l: null, r: null }), [side === 1 ? 'l' : 'r']: g }; }}>
                <mesh {...noHit} geometry={wing} rotation={[0, 0, 0]} scale={[1, side, 1]} position={[-0.08, 0, 0]}>
                  <meshStandardMaterial color={color} side={THREE.DoubleSide} roughness={0.7} />
                </mesh>
              </group>
            ))}
          </group>
        );
      })}
    </group>
  );
}

/** Worms: short pink segmented bodies that rise out of the soil, lie on the surface wriggling, and sink back. */
function Worms({ crit }: { crit: React.MutableRefObject<CritterSim | null> }) {
  const c = useApp((s) => s.engine.life.critters.worms);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const capacity = c.max * c.segments;
  useFrame(({ clock }) => {
    const m = mesh.current;
    const sim = crit.current;
    if (!m || !sim) return;
    const t = clock.elapsedTime;
    let n = 0;
    for (const w of sim.worms) {
      if (w.ext < 0.03) continue;
      const len = c.lengthFt * w.ext;
      const cos = Math.cos(w.heading), sin = Math.sin(w.heading);
      for (let s = 0; s < c.segments; s++) {
        const u = s / (c.segments - 1) - 0.5;
        const wig = Math.sin(w.phase + t * c.wiggleHz * Math.PI * 2 + u * 5) * 0.045 * w.ext;
        dummy.position.set(w.x + cos * u * len - sin * wig, w.y + sin * u * len + cos * wig, 0.13 + c.thickFt * 0.4 - (1 - w.ext) * 0.1);
        const k = c.thickFt * (s === 0 || s === c.segments - 1 ? 0.8 : 1);
        dummy.scale.set(k * 1.5, k, k);
        dummy.rotation.set(0, 0, w.heading);
        dummy.updateMatrix();
        m.setMatrixAt(n++, dummy.matrix);
      }
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, capacity]} frustumCulled={false} {...noHit}>
      <sphereGeometry args={[1, 8, 6]} />
      <meshStandardMaterial color="#d08a84" roughness={0.6} />
    </instancedMesh>
  );
}

/** Bunches of balloons tied outside every door on a birthday: a weight on the ground, strings fanning up, balloons swaying in the air. */
function Balloons({ list }: { list: BalloonBunch[] }) {
  const cfg = useApp((s) => s.engine.birthday.balloons);
  const root = useRef<THREE.Group>(null);
  const pivots = useRef<(THREE.Group | null)[]>([]);
  const flat = useMemo(() => list.flatMap((b) => b.balloons), [list]);
  useFrame(({ clock }) => {
    if (root.current) root.current.visible = partyState.balloons;
    if (!partyState.balloons) return;
    const t = clock.elapsedTime;
    flat.forEach((b, i) => {
      const g = pivots.current[i];
      if (!g) return;
      const sway = cfg.swayFt / b.length;
      g.rotation.x = b.lean[0] + Math.sin(t * 0.9 + b.phase) * sway;
      g.rotation.y = b.lean[1] + Math.cos(t * 0.7 + b.phase * 1.3) * sway;
    });
  });
  let n = 0;
  return (
    <group ref={root} visible={false} {...noHit}>
      {list.map((bunch, bi) => (
        <group key={bi} position={[bunch.x, bunch.y, 0.13]} {...noHit}>
          <mesh {...noHit} position={[0, 0, 0.1]} castShadow>
            <boxGeometry args={[0.28, 0.28, 0.2]} />
            <meshStandardMaterial color="#6b6b70" />
          </mesh>
          {bunch.balloons.map((b, k) => {
            const idx = n++;
            return (
              <group key={k} ref={(g) => { pivots.current[idx] = g; }} position={[0, 0, 0.2]} {...noHit}>
                <mesh {...noHit} position={[0, 0, b.length / 2]} rotation={[Math.PI / 2, 0, 0]}>
                  <cylinderGeometry args={[0.008, 0.008, b.length, 4]} />
                  <meshStandardMaterial color="#e8e8e8" />
                </mesh>
                <mesh {...noHit} position={[0, 0, b.length + cfg.sizeFt * 0.55]} scale={[cfg.sizeFt / 2, cfg.sizeFt / 2, cfg.sizeFt * 0.6]} castShadow>
                  <sphereGeometry args={[1, 14, 10]} />
                  <meshStandardMaterial color={b.color} roughness={0.25} metalness={0.05} />
                </mesh>
                <mesh {...noHit} position={[0, 0, b.length - 0.02]} rotation={[Math.PI / 2, 0, 0]}>
                  <coneGeometry args={[0.05, 0.1, 6]} />
                  <meshStandardMaterial color={b.color} />
                </mesh>
              </group>
            );
          })}
        </group>
      ))}
    </group>
  );
}

/** Wrapped presents lying about the yard: a box, ribbon crossed over it and a bow. They are there from the start of the party until night. */
function Presents({ list }: { list: Present[] }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    if (group.current) group.current.visible = partyState.presents;
  });
  return (
    <group ref={group} visible={false} {...noHit}>
      {list.map((p, i) => (
        <group key={i} position={[p.x, p.y, 0.13]} rotation={[0, 0, p.yaw]} {...noHit}>
          <mesh {...noHit} position={[0, 0, p.height / 2]} castShadow>
            <boxGeometry args={[p.size, p.size, p.height]} />
            <meshStandardMaterial color={p.color} roughness={0.6} />
          </mesh>
          <mesh {...noHit} position={[0, 0, p.height / 2]}>
            <boxGeometry args={[p.size * 1.02, p.size * 0.16, p.height * 1.02]} />
            <meshStandardMaterial color={p.ribbon} />
          </mesh>
          <mesh {...noHit} position={[0, 0, p.height / 2]}>
            <boxGeometry args={[p.size * 0.16, p.size * 1.02, p.height * 1.02]} />
            <meshStandardMaterial color={p.ribbon} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh key={side} {...noHit} position={[0, side * p.size * 0.12, p.height + p.size * 0.1]} scale={[1, 1.5, 0.8]}>
              <sphereGeometry args={[p.size * 0.11, 8, 6]} />
              <meshStandardMaterial color={p.ribbon} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** The native birds: a pool of small birds, each wearing the colors of whichever species its slot is playing, flapping in flight and folded at rest. */
function Birds({ crit }: { crit: React.MutableRefObject<CritterSim | null> }) {
  const bc = useApp((s) => s.engine.life.critters.birds);
  const groups = useRef<(THREE.Group | null)[]>([]);
  const parts = useRef<{ body: THREE.MeshStandardMaterial | null; belly: THREE.MeshStandardMaterial | null; accent: THREE.MeshStandardMaterial | null; wingL: THREE.Mesh | null; wingR: THREE.Mesh | null; tail: THREE.Mesh | null; shown: string | null }[]>([]);
  const byId = useMemo(() => new Map(bc.species.map((sp) => [sp.id, sp])), [bc]);
  useFrame(({ clock }) => {
    const sim = crit.current;
    if (!sim) return;
    const t = clock.elapsedTime;
    sim.birds.forEach((b, i) => {
      const g = groups.current[i];
      const p = parts.current[i];
      if (!g || !p) return;
      const sp = b.species ? byId.get(b.species) : undefined;
      g.visible = !!sp && b.vis > 0.02;
      if (!g.visible || !sp) return;
      if (p.shown !== sp.id) {
        p.shown = sp.id;
        p.body?.color.set(sp.body);
        p.belly?.color.set(sp.belly);
        p.accent?.color.set(sp.accent);
      }
      g.position.set(b.x, b.y, b.z + sp.sizeFt * 0.2);
      g.rotation.z = b.heading;
      g.scale.setScalar(sp.sizeFt * b.vis);
      const flying = b.state === 'fly';
      const beat = flying ? Math.sin(t * 34 + b.phase) * 1.0 : 0;
      if (p.wingL) p.wingL.rotation.x = flying ? 0.5 + beat : 1.35;
      if (p.wingR) p.wingR.rotation.x = flying ? -0.5 - beat : -1.35;
      g.rotation.y = flying ? 0.05 : b.state === 'forage' ? 0.25 : -0.15; // head down to feed, upright on a perch
    });
  });
  return (
    <group {...noHit}>
      {Array.from({ length: bc.max }, (_, i) => (
        <group key={i} ref={(g) => { groups.current[i] = g; }} visible={false} {...noHit}>
          <mesh {...noHit} scale={[0.5, 0.26, 0.26]} castShadow>
            <sphereGeometry args={[1, 10, 8]} />
            <meshStandardMaterial ref={(m) => { parts.current[i] = { ...(parts.current[i] ?? { body: null, belly: null, accent: null, wingL: null, wingR: null, tail: null, shown: null }), body: m }; }} color="#888" />
          </mesh>
          <mesh {...noHit} position={[0, 0, -0.08]} scale={[0.42, 0.21, 0.17]}>
            <sphereGeometry args={[1, 10, 8]} />
            <meshStandardMaterial ref={(m) => { parts.current[i] = { ...(parts.current[i] ?? { body: null, belly: null, accent: null, wingL: null, wingR: null, tail: null, shown: null }), belly: m }; }} color="#bbb" />
          </mesh>
          <mesh {...noHit} position={[0.5, 0, 0.1]}>
            <sphereGeometry args={[0.2, 10, 8]} />
            <meshStandardMaterial color="#777" ref={(m) => { parts.current[i] = { ...(parts.current[i] ?? { body: null, belly: null, accent: null, wingL: null, wingR: null, tail: null, shown: null }), accent: m }; }} />
          </mesh>
          <mesh {...noHit} position={[0.72, 0, 0.09]} rotation={[0, 0, -Math.PI / 2]}>
            <coneGeometry args={[0.06, 0.2, 6]} />
            <meshStandardMaterial color="#d49b3a" />
          </mesh>
          <mesh {...noHit} position={[-0.62, 0, 0.0]} scale={[0.34, 0.12, 0.03]} ref={(m) => { parts.current[i] = { ...(parts.current[i] ?? { body: null, belly: null, accent: null, wingL: null, wingR: null, tail: null, shown: null }), tail: m }; }}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="#55504a" />
          </mesh>
          {[1, -1].map((side) => (
            <mesh key={side} {...noHit} position={[0, side * 0.2, 0.12]} ref={(m) => { parts.current[i] = { ...(parts.current[i] ?? { body: null, belly: null, accent: null, wingL: null, wingR: null, tail: null, shown: null }), [side === 1 ? 'wingL' : 'wingR']: m }; }}>
              <boxGeometry args={[0.45, 0.5, 0.025]} />
              <meshStandardMaterial color="#6d6358" side={THREE.DoubleSide} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** Four stacked hive boxes on a stand, under a lid, with a slot for the bees at the front. */
function Hive({ world }: { world: LifeWorld }) {
  const boxes = useApp((s) => s.engine.life.bees.hive.boxes);
  const selected = useApp((s) => s.hiveSelected);
  const edit = useApp((s) => s.mode === 'edit');
  const tool = useApp((s) => s.drawing || s.placingSpeciesId || s.measureActive);
  const selectHive = useApp((s) => s.selectHive);
  const setHiveDragging = useApp((s) => s.setHiveDragging);
  const beginGesture = useApp((s) => s.beginGesture);
  const controls = useThree((st) => st.controls) as unknown as { enabled: boolean } | null;
  const moveHive = useApp((s) => s.moveHive);
  const ownerHive = useApp((s) => s.hive);
  const hive = world.hive!;
  // Taking hold of a hive the app placed makes its spot the owner's, so it can then be moved from where it stands.
  const pin = () => {
    if (!ownerHive && edit) moveHive([hive.x, hive.y]);
  };
  // A drag ends wherever the pointer is released, and the camera comes back.
  useEffect(() => {
    const up = () => {
      setHiveDragging(false);
      if (controls) controls.enabled = true;
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [controls, setHiveDragging]);
  // The entrance faces into the yard, away from the nearest lot edge.
  const facing = Math.atan2(world.lot.depth / 2 - hive.y, world.lot.width / 2 - hive.x);
  const boxH = 0.8, standH = 0.9;
  return (
    <group position={[hive.x, hive.y, 0]} rotation={[0, 0, facing]} {...noHit}>
      {/* An invisible column over the hive to click and drag it by. */}
      <mesh
        position={[0, 0, (standH + boxes * boxH) / 2 + 0.2]}
        rotation={[Math.PI / 2, 0, 0]}
        onClick={(e) => {
          if (tool || e.delta > 3) return;
          e.stopPropagation();
          selectHive(true);
          pin();
        }}
        onPointerDown={(e) => {
          if (tool || !edit) return;
          e.stopPropagation();
          selectHive(true);
          beginGesture();
          pin();
          setHiveDragging(true);
          if (controls) controls.enabled = false;
        }}
      >
        <cylinderGeometry args={[1.5, 1.5, standH + boxes * boxH + 0.6, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {selected && (
        <mesh {...noHit} position={[0, 0, 0.05]} renderOrder={5}>
          <ringGeometry args={[1.5, 1.68, 40]} />
          <meshBasicMaterial color="#2563eb" transparent opacity={0.9} depthTest={false} />
        </mesh>
      )}
      {[0.55, -0.55].map((y) => (
        <mesh key={y} {...noHit} position={[0, y, standH / 2]} castShadow receiveShadow>
          <boxGeometry args={[1.8, 0.35, standH]} />
          <meshStandardMaterial color="#8d8a84" />
        </mesh>
      ))}
      <mesh {...noHit} position={[0.1, 0, standH + 0.05]} castShadow>
        <boxGeometry args={[1.95, 1.5, 0.1]} />
        <meshStandardMaterial color="#7a5c3a" />
      </mesh>
      {Array.from({ length: boxes }, (_, n) => (
        <mesh key={n} {...noHit} position={[0, 0, standH + 0.1 + boxH / 2 + n * boxH]} castShadow receiveShadow>
          <boxGeometry args={[1.66, 1.35, boxH - 0.02]} />
          <meshStandardMaterial color={n % 2 === 0 ? '#f1ead8' : '#e3d4ac'} />
        </mesh>
      ))}
      <mesh {...noHit} position={[0.84, 0, standH + 0.16]}>
        <boxGeometry args={[0.04, 0.9, 0.1]} />
        <meshStandardMaterial color="#1b1410" />
      </mesh>
      <mesh {...noHit} position={[1.0, 0, standH + 0.07]}>
        <boxGeometry args={[0.34, 1.0, 0.04]} />
        <meshStandardMaterial color="#7a5c3a" />
      </mesh>
      <mesh {...noHit} position={[0, 0, standH + 0.1 + boxes * boxH + 0.09]} castShadow>
        <boxGeometry args={[1.82, 1.52, 0.18]} />
        <meshStandardMaterial color="#9aa3a8" />
      </mesh>
    </group>
  );
}

/** The bees, drawn as one instanced mesh; bees resting inside the hive are shrunk to nothing. */
function Bees({ sim, count }: { sim: React.MutableRefObject<LifeSim | null>; count: number }) {
  const size = useApp((s) => s.engine.life.bees.displayFt);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const geometry = useMemo(() => beeGeometry(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => {
    if (mesh.current) mesh.current.count = count;
  }, [count]);
  useFrame(() => {
    const m = mesh.current;
    const bees = sim.current?.bees;
    if (!m || !bees) return;
    for (let i = 0; i < count; i++) {
      const b = bees[i];
      if (!b || b.phase === 'rest') dummy.scale.set(0, 0, 0);
      else {
        dummy.position.set(b.x, b.y, b.z);
        dummy.scale.set(size, size, size);
        dummy.rotation.set(0, 0, b.heading);
      }
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false} {...noHit}>
      <primitive object={geometry} attach="geometry" />
      <meshStandardMaterial vertexColors roughness={0.55} />
    </instancedMesh>
  );
}

/**
 * People, dogs and bees moving about the yard (a layer, off by default). The simulation lives in engine/life.ts;
 * this only draws it, and updates the walking world when plants grow or the hardscape changes.
 */
export function LifeLayer() {
  const site = useApp((s) => s.site);
  const aduEnabled = useApp((s) => s.aduEnabled);
  const hardscape = useApp((s) => s.hardscape);
  const materials = useApp((s) => s.materials);
  const engine = useApp((s) => s.engine);
  const doy = useApp((s) => s.doy);
  const settings = useApp((s) => s.lifeSettings);
  const minutes = useApp((s) => s.minutes);
  const ownerHive = useApp((s) => s.hive);
  const plants = usePlaced();
  const [month, dayOfMonth] = doyToMonthDay(doy);
  const structures = useMemo(() => activeStructures(site, { aduEnabled }), [site, aduEnabled]);
  // Whose birthday it is on this date, if anyone's, and when the party starts and ends around sunset.
  const bday = useMemo(() => birthdayDay(site, engine, month, dayOfMonth), [site, engine, month, dayOfMonth]);
  const hive = useRef<{ x: number; y: number } | null>(null);
  // The growing-season sun map takes about a second to work out, so it is computed once a moment after the yard first
  // appears; butterflies and worms use it once it is there.
  const [sunMap, setSunMap] = useState<SunMap | undefined>(undefined);
  useEffect(() => {
    const id = setTimeout(() => setSunMap(sunMapFor(site, aduEnabled)), 300);
    return () => clearTimeout(id);
  }, [site, aduEnabled]);
  // The white sedan is home on weekday evenings and nights, at the street end of the driveway (if there is one).
  const sedanSpot = useMemo(() => sedanSpotFor(hardscape, (e) => footprint(e, engine.hardscape), engine.vehicle), [hardscape, engine]);
  const sedanHomeNow = sedanHome(engine.referenceYear, month, dayOfMonth, minutes, engine.vehicle);
  const sedan = sedanHomeNow ? sedanSpot : null;
  const sedanKey = sedan ? `${sedan.center[0]},${sedan.center[1]}` : '';
  const world = useMemo(() => {
    const w = buildLifeWorld({ site, structures, hardscape, materials, plants, month, engine, sedan, hive: hive.current, hiveAt: ownerHive ? { x: ownerHive[0], y: ownerHive[1] } : null, sunMap });
    hive.current = w.hive;
    return w;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, structures, hardscape, materials, plants, month, engine, ownerHive, sunMap, sedanKey]);
  const sim = useRef<LifeSim | null>(null);
  const crit = useRef<CritterSim | null>(null);
  if (!sim.current) sim.current = new LifeSim(world, engine.life, Math.floor(Math.random() * 1e9), { people: settings.people, dogs: settings.dogs, bees: settings.bees }, engine.anatomy);
  if (!crit.current) crit.current = new CritterSim(world, engine.life.critters, Math.floor(Math.random() * 1e9));
  useEffect(() => {
    sim.current?.setWorld(world);
    crit.current?.setWorld(world);
  }, [world]);
  // The time of day decides whether the movie is on; the sim also needs it the moment it is created.
  useEffect(() => {
    sim.current?.setBirthday(bday);
    sim.current?.setFireworksDay(fireworksDay(month, dayOfMonth, engine.life.fireworks));
    sim.current?.setClock(minutes);
    const nc = engine.life.night;
    crit.current?.setClock({ minutes, night: minutes >= nc.startMin || minutes < nc.endMin });
  }, [minutes, world, engine, bday, month, dayOfMonth]);
  useEffect(() => {
    sim.current?.setCounts({ people: settings.people, dogs: settings.dogs, bees: settings.bees });
  }, [settings.people, settings.dogs, settings.bees]);
  // In development the simulation is on `window.__life`, for inspecting it from the console.
  if (import.meta.env.DEV) {
    (window as unknown as { __life?: LifeSim | null }).__life = sim.current;
    (window as unknown as { __crit?: CritterSim | null }).__crit = crit.current;
  }
  useFrame((_, dt) => {
    const sm = sim.current;
    if (!sm) return;
    sm.step(Math.min(dt, 0.25));
    crit.current?.step(Math.min(dt, 0.25));
    // Chairs are drawn by their tables; hand them how far each is pulled out.
    sm.chairs.forEach((v, k) => chairPull.set(k, v));
    partyState.cake = sm.cake;
    partyState.presents = sm.presentsOut;
    partyState.balloons = sm.balloonsOut;
    partyState.greeting = sm.birthday && sm.movieOn ? greeting(sm.birthday.names) : null;
  });
  const presents = useMemo(() => {
    if (!bday) return [];
    const yard = site.zones.filter((z) => z.id === engine.birthday.zone).map((z) => z.polygon);
    return presentSpots(world, engine.birthday, month * 100 + dayOfMonth, yard);
  }, [bday, world, engine, site, month, dayOfMonth]);
  const balloons = useMemo(() => (bday ? balloonBunches(site, structures, engine.birthday, month * 100 + dayOfMonth) : []), [bday, site, structures, engine, month, dayOfMonth]);
  const people = Math.min(engine.life.people.max, settings.people);
  const dogs = Math.min(engine.life.dogs.max, settings.dogs);
  return (
    <group {...noHit}>
      {Array.from({ length: people }, (_, i) => <Person key={`p${i}`} sim={sim} index={i} />)}
      {Array.from({ length: dogs }, (_, i) => <Dog key={`d${i}`} sim={sim} index={people + i} />)}
      {presents.length > 0 && <Presents list={presents} />}
      {balloons.length > 0 && <Balloons list={balloons} />}
      <FruitFlights sim={sim} />
      <Birds crit={crit} />
      <Hummingbirds crit={crit} />
      <Butterflies crit={crit} />
      <Worms crit={crit} />
      {world.screen && <Movie sim={sim} screen={world.screen} />}
      {sedan && <Sedan spot={sedan} color={engine.vehicle.color} />}
      <Fireworks sim={sim} lot={world.lot} />
      {settings.bees && world.hive && <Hive world={world} />}
      {settings.bees && world.hive && <Bees sim={sim} count={engine.life.bees.count} />}
    </group>
  );
}
