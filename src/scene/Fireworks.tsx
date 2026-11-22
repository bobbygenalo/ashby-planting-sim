import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { burstBrightness, FireworkShow, sparkOffset } from '../engine/fireworks';
import type { LifeSim } from '../engine/life';
import { useApp } from '../store/store';

const MAX_BURSTS = 14;

/**
 * The Fourth of July display, up beyond the back of the lot: shells go off at random gaps and each throws a ball of
 * sparks that flare, droop and fade. A soft flash lights the yard when one goes off. It runs only while the life
 * simulation says the display is on (8 pm to 11 pm on the day).
 */
export function Fireworks({ sim, lot }: { sim: React.MutableRefObject<LifeSim | null>; lot: { width: number; depth: number } }) {
  const cfg = useApp((s) => s.engine.life.fireworks);
  const show = useMemo(() => new FireworkShow(lot, cfg, 4), [lot, cfg]);
  const group = useRef<THREE.Group>(null);
  const flash = useRef<THREE.PointLight>(null);
  const was = useRef(false);
  const total = MAX_BURSTS * cfg.sparks;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
    return g;
  }, [total]);
  const col = useMemo(() => new THREE.Color(), []);
  useFrame((_, dt) => {
    const on = !!sim.current?.fireworksOn;
    if (group.current) group.current.visible = on;
    if (!on) {
      if (was.current) show.reset();
      was.current = false;
      if (flash.current) flash.current.intensity = 0;
      return;
    }
    was.current = true;
    const fresh = show.step(Math.min(dt, 0.25));
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const colors = geo.getAttribute('color') as THREE.BufferAttribute;
    let n = 0;
    let glow = 0;
    const bursts = show.bursts.slice(-MAX_BURSTS);
    for (const b of bursts) {
      const k = burstBrightness(b.age, cfg.lifeS);
      col.set(b.color);
      glow = Math.max(glow, k * (b.age < 0.4 ? 1 : 0.25));
      for (let s = 0; s < cfg.sparks; s++, n++) {
        const o = sparkOffset(b, s, cfg.sparks, b.age, cfg);
        pos.setXYZ(n, b.pos[0] + o[0], b.pos[1] + o[1], b.pos[2] + o[2]);
        // Sparks twinkle a little as they fade.
        const tw = 0.75 + 0.25 * Math.sin(b.age * 30 + s * 1.7);
        colors.setXYZ(n, col.r * k * tw, col.g * k * tw, col.b * k * tw);
      }
    }
    for (; n < total; n++) {
      pos.setXYZ(n, 0, 0, -1000);
      colors.setXYZ(n, 0, 0, 0);
    }
    pos.needsUpdate = true;
    colors.needsUpdate = true;
    if (flash.current) {
      if (fresh.length) col.set(fresh[fresh.length - 1].color);
      flash.current.intensity = cfg.flashIntensity * glow * 500;
    }
  });
  return (
    <group ref={group} visible={false} raycast={() => null}>
      <points geometry={geo} frustumCulled={false} raycast={() => null}>
        <pointsMaterial size={4} sizeAttenuation vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} fog={false} />
      </points>
      <pointLight ref={flash} position={[lot.width / 2, lot.depth + 60, 120]} intensity={0} distance={600} decay={1.4} color="#fff2e0" />
    </group>
  );
}
