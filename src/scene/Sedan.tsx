import { useMemo } from 'react';
import * as THREE from 'three';
import type { SedanSpot } from '../engine/vehicle';

const noHit = { raycast: () => null } as const;

/** A white four-door sedan standing on the driveway, nose toward the garage: body, glass cabin, roof, wheels and lamps. */
export function Sedan({ spot, color }: { spot: SedanSpot; color: string }) {
  const { length: L, width: W } = spot;
  const wheel = useMemo(() => new THREE.CylinderGeometry(1.05, 1.05, 0.7, 16), []);
  const body = { z0: 0.75, h: 1.75 };
  const cabinL = L * 0.5, cabinH = 1.45, cabinW = W * 0.9;
  const wheelX = [L * 0.31, -L * 0.31];
  return (
    <group position={[spot.center[0], spot.center[1], 0]} rotation={[0, 0, spot.heading]} {...noHit}>
      <mesh {...noHit} position={[0, 0, body.z0 + body.h / 2]} castShadow receiveShadow>
        <boxGeometry args={[L, W, body.h]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.25} />
      </mesh>
      {/* The cabin: dark glass between the pillars, a white roof on top; set back a little from the middle. */}
      <mesh {...noHit} position={[-L * 0.07, 0, body.z0 + body.h + cabinH / 2]} castShadow>
        <boxGeometry args={[cabinL, cabinW, cabinH]} />
        <meshStandardMaterial color="#2a3340" roughness={0.15} metalness={0.5} />
      </mesh>
      <mesh {...noHit} position={[-L * 0.07, 0, body.z0 + body.h + cabinH + 0.07]} castShadow>
        <boxGeometry args={[cabinL * 0.94, cabinW * 0.96, 0.16]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.25} />
      </mesh>
      {wheelX.flatMap((x) => [1, -1].map((side) => (
        <mesh key={`${x}${side}`} {...noHit} geometry={wheel} position={[x, side * (W / 2 - 0.2), 1.05]} castShadow>
          <meshStandardMaterial color="#1b1b1b" roughness={0.9} />
        </mesh>
      )))}
      {[1, -1].map((side) => (
        <mesh key={`h${side}`} {...noHit} position={[L / 2 + 0.01, side * (W / 2 - 0.9), body.z0 + 1.15]}>
          <boxGeometry args={[0.06, 0.8, 0.28]} />
          <meshStandardMaterial color="#fff8d8" emissive="#fff3b0" emissiveIntensity={0.25} />
        </mesh>
      ))}
      {[1, -1].map((side) => (
        <mesh key={`t${side}`} {...noHit} position={[-L / 2 - 0.01, side * (W / 2 - 0.9), body.z0 + 1.15]}>
          <boxGeometry args={[0.06, 0.8, 0.26]} />
          <meshStandardMaterial color="#b3202a" emissive="#7a0f16" emissiveIntensity={0.3} />
        </mesh>
      ))}
    </group>
  );
}
