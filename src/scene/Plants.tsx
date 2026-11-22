import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlacedPlant } from '../engine/growth';
import { fruitPositions, fruitState, seedFromId } from '../engine/fruit';
import { isBlooming, isLeafOff, placedPlants } from '../engine/growth';
import { doyToMonthDay } from '../engine/time';
import { useApp } from '../store/store';
import { branchSkeleton, type Skeleton } from '../engine/branches';
import { branchGeometry } from './branchGeometry';
import { MIN_FORM_SIZE, partGeometry, plantParts } from './forms';
import { LeafDrop } from './LeafDrop';

// Spheres and domes are shared unit shapes that each plant scales; the rest are built per plant and thrown away with it.
const UNIT_ELLIPSOID = partGeometry({ shape: 'ellipsoid', material: 'foliage', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], args: [] });
const UNIT_DOME = partGeometry({ shape: 'dome', material: 'foliage', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], args: [] });

/** The bare branches of a leafless plant, shared by the branch drawing and the fruit that hangs from them. */
function useSkeleton(p: PlacedPlant, enabled: boolean): Skeleton | null {
  const cfg = useApp((s) => s.engine.branches);
  const trunkFrac = useApp((s) => s.engine.growth.trunkClearanceFraction[p.species.type] ?? 0);
  const h = Math.max(p.size.height, MIN_FORM_SIZE);
  const base = h * trunkFrac;
  return useMemo(
    () => (enabled ? branchSkeleton(p.species.habit, Math.max(p.size.width / 2, MIN_FORM_SIZE / 2), base, h - base, seedFromId(p.inst.id), cfg, p.species.crown?.profile) : null),
    [enabled, p.species.crown, p.species.habit, p.size.width, base, h, p.inst.id, cfg],
  );
}

function Branches({ skeleton }: { skeleton: Skeleton }) {
  const geometry = useMemo(() => branchGeometry(skeleton), [skeleton]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} castShadow>
      <meshStandardMaterial color="#5e4632" roughness={1} />
    </mesh>
  );
}

function FormBody({ p, month }: { p: PlacedPlant; month: number }) {
  const trunkFrac = useApp((s) => s.engine.growth.trunkClearanceFraction[p.species.type] ?? 0);
  const tintFrac = useApp((s) => s.engine.growth.bloomTintFraction);
  const showBloom = useApp((s) => s.layers.bloom);
  const leafOff = isLeafOff(p.species, month);
  const blooming = showBloom && isBlooming(p.species, month) && !leafOff;
  const { species: s, size } = p;
  const color = useMemo(() => {
    const c = new THREE.Color(s.foliageColor);
    return blooming ? c.lerp(new THREE.Color(s.bloomColor), tintFrac) : c;
  }, [s.foliageColor, s.bloomColor, blooming, tintFrac]);
  const parts = useMemo(
    () => plantParts(s.habit, size.width / 2, size.height, trunkFrac, seedFromId(p.inst.id), s.crown?.profile),
    [s.habit, s.crown, size.width, size.height, trunkFrac, p.inst.id],
  );
  const geometries = useMemo(
    () => parts.map((part) => (part.shape === 'ellipsoid' ? UNIT_ELLIPSOID : part.shape === 'dome' ? UNIT_DOME : partGeometry(part))),
    [parts],
  );
  useEffect(
    () => () => {
      geometries.forEach((g) => {
        if (g !== UNIT_ELLIPSOID && g !== UNIT_DOME) g.dispose();
      });
    },
    [geometries],
  );
  const skeleton = useSkeleton(p, leafOff);
  return (
    <group>
      {skeleton && <Branches skeleton={skeleton} />}
      {parts.map((part, i) => (part.material !== 'trunk' && leafOff ? null : (
        <mesh key={i} geometry={geometries[i]} position={part.position} rotation={part.rotation} scale={part.scale} castShadow={s.habit !== 'mat' || part.material === 'trunk'} receiveShadow={s.habit === 'mat'}>
          {part.material === 'trunk' ? (
            <meshStandardMaterial color="#6b4f3a" />
          ) : (
            <meshStandardMaterial color={color} roughness={1} />
          )}
        </mesh>
      )))}
    </group>
  );
}

/** Fruit as small spheres on the canopy surface, when the plant is big enough and the fruit is in season. */
/** Bare trees hold their fruit on the twigs: one piece hangs just below each tip, then the rest double up on the tips. */
function hangingSpots(sk: Skeleton, count: number, diameter: number, seed: number): [number, number, number][] {
  if (sk.tips.length === 0) return [];
  const out: [number, number, number][] = [];
  for (let i = 0; i < Math.min(count, sk.tips.length * 2); i++) {
    const t = sk.tips[(i + seed) % sk.tips.length];
    const lap = Math.floor(i / sk.tips.length);
    out.push([t[0] + lap * diameter * 0.6, t[1] - lap * diameter * 0.4, t[2] - diameter * (0.5 + lap * 1.1)]);
  }
  return out;
}

