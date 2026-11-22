import { Html, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useMemo } from 'react';
import { instanceSize, type PlacedPlant } from '../engine/growth';
import type { PlantInstance } from '../engine/types';
import { useApp } from '../store/store';
import { Form } from './Plants';

/**
 * A development-only page (open the app with ?lab) that stands plants side by side at several ages so their shapes
 * can be checked by eye. Options: species=id,id or a habit name or "fruit", years=0,2,5,10,20, month=1..12,
 * container=5gal, spacing=feet, pitch=camera height (0.7 default, 0.1 for a side-on view).
 */
export function PlantLab() {
  const library = useApp((s) => s.library);
  const engine = useApp((s) => s.engine);
  const q = useMemo(() => new URLSearchParams(window.location.search), []);
  const years = (q.get('years') ?? '0,2,5,10,20').split(',').map(Number);
  const month = Number(q.get('month') ?? 12);
  const container = (q.get('container') ?? '5gal') as PlantInstance['container'];
  const want = q.get('species') ?? 'round';
  const species = useMemo(() => {
    const ids = want.split(',');
    if (want === 'fruit') return library.species.filter((s) => s.fruit);
    if (want === 'all') return library.species;
    const byHabit = library.species.filter((s) => s.habit === want);
    return byHabit.length > 0 ? byHabit : library.species.filter((s) => ids.includes(s.id));
  }, [library, want]);
  const cell = Number(q.get('spacing')) || Math.max(...species.map((s) => s.matureWidth)) + 2;
  const rows = species.map((sp, row) => ({
    sp,
    cells: years.map((y, col): PlacedPlant => {
      const inst: PlantInstance = { id: `lab-${sp.id}-${y}`, speciesId: sp.id, position: [col * cell, row * cell], plantedMonth: 0, container, existing: false };
      return { inst, species: sp, size: instanceSize(inst, sp, Math.round(y * 12), engine.growth) };
    }),
  }));
  const width = (years.length - 1) * cell, depth = (species.length - 1) * cell;
  const span = Math.max(width, depth, 10) + cell;
  const cx = width / 2, cy = depth / 2;
  // Site Z is up; the scene group below turns it into three.js axes, so the camera is placed in three.js axes.
  const pitch = Number(q.get('pitch') ?? 0.7);
  const camPos: [number, number, number] = [cx, span * pitch, -(cy - span * 1.25)];
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#dfe7ee' }}>
      <Canvas shadows dpr={[1, 1.5]}>
        <color attach="background" args={['#dfe7ee']} />
        <PerspectiveCamera makeDefault fov={40} near={0.1} far={3000} position={camPos} />
        <OrbitControls target={[cx, 2, -cy]} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[cx + 40, 80, -cy + 40]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-span} shadow-camera-right={span} shadow-camera-top={span} shadow-camera-bottom={-span} />
        <group rotation={[-Math.PI / 2, 0, 0]}>
          <mesh position={[cx, cy, -0.02]} receiveShadow>
            <planeGeometry args={[width + cell * 2, depth + cell * 2]} />
            <meshStandardMaterial color="#c9cfb8" />
          </mesh>
          {rows.map(({ sp, cells }, row) => (
            <group key={sp.id}>
              <Html position={[-cell * 0.55, row * cell, 0.3]} center style={{ pointerEvents: 'none' }}>
                <span className="dim-label">{sp.common}</span>
              </Html>
              {cells.map((p, col) => (
                <group key={p.inst.id} position={[col * cell, row * cell, 0]}>
                  <Form p={p} month={month} />
                  {row === 0 && (
                    <Html position={[0, -cell * 0.45, 0.3]} center style={{ pointerEvents: 'none' }}>
                      <span className="dim-label">{years[col] === 0 ? 'planted' : `year ${years[col]}`}</span>
                    </Html>
                  )}
                </group>
              ))}
            </group>
          ))}
        </group>
      </Canvas>
    </div>
  );
}
