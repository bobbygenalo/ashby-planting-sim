import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { IrrigationPlan } from '../engine/irrigation';
import { runsAt, runsOnDay, weekdayFor } from '../engine/irrigationSchedule';
import { doyToMonthDay } from '../engine/time';
import { useIrrigationSchedule } from '../store/derived';
import { useApp } from '../store/store';

/** The valves whose schedule has them running at the sun dock's date and time. */
export function useRunningValves(): Set<string> {
  const schedule = useIrrigationSchedule();
  const engine = useApp((s) => s.engine);
  const doy = useApp((s) => s.doy);
  const minutes = useApp((s) => s.minutes);
  return useMemo(() => {
    if (!schedule) return new Set<string>();
    const [mo, da] = doyToMonthDay(doy);
    const runs = runsOnDay(schedule, mo, weekdayFor(engine.referenceYear, mo, da), engine.irrigation);
    return new Set(runsAt(runs, minutes).map((r) => r.valveId));
  }, [schedule, engine, doy, minutes]);
}

/** A small stable number from a string, so every emitter drips out of step with its neighbours. */
function phaseOf(s: string, k: number): number {
  let h = 2166136261 ^ k;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

interface Particle { x: number; y: number; z: number; kind: 'emitter' | 'bubbler' | 'spray' | 'rotor'; phase: number; k: number; n: number }

/**
 * Water moving through the layout while a valve runs: the emitters drip, the bubblers well up, and the sprays and rotors throw drops. Only valves that are running at the sun dock's
 * date and time (`useRunningValves`) show it; the rest sit still. All numbers are in `irrigation.flow` in engine.json.
 */
export function IrrigationFlow({ plan, z }: { plan: IrrigationPlan; z: number }) {
  const flow = useApp((s) => s.engine.irrigation.flow);
  const draw = useApp((s) => s.engine.irrigation.draw);
  const running = useRunningValves();
  const drops = useRef<THREE.InstancedMesh>(null);

  const particles = useMemo(() => {
    const particles: Particle[] = [];
    plan.valves.forEach((v) => {
      if (!running.has(v.id)) return;
      v.devices.forEach((d, di) => {
        if (d.kind === 'inline') return;
        const base = d.z !== undefined ? d.z + draw.liftFt : z;
        const n = d.kind === 'spray' ? flow.sprayParticles : d.kind === 'rotor' ? flow.rotorParticles : d.kind === 'bubbler' ? flow.bubblerParticles : 1;
        for (let k = 0; k < n; k++) particles.push({ x: d.at[0], y: d.at[1], z: base, kind: d.kind, phase: phaseOf(v.id, di), k, n });
      });
    });
    return particles;
  }, [plan, running, flow, draw, z]);

  const dropGeo = useMemo(() => new THREE.SphereGeometry(flow.dropFt / 2, 6, 5), [flow.dropFt]);
  useLayoutEffect(() => () => dropGeo.dispose(), [dropGeo]);
  const obj = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const pm = drops.current;
    if (pm) {
      let i = 0;
      for (const q of particles) {
        if (i >= pm.instanceMatrix.count) break;
        let x = q.x, y = q.y, zz = q.z, s = 1;
        if (q.kind === 'emitter') {
          const u = (t / flow.dropEveryS + q.phase) % 1;
          if (u > 0.6) s = 0; // a gap between drops
          zz = q.z + flow.dropFallFt * (1 - u / 0.6) + flow.dropFt / 2;
        } else if (q.kind === 'bubbler') {
          const u = (t * 0.9 + q.phase + q.k / q.n) % 1;
          const a = (q.k / q.n) * Math.PI * 2 + q.phase * 6.28;
          const r = 0.3 * u;
          x += Math.cos(a) * r; y += Math.sin(a) * r;
          zz = q.z + flow.bubblerRiseFt * 4 * u * (1 - u) + flow.dropFt / 2;
        } else {
          const rotor = q.kind === 'rotor';
          const reach = rotor ? flow.rotorReachFt : flow.sprayReachFt;
          const u = (t * 1.1 + q.phase + q.k / q.n) % 1;
          // a spray head throws all round; a rotor throws one jet that sweeps round
          const a = rotor ? t * 1.4 + q.phase * 6.28 + (q.k / q.n) * 0.25 : (q.k / q.n) * Math.PI * 2 + q.phase * 6.28;
          const r = reach * u;
          x += Math.cos(a) * r; y += Math.sin(a) * r;
          zz = q.z + Math.max(0.2, reach * 0.12) * 4 * u * (1 - u) + 0.3 + flow.dropFt / 2;
          s = u > 0.96 ? 0 : 1;
        }
        obj.position.set(x, y, zz);
        obj.scale.setScalar(s);
        obj.updateMatrix();
        pm.setMatrixAt(i++, obj.matrix);
      }
      pm.count = i;
      pm.instanceMatrix.needsUpdate = true;
    }
  });

  if (running.size === 0) return null;
  return (
    <group>
      <instancedMesh key={`drops-${particles.length}`} ref={drops} args={[dropGeo, undefined, Math.max(1, particles.length)]} frustumCulled={false} renderOrder={7}>
        <meshBasicMaterial color={flow.dropColor} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}
