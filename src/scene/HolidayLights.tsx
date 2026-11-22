import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { inHolidaySeason, lightsAreOn, roofLightLines, stringBulbs } from '../engine/holiday';
import { solarPosition } from '../engine/solar';
import { activeStructures } from '../engine/site';
import { doyToMonthDay, localToUtc } from '../engine/time';
import { useApp } from '../store/store';

/**
 * Christmas lights on the front rooflines of the street-facing house and the ADU, from the day after Thanksgiving to the
 * end of the year: a wire along the edges with colored bulbs, dull in daylight, glowing from sunset until midnight.
 */
export function HolidayLights() {
  const site = useApp((s) => s.site);
  const engine = useApp((s) => s.engine);
  const aduEnabled = useApp((s) => s.aduEnabled);
  const doy = useApp((s) => s.doy);
  const minutes = useApp((s) => s.minutes);
  const cfg = engine.holiday;
  const [month, day] = doyToMonthDay(doy);
  const season = inHolidaySeason(month, day, engine.referenceYear, cfg);
  const utc = localToUtc(site.timeZone, engine.referenceYear, month, day, 0, minutes);
  const elevation = solarPosition(utc, site.latitude, site.longitude, engine.sun.refraction).elevationDeg;
  const on = lightsAreOn(elevation, minutes, cfg);

  const lines = useMemo(
    () => activeStructures(site, { aduEnabled }).filter((st) => cfg.lightedParts.includes(st.id)).flatMap((st) => roofLightLines(st, cfg)),
    [site, aduEnabled, cfg],
  );
  const bulbs = useMemo(() => stringBulbs(lines, cfg.bulbSpacingFt, cfg.colors.length), [lines, cfg]);
  const bulbMesh = useRef<THREE.InstancedMesh>(null);
  const glowMesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Colors: bright when lit, dull when not. Placement never changes with the hour.
  useLayoutEffect(() => {
    const m = bulbMesh.current, g = glowMesh.current;
    if (!m || !g) return;
    const c = new THREE.Color();
    bulbs.forEach((b, i) => {
      dummy.position.set(b.pos[0], b.pos[1], b.pos[2]);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      g.setMatrixAt(i, dummy.matrix);
      c.set(cfg.colors[b.color]);
      if (!on) c.multiplyScalar(cfg.offDim);
      m.setColorAt(i, c);
      c.set(cfg.colors[b.color]);
      g.setColorAt(i, c);
    });
    m.count = g.count = bulbs.length;
    m.instanceMatrix.needsUpdate = g.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    if (g.instanceColor) g.instanceColor.needsUpdate = true;
    g.visible = on;
  }, [bulbs, on, cfg, dummy]);

  // A slow twinkle while they are lit.
  const last = useRef(0);
  useFrame(({ clock }) => {
    const m = bulbMesh.current, g = glowMesh.current;
    if (!on || !m || !g) return;
    const t = clock.elapsedTime;
    if (t - last.current < 0.07) return;
    last.current = t;
    bulbs.forEach((b, i) => {
      const k = 1 + 0.28 * Math.sin((t * cfg.twinkleHz + b.phase) * Math.PI * 2);
      dummy.position.set(b.pos[0], b.pos[1], b.pos[2]);
      dummy.scale.setScalar(k);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      dummy.scale.setScalar(0.7 + (k - 0.72) * 1.2);
      dummy.updateMatrix();
      g.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = g.instanceMatrix.needsUpdate = true;
  });

  if (!season || bulbs.length === 0) return null;
  return (
    <group raycast={() => null}>
      {lines.map((l, i) => (
        <Line key={i} points={l} color={cfg.wireColor} lineWidth={1.4} />
      ))}
      <instancedMesh ref={bulbMesh} args={[undefined, undefined, bulbs.length]} frustumCulled={false} raycast={() => null} key={`b-${bulbs.length}`}>
        <sphereGeometry args={[cfg.bulbRadiusFt, 8, 6]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={glowMesh} args={[undefined, undefined, bulbs.length]} frustumCulled={false} raycast={() => null} key={`g-${bulbs.length}`} visible={on}>
        <sphereGeometry args={[cfg.glowRadiusFt, 8, 6]} />
        <meshBasicMaterial transparent opacity={cfg.glowOpacity} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}