function FruitCluster({ p, month }: { p: PlacedPlant; month: number }) {
  const cfg = useApp((s) => s.engine.fruit);
  const trunkFrac = useApp((s) => s.engine.growth.trunkClearanceFraction[p.species.type] ?? 0);
  const show = useApp((s) => s.layers.fruit);
  const leafOff = isLeafOff(p.species, month);
  const state = useMemo(() => (show ? fruitState(p.species, p.size, month, cfg) : null), [show, p.species, p.size, month, cfg]);
  const h = Math.max(p.size.height, MIN_FORM_SIZE);
  const base = h * trunkFrac;
  const skeleton = useSkeleton(p, leafOff);
  const spots = useMemo(
    () => (state && leafOff ? (skeleton ? hangingSpots(skeleton, state.count, state.diameterFt, seedFromId(p.inst.id)) : []) : state ? fruitPositions(p.species.habit, Math.max(p.size.width / 2, MIN_FORM_SIZE / 2), base, h - base, state.count, seedFromId(p.inst.id), cfg, p.species.crown?.profile) : []),
    [state, leafOff, skeleton, p.species.habit, p.species.crown, p.size.width, base, h, p.inst.id, cfg],
  );
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m || !state) return;
    const dummy = new THREE.Object3D();
    spots.forEach(([x, y, z], i) => {
      dummy.position.set(x, y, z);
      dummy.scale.set(state.diameterFt / 2, state.diameterFt / 2, (state.diameterFt / 2) * state.aspect);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.count = spots.length;
    m.instanceMatrix.needsUpdate = true;
  }, [spots, state]);
  if (!state || spots.length === 0) return null;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, spots.length]} key={`${spots.length}-${state.phase}`} frustumCulled={false}>
      <sphereGeometry args={[1, 10, 8]} />
      <meshStandardMaterial color={state.color} roughness={0.55} />
    </instancedMesh>
  );
}

export function Form({ p, month }: { p: PlacedPlant; month: number }) {
  return (
    <group>
      <FormBody p={p} month={month} />
      <FruitCluster p={p} month={month} />
      <LeafDrop p={p} month={month} />
    </group>
  );
}

function Ring({ x, y, radius, color, opacity = 0.9 }: { x: number; y: number; radius: number; color: string; opacity?: number }) {
  return (
    <mesh position={[x, y, 0.16]} renderOrder={5}>
      <ringGeometry args={[Math.max(radius - 0.14, 0.02), radius, 56]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthTest={false} />
    </mesh>
  );
}

/** All palette plants at their simulated size for the timeline month, plus rings (GR-5). */
export function PlantLayer() {
  const instances = useApp((s) => s.instances);
  const palette = useApp((s) => s.palette);
  const library = useApp((s) => s.library);
  const engine = useApp((s) => s.engine);
  const month = useApp((s) => s.timelineMonth);
  const selectedId = useApp((s) => s.selectedId);
  const placing = useApp((s) => s.placingSpeciesId);
  const hover = useApp((s) => s.hover);
  const measureActive = useApp((s) => s.measureActive);
  const select = useApp((s) => s.select);
  const edit = useApp((s) => s.mode === 'edit');
  const setDrag = useApp((s) => s.setDrag);
  const beginGesture = useApp((s) => s.beginGesture);
  const duplicateInstance = useApp((s) => s.duplicateInstance);
  const doy = useApp((s) => s.doy);
  const controls = useThree((st) => st.controls) as unknown as { enabled: boolean } | null;
  const calMonth = doyToMonthDay(doy)[0];

  // End a drag wherever the pointer is released, and give the camera back.
  useEffect(() => {
    const up = () => {
      setDrag(null);
      if (controls) controls.enabled = true;
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [controls, setDrag]);

  const plants = useMemo(
    () => placedPlants(instances, palette, library.species, month, engine.growth),
    [instances, palette, library, month, engine],
  );
  const selected = plants.find((p) => p.inst.id === selectedId);
  const placingSp = placing ? library.species.find((s) => s.id === placing) : undefined;

  const onClick = (id: string) => (e: ThreeEvent<MouseEvent>) => {
    if (measureActive || placing) return; // let the ground handle it
    e.stopPropagation();
    select(id);
  };
  // Pressing on a plant selects it and starts a drag (edit mode); the ground then moves it.
  const onDown = (id: string) => (e: ThreeEvent<PointerEvent>) => {
    if (measureActive || placing || !edit) return;
    e.stopPropagation();
    // Option-drag: leave this plant where it is and drag a copy (one undo step removes it again).
    if (e.nativeEvent.altKey) {
      const copyId = duplicateInstance(id, [0, 0]);
      if (!copyId) return;
      setDrag(copyId);
      if (controls) controls.enabled = false;
      return;
    }
    select(id);
    beginGesture();
    setDrag(id);
    if (controls) controls.enabled = false;
  };

  return (
    <group>
      {plants.map((p) => (
        <group key={p.inst.id} position={[p.inst.position[0], p.inst.position[1], 0]} onClick={onClick(p.inst.id)} onPointerDown={onDown(p.inst.id)}>
          <Form p={p} month={calMonth} />
        </group>
      ))}
      {selected && (
        <>
          <Ring x={selected.inst.position[0]} y={selected.inst.position[1]} radius={selected.species.matureWidth / 2} color="#2563eb" />
          <Ring x={selected.inst.position[0]} y={selected.inst.position[1]} radius={Math.max(selected.size.width / 2, 0.2)} color="#f59e0b" opacity={0.95} />
        </>
      )}
      {placingSp && hover && <Ring x={hover[0]} y={hover[1]} radius={placingSp.matureWidth / 2} color="#16a34a" />}
    </group>
  );
}
