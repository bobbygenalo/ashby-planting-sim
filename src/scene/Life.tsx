import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { buildLifeWorld, LifeSim, type LifeWorld } from '../engine/life';
import { activeStructures } from '../engine/site';
import { doyToMonthDay } from '../engine/time';
import { usePlaced } from '../store/derived';
import { useApp } from '../store/store';

/** Nothing here should catch a click meant for the ground or a plant. */
const noHit = { raycast: () => null } as const;

const SHIRTS = ['#c0392b', '#2e86c1', '#27ae60', '#f39c12', '#8e44ad', '#16a085', '#d35400', '#34495e'];
const PANTS = ['#2c3e50', '#4a4a4a', '#5d4037', '#1f3a5f', '#6b705c'];
const SKIN = ['#f1c9a5', '#d9a577', '#b07a4f', '#8a5a3a', '#f5d7bd'];
const COATS = ['#a0693a', '#2b2b2b', '#d8b46a', '#ececec', '#7a5a3c'];

/** A person in site coordinates: facing +X, Z up, legs and arms swinging as they walk. */
function Person({ sim, index }: { sim: React.MutableRefObject<LifeSim | null>; index: number }) {
  const height = useApp((s) => s.engine.life.people.heightFt);
  const root = useRef<THREE.Group>(null);
  const legs = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const arms = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const body = useRef<THREE.Group>(null);
  const variant = sim.current?.walkers[index]?.variant ?? index;
  const look = useMemo(() => ({ shirt: SHIRTS[variant % SHIRTS.length], pants: PANTS[(variant >> 2) % PANTS.length], skin: SKIN[(variant >> 4) % SKIN.length] }), [variant]);
  const legH = 2.7, torsoH = 1.9;
  useFrame(() => {
    const w = sim.current?.walkers[index];
    const g = root.current;
    if (!g) return;
    if (!w) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.position.set(w.x, w.y, 0);
    g.rotation.z = w.heading;
    const swing = Math.sin(w.gait) * 0.7 * Math.min(1, w.speed / 2);
    legs[0].current?.rotation.set(0, swing, 0);
    legs[1].current?.rotation.set(0, -swing, 0);
    arms[0].current?.rotation.set(0, -swing * 0.8, 0);
    arms[1].current?.rotation.set(0, swing * 0.8, 0);
    if (body.current) body.current.position.z = Math.abs(Math.sin(w.gait)) * 0.06 * Math.min(1, w.speed / 2);
  });
  return (
    <group ref={root} scale={height / 5.6} {...noHit}>
      <group ref={body}>
        {[1, -1].map((side, n) => (
          <group key={side} ref={legs[n]} position={[0, side * 0.28, legH]}>
            <mesh {...noHit} position={[0, 0, -legH / 2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.17, 0.14, legH, 8]} />
              <meshStandardMaterial color={look.pants} />
            </mesh>
          </group>
        ))}
        <mesh {...noHit} position={[0, 0, legH + torsoH / 2]} castShadow>
          <boxGeometry args={[0.6, 1.3, torsoH]} />
          <meshStandardMaterial color={look.shirt} />
        </mesh>
        {[1, -1].map((side, n) => (
          <group key={side} ref={arms[n]} position={[0, side * 0.82, legH + torsoH - 0.15]}>
            <mesh {...noHit} position={[0, 0, -0.8]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.13, 0.11, 1.6, 8]} />
              <meshStandardMaterial color={look.skin} />
            </mesh>
          </group>
        ))}
        <mesh {...noHit} position={[0, 0, legH + torsoH + 0.33]} castShadow>
          <sphereGeometry args={[0.34, 14, 10]} />
          <meshStandardMaterial color={look.skin} />
        </mesh>
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
    g.visible = true;
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

/** Four stacked hive boxes on a stand, under a lid, with a slot for the bees at the front. */
function Hive({ world }: { world: LifeWorld }) {
  const boxes = useApp((s) => s.engine.life.bees.hive.boxes);
  const hive = world.hive!;
  // The entrance faces into the yard, away from the nearest lot edge.
  const facing = Math.atan2(world.lot.depth / 2 - hive.y, world.lot.width / 2 - hive.x);
  const boxH = 0.8, standH = 0.9;
  return (
    <group position={[hive.x, hive.y, 0]} rotation={[0, 0, facing]} {...noHit}>
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
        dummy.scale.set(size, size * 0.7, size * 0.7);
        dummy.rotation.set(0, 0, b.heading);
      }
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false} {...noHit}>
      <sphereGeometry args={[1, 8, 6]} />
      <meshStandardMaterial color="#ffc400" emissive="#7a5200" emissiveIntensity={0.6} />
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
  const plants = usePlaced();
  const month = doyToMonthDay(doy)[0];
  const structures = useMemo(() => activeStructures(site, { aduEnabled }), [site, aduEnabled]);
  const hive = useRef<{ x: number; y: number } | null>(null);
  const world = useMemo(() => {
    const w = buildLifeWorld({ site, structures, hardscape, materials, plants, month, engine, hive: hive.current });
    hive.current = w.hive;
    return w;
  }, [site, structures, hardscape, materials, plants, month, engine]);
  const sim = useRef<LifeSim | null>(null);
  if (!sim.current) sim.current = new LifeSim(world, engine.life, Math.floor(Math.random() * 1e9), { people: settings.people, dogs: settings.dogs, bees: settings.bees });
  useEffect(() => {
    sim.current?.setWorld(world);
  }, [world]);
  useEffect(() => {
    sim.current?.setCounts({ people: settings.people, dogs: settings.dogs, bees: settings.bees });
  }, [settings.people, settings.dogs, settings.bees]);
  // In development the simulation is on `window.__life`, for inspecting it from the console.
  if (import.meta.env.DEV) (window as unknown as { __life?: LifeSim | null }).__life = sim.current;
  useFrame((_, dt) => sim.current?.step(Math.min(dt, 0.25)));
  const people = Math.min(engine.life.people.max, settings.people);
  const dogs = Math.min(engine.life.dogs.max, settings.dogs);
  return (
    <group {...noHit}>
      {Array.from({ length: people }, (_, i) => <Person key={`p${i}`} sim={sim} index={i} />)}
      {Array.from({ length: dogs }, (_, i) => <Dog key={`d${i}`} sim={sim} index={people + i} />)}
      {settings.bees && world.hive && <Hive world={world} />}
      {settings.bees && world.hive && <Bees sim={sim} count={engine.life.bees.count} />}
    </group>
  );
}
