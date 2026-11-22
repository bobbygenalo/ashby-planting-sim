import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { buildLifeWorld, isInside, LifeSim, type LifeScreen, type LifeWorld } from '../engine/life';
import { activeStructures } from '../engine/site';
import { doyToMonthDay } from '../engine/time';
import { usePlaced } from '../store/derived';
import { useApp } from '../store/store';
import { beeGeometry, personProportions } from './forms';
import { chairPull } from './chairState';

/** Nothing here should catch a click meant for the ground or a plant. */
const noHit = { raycast: () => null } as const;

const SHIRTS = ['#c0392b', '#2e86c1', '#27ae60', '#f39c12', '#8e44ad', '#16a085', '#d35400', '#34495e'];
const PANTS = ['#2c3e50', '#4a4a4a', '#5d4037', '#1f3a5f', '#6b705c'];
const SKIN = ['#f1c9a5', '#d9a577', '#b07a4f', '#8a5a3a', '#f5d7bd'];
const COATS = ['#a0693a', '#2b2b2b', '#d8b46a', '#ececec', '#7a5a3c'];

/** A person in site coordinates: facing +X, Z up, legs and arms swinging as they walk. Built to their age and height. They sit, talk and watch too. */
function Person({ sim, index }: { sim: React.MutableRefObject<LifeSim | null>; index: number }) {
  const root = useRef<THREE.Group>(null);
  const legs = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const knees = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const arms = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const dots = [useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null)];
  const who = sim.current?.walkers[index];
  const variant = who?.variant ?? index;
  const f = useMemo(() => personProportions(who?.age ?? 30, who?.heightFt ?? 5.6), [who?.age, who?.heightFt]);
  const look = useMemo(() => ({ shirt: SHIRTS[variant % SHIRTS.length], pants: PANTS[(variant >> 2) % PANTS.length], skin: SKIN[(variant >> 4) % SKIN.length] }), [variant]);
  // Sitting: the hips come down to the chair, the thighs go forward and the shins drop back to the ground.
  const seatHipZ = 1.65;
  const drop = Math.max(0, f.legH - seatHipZ);
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
    const t = clock.elapsedTime;
    const sit = w.sit;
    const swing = Math.sin(w.gait) * 0.7 * Math.min(1, w.speed / 2) * (1 - sit);
    const hip = -sit * (Math.PI / 2);
    legs[0].current?.rotation.set(0, swing + hip, 0);
    legs[1].current?.rotation.set(0, -swing + hip, 0);
    knees[0].current?.rotation.set(0, sit * (Math.PI / 2), 0);
    knees[1].current?.rotation.set(0, sit * (Math.PI / 2), 0);
    // Arms swing as they walk; a speaker gestures with both hands, a seated listener rests theirs forward.
    const gesture = w.talking ? -0.9 - Math.sin(t * 5.5) * 0.35 : 0;
    const rest = sit * -0.5;
    arms[0].current?.rotation.set(0, -swing * 0.8 + gesture + rest, 0);
    arms[1].current?.rotation.set(0, swing * 0.8 + (w.talking ? -0.9 - Math.sin(t * 5.5 + 1.7) * 0.35 : 0) + rest, 0);
    if (body.current) body.current.position.z = Math.abs(Math.sin(w.gait)) * 0.011 * f.height * Math.min(1, w.speed / 2) - drop * sit;
    if (head.current) {
      head.current.rotation.z = w.headTurn;
      head.current.rotation.y = w.talking ? Math.sin(t * 7) * 0.07 : 0;
    }
    // Three dots over the head of whoever is talking, rising and falling in turn.
    dots.forEach((d, n) => {
      const m = d.current;
      if (!m) return;
      m.visible = w.talking;
      if (w.talking) m.scale.setScalar(0.55 + 0.45 * Math.max(0, Math.sin(t * 6 - n * 0.9)));
    });
  });
  return (
    <group ref={root} {...noHit}>
      <group ref={body}>
        {[1, -1].map((side, n) => (
          <group key={side} ref={legs[n]} position={[0, side * f.hipY, f.legH]}>
            <mesh {...noHit} position={[0, 0, -f.legH / 4]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[f.legR, f.legR * 0.92, f.legH / 2, 8]} />
              <meshStandardMaterial color={look.pants} />
            </mesh>
            <group ref={knees[n]} position={[0, 0, -f.legH / 2]}>
              <mesh {...noHit} position={[0, 0, -f.legH / 4]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                <cylinderGeometry args={[f.legR * 0.92, f.legR * 0.82, f.legH / 2, 8]} />
                <meshStandardMaterial color={look.pants} />
              </mesh>
            </group>
          </group>
        ))}
        <mesh {...noHit} position={[0, 0, f.legH + f.torsoH / 2]} castShadow>
          <boxGeometry args={[f.torsoD, f.torsoW, f.torsoH]} />
          <meshStandardMaterial color={look.shirt} />
        </mesh>
        {[1, -1].map((side, n) => (
          <group key={side} ref={arms[n]} position={[0, side * f.shoulderY, f.legH + f.torsoH - f.armR * 1.2]}>
            <mesh {...noHit} position={[0, 0, -f.armL / 2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[f.armR, f.armR * 0.85, f.armL, 8]} />
              <meshStandardMaterial color={look.skin} />
            </mesh>
          </group>
        ))}
        <group ref={head} position={[0, 0, f.legH + f.torsoH]}>
          <mesh {...noHit} position={[0, 0, f.headR * 0.95]} castShadow>
            <sphereGeometry args={[f.headR, 14, 10]} />
            <meshStandardMaterial color={look.skin} />
          </mesh>
          {/* A small nose so a turned head reads as looking somewhere. */}
          <mesh {...noHit} position={[f.headR * 0.95, 0, f.headR * 0.95]}>
            <sphereGeometry args={[f.headR * 0.22, 8, 6]} />
            <meshStandardMaterial color={look.skin} />
          </mesh>
        </group>
        {dots.map((d, n) => (
          <mesh key={n} ref={d} {...noHit} visible={false} position={[0, (n - 1) * f.headR * 0.9, f.legH + f.torsoH + f.headR * 2.7]}>
            <sphereGeometry args={[f.headR * 0.28, 8, 6]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        ))}
      </group>
    </group>
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

/** The evening movie: a screen on the garage's east wall playing a looping film, a projector behind where people stand, and its beam. Only while it shows. */
function Movie({ sim, screen }: { sim: React.MutableRefObject<LifeSim | null>; screen: LifeScreen }) {
  const mc = useApp((s) => s.engine.life.movie);
  const group = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  const canvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 192;
    c.height = 108;
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
    const tint = paintFilm(canvas, t);
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
  const month = doyToMonthDay(doy)[0];
  const structures = useMemo(() => activeStructures(site, { aduEnabled }), [site, aduEnabled]);
  const hive = useRef<{ x: number; y: number } | null>(null);
  const world = useMemo(() => {
    const w = buildLifeWorld({ site, structures, hardscape, materials, plants, month, engine, hive: hive.current, hiveAt: ownerHive ? { x: ownerHive[0], y: ownerHive[1] } : null });
    hive.current = w.hive;
    return w;
  }, [site, structures, hardscape, materials, plants, month, engine, ownerHive]);
  const sim = useRef<LifeSim | null>(null);
  if (!sim.current) sim.current = new LifeSim(world, engine.life, Math.floor(Math.random() * 1e9), { people: settings.people, dogs: settings.dogs, bees: settings.bees });
  useEffect(() => {
    sim.current?.setWorld(world);
  }, [world]);
  // The time of day decides whether the movie is on; the sim also needs it the moment it is created.
  useEffect(() => {
    sim.current?.setClock(minutes);
  }, [minutes, world]);
  useEffect(() => {
    sim.current?.setCounts({ people: settings.people, dogs: settings.dogs, bees: settings.bees });
  }, [settings.people, settings.dogs, settings.bees]);
  // In development the simulation is on `window.__life`, for inspecting it from the console.
  if (import.meta.env.DEV) (window as unknown as { __life?: LifeSim | null }).__life = sim.current;
  useFrame((_, dt) => {
    const sm = sim.current;
    if (!sm) return;
    sm.step(Math.min(dt, 0.25));
    // Chairs are drawn by their tables; hand them how far each is pulled out.
    sm.chairs.forEach((v, k) => chairPull.set(k, v));
  });
  const people = Math.min(engine.life.people.max, settings.people);
  const dogs = Math.min(engine.life.dogs.max, settings.dogs);
  return (
    <group {...noHit}>
      {Array.from({ length: people }, (_, i) => <Person key={`p${i}`} sim={sim} index={i} />)}
      {Array.from({ length: dogs }, (_, i) => <Dog key={`d${i}`} sim={sim} index={people + i} />)}
      {world.screen && <Movie sim={sim} screen={world.screen} />}
      {settings.bees && world.hive && <Hive world={world} />}
      {settings.bees && world.hive && <Bees sim={sim} count={engine.life.bees.count} />}
    </group>
  );
}
