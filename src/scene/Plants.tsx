import { useEffect, useMemo } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlacedPlant } from '../engine/growth';
import { isBlooming, isLeafOff, placedPlants } from '../engine/growth';
import { doyToMonthDay } from '../engine/time';
import { useApp } from '../store/store';

function Form({ p, month }: { p: PlacedPlant; month: number }) {
  const trunkFrac = useApp((s) => s.engine.growth.trunkClearanceFraction[p.species.type] ?? 0);
  const tintFrac = useApp((s) => s.engine.growth.bloomTintFraction);
  const showBloom = useApp((s) => s.layers.bloom);
  const leafOff = isLeafOff(p.species, month);
  const blooming = showBloom && isBlooming(p.species, month) && !leafOff;
  const { species: s, size } = p;
  const h = Math.max(size.height, 0.05);
  const r = Math.max(size.width / 2, 0.05);
  const base = h * trunkFrac;
  const canopyH = h - base;
  const color = useMemo(() => {
    const c = new THREE.Color(s.foliageColor);
    return blooming ? c.lerp(new THREE.Color(s.bloomColor), tintFrac) : c;
  }, [s.foliageColor, s.bloomColor, blooming, tintFrac]);
  // Leafless deciduous plants are drawn as a faint ghost of the canopy (GR-4).
  const mat = <meshStandardMaterial color={color} roughness={1} transparent={leafOff} opacity={leafOff ? 0.22 : 1} depthWrite={!leafOff} />;
  const trunk =
    base > 0.4 ? (
      <mesh position={[0, 0, base / 2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[Math.min(0.35, r * 0.1) + 0.05, Math.min(0.5, r * 0.14) + 0.08, base, 8]} />
        <meshStandardMaterial color="#6b4f3a" />
      </mesh>
    ) : null;

  switch (s.habit) {
    case 'columnar':
      return (
        <group>
          {trunk}
          <mesh position={[0, 0, base + canopyH / 2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[r * 0.55, r, canopyH, 16]} />
            {mat}
          </mesh>
        </group>
      );
    case 'vase':
      return (
        <group>
          {trunk}
          <mesh position={[0, 0, base + canopyH / 2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[r, r * 0.3, canopyH, 18]} />
            {mat}
          </mesh>
        </group>
      );
    case 'spreading':
    case 'weeping':
      return (
        <group>
          {trunk}
          <mesh position={[0, 0, base]} scale={[r, r, canopyH]} castShadow>
            <sphereGeometry args={[1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
            {mat}
          </mesh>
        </group>
      );
    case 'clump': {
      const blades = 9;
      return (
        <group>
          {Array.from({ length: blades }, (_, i) => {
            const a = (i / blades) * Math.PI * 2;
            const d = r * 0.55;
            return (
              <mesh
                key={i}
                position={[Math.cos(a) * d, Math.sin(a) * d, h / 2]}
                rotation={[Math.PI / 2 + Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35]}
                castShadow
              >
                <coneGeometry args={[Math.max(r * 0.28, 0.05), h, 6]} />
                {mat}
              </mesh>
            );
          })}
        </group>
      );
    }
    case 'mat':
      return (
        <mesh position={[0, 0, Math.max(h, 0.15) / 2]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
          <cylinderGeometry args={[r, r, Math.max(h, 0.15), 24]} />
          {mat}
        </mesh>
      );
    case 'vine':
      return (
        <mesh position={[0, 0, h / 2]} castShadow>
          <boxGeometry args={[r * 2, Math.max(0.5, r * 0.25), h]} />
          {mat}
        </mesh>
      );
    default:
      return (
        <group>
          {trunk}
          <mesh position={[0, 0, base + canopyH / 2]} scale={[r, r, canopyH / 2]} castShadow>
            <sphereGeometry args={[1, 20, 14]} />
            {mat}
          </mesh>
        </group>
      );
  }
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
