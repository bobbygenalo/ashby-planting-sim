import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { PlacedPlant } from '../engine/growth';
import { seedFromId } from '../engine/fruit';
import { litterState } from '../engine/litter';
import { mulberry32 } from '../engine/shuffle';
import { useApp } from '../store/store';
import { MIN_FORM_SIZE } from './forms';

const GOLDEN = 2.399963229728653;

/**
 * The leaves of a deciduous plant coming down, lying under it, and rotting into the soil: leaves drift from the
 * canopy while they fall, a carpet covers the ground while the plant is bare, and after the new leaves are out the
 * carpet darkens, thins and sinks into a patch of dark soil over the next months.
 */
export function LeafDrop({ p, month }: { p: PlacedPlant; month: number }) {
  const cfg = useApp((s) => s.engine.litter);
  const state = useMemo(() => litterState(p.species, month, cfg), [p.species, month, cfg]);
  const r = Math.max(p.size.width / 2, MIN_FORM_SIZE / 2);
  const top = Math.max(p.size.height, MIN_FORM_SIZE);
  const seed = seedFromId(p.inst.id);
  const count = state.phase === 'none' ? 0 : Math.min(cfg.maxLeaves, Math.max(cfg.minLeaves, Math.round(Math.PI * r * r * cfg.leavesPerSqFt * state.amount)));
  // Where each leaf lands: spread evenly over the litter circle with a little jitter, the same every year.
  const homes = useMemo(() => {
    const rng = mulberry32(seed);
    return Array.from({ length: count }, (_, i) => {
      const rho = r * cfg.radiusFraction * Math.sqrt((i + 0.5) / Math.max(count, 1)) * (0.9 + 0.2 * rng());
      const a = i * GOLDEN + rng() * 0.5;
      return { x: Math.cos(a) * rho, y: Math.sin(a) * rho, yaw: rng() * Math.PI * 2, phase: rng(), swing: rng() * Math.PI * 2 };
    });
  }, [count, r, cfg, seed]);
  const falling = state.phase === 'falling';
  const airborne = falling ? Math.floor(homes.length * cfg.fallingShare) : 0;
  const lying = homes.length - airborne;

  const color = useMemo(() => {
    const c = new THREE.Color(p.species.foliageColor).lerp(new THREE.Color(cfg.autumnColor), cfg.autumnBlend);
    return c.lerp(new THREE.Color(cfg.soilColor), state.decay);
  }, [p.species.foliageColor, cfg, state.decay]);

  const ground = useRef<THREE.InstancedMesh>(null);
  const air = useRef<THREE.InstancedMesh>(null);
  const leafSize = cfg.leafSizeFt * (1 - 0.55 * state.decay);

  // Leaves on the ground lie flat and settle with the year; the ones in the air are placed every frame.
  useLayoutEffect(() => {
    const m = ground.current;
    if (!m) return;
    const d = new THREE.Object3D();
    homes.slice(airborne).forEach((h, i) => {
      d.position.set(h.x, h.y, cfg.groundZ + 0.02);
      d.rotation.set(0, 0, h.yaw);
      d.scale.set(leafSize, leafSize * 0.6, 1);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
    });
    m.count = lying;
    m.instanceMatrix.needsUpdate = true;
  }, [homes, airborne, lying, leafSize, cfg]);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const m = air.current;
    if (!m || airborne === 0) return;
    const t = clock.elapsedTime;
    const height = Math.max(top * 0.85, 0.5);
    homes.slice(0, airborne).forEach((h, i) => {
      const u = (t * cfg.fallSpeedFtPerSec / height + h.phase) % 1; // 0 at the canopy, 1 on the ground
      const sway = Math.sin(t * 1.7 + h.swing) * cfg.swayFt * (1 - u * 0.5);
      dummy.position.set(h.x + sway * 0.6, h.y + Math.cos(t * 1.3 + h.swing) * cfg.swayFt * 0.4, cfg.groundZ + 0.05 + height * (1 - u));
      dummy.rotation.set(Math.sin(t * 2 + h.swing) * 1.1, Math.cos(t * 1.6 + h.swing) * 1.1, h.yaw + t * 0.8);
      dummy.scale.set(leafSize, leafSize * 0.6, 1);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.count = airborne;
    m.instanceMatrix.needsUpdate = true;
  });

  if (state.phase === 'none') return null;
  // The patch of dark, rotted soil: faint under fresh litter, deepest as it rots, gone with the litter.
  const humus = cfg.humusOpacity * (state.phase === 'composting' ? 0.5 + 0.5 * (1 - state.decay) : state.amount * 0.6);
  return (
    <group>
      <mesh position={[0, 0, cfg.groundZ]} renderOrder={1}>
        <circleGeometry args={[r * cfg.humusRadiusFraction, 36]} />
        <meshStandardMaterial color={cfg.soilColor} transparent opacity={humus} depthWrite={false} roughness={1} />
      </mesh>
      {lying > 0 && (
        <instancedMesh ref={ground} args={[undefined, undefined, lying]} key={`g-${lying}`} frustumCulled={false} renderOrder={2}>
          <circleGeometry args={[0.5, 6]} />
          <meshStandardMaterial color={color} roughness={1} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-2} />
        </instancedMesh>
      )}
      {airborne > 0 && (
        <instancedMesh ref={air} args={[undefined, undefined, airborne]} key={`a-${airborne}`} frustumCulled={false}>
          <circleGeometry args={[0.5, 6]} />
          <meshStandardMaterial color={color} roughness={1} side={THREE.DoubleSide} />
        </instancedMesh>
      )}
    </group>
  );
}
