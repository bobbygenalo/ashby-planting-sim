import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { glassBands, type GlassBand } from '../engine/glazing';
import { interiorLight, outdoorLight, seedOf } from '../engine/interior';
import { solarPosition, sunVectorSite } from '../engine/solar';
import { skyColor } from '../engine/sky';
import { doyToMonthDay, localToUtc } from '../engine/time';
import type { StructureCfg } from '../engine/types';
import { useApp } from '../store/store';
import { depthBias } from './overlay';

const noHit = { raycast: () => null } as const;

/** A sky for the glass to reflect: a gradient from the horizon color up to a deeper blue, a dim ground below, and the sun as a bright disc. Rendered once into an environment map. */
function skyScene(horizon: string, zenith: string, ground: string, sunDir: THREE.Vector3, sunUp: boolean): THREE.Scene {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 48, 24);
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const h = new THREE.Color(horizon), z = new THREE.Color(zenith), g = new THREE.Color(ground), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 50;
    if (y < 0) c.copy(h).lerp(g, Math.min(1, -y * 3));
    else c.copy(h).lerp(z, Math.pow(Math.min(1, y * 1.4), 0.6));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, toneMapped: false })));
  if (sunUp) {
    const sun = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 12, 8), toneMapped: false }));
    sun.position.copy(sunDir).multiplyScalar(45);
    scene.add(sun);
  }
  return scene;
}

/** The environment map the glass reflects, rebuilt when the sun has moved a few degrees; null until a renderer exists. */
export function useSkyEnvironment(): THREE.Texture | null {
  const gl = useThree((s) => s.gl);
  const site = useApp((s) => s.site);
  const engine = useApp((s) => s.engine);
  const doy = useApp((s) => s.doy);
  const minutes = useApp((s) => s.minutes);
  const [month, day] = doyToMonthDay(doy);
  const sun = solarPosition(localToUtc(site.timeZone, engine.referenceYear, month, day, 0, minutes), site.latitude, site.longitude, engine.sun.refraction);
  const key = `${Math.round(sun.elevationDeg / 3)}|${Math.round(sun.azimuthDeg / 6)}`;
  const env = useMemo(() => {
    const v = sunVectorSite(site.rearBearingDeg, site.driveSide, sun.azimuthDeg, sun.elevationDeg);
    const dir = new THREE.Vector3(v[0], v[2], -v[1]).normalize();
    const horizon = skyColor(sun.elevationDeg, engine.sky);
    // Overhead the sky is a deeper blue by day and the night color after dark.
    const day = Math.min(1, Math.max(0, (sun.elevationDeg + 4) / 14));
    const zenith = new THREE.Color(engine.sky.night).lerp(new THREE.Color('#4d84c4'), day).getStyle();
    const ground = new THREE.Color('#6f7c58').multiplyScalar(0.25 + 0.75 * day).getStyle();
    const pm = new THREE.PMREMGenerator(gl);
    const scene = skyScene(horizon, zenith, ground, dir, sun.elevationDeg > -2);
    const rt = pm.fromScene(scene, 0.03);
    pm.dispose();
    scene.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
    return rt;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, key, engine.sky, site.rearBearingDeg, site.driveSide]);
  useEffect(() => () => env.dispose(), [env]);
  return env.texture;
}

/** A flat quad from four 3D corners (counter-clockwise seen from the front). */
function quad(c: [number, number, number][]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(c.flat(), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

function bandGeometry(b: GlassBand, outFt: number, frameFt: number) {
  const out = (p: [number, number, number], k: number): [number, number, number] => [p[0] + b.normal[0] * k, p[1] + b.normal[1] * k, p[2]];
  const [bl, br, tr, tl] = b.corners;
  const glass = quad([out(bl, outFt), out(br, outFt), out(tr, outFt), out(tl, outFt)]);
  const k = outFt + 0.012, f = frameFt;
  const up = (p: [number, number, number], dz: number): [number, number, number] => [p[0], p[1], p[2] + dz];
  const parts: THREE.BufferGeometry[] = [
    quad([out(bl, k), out(br, k), out(up(br, f), k), out(up(bl, f), k)]), // bottom rail
    quad([out(up(tl, -f), k), out(up(tr, -f), k), out(tr, k), out(tl, k)]), // top rail
  ];
  // A mullion is a vertical strip `frameFt` wide along the wall.
  const along = [(br[0] - bl[0]), (br[1] - bl[1])];
  const l = Math.hypot(along[0], along[1]) || 1;
  const ux = along[0] / l, uy = along[1] / l;
  for (const m of b.mullions) {
    const p = (dx: number, z: number): [number, number, number] => out([m.x + ux * dx, m.y + uy * dx, z], k);
    parts.push(quad([p(-f / 2, m.z0), p(f / 2, m.z0), p(f / 2, m.z1), p(-f / 2, m.z1)]));
  }
  return { glass, frame: parts };
}

/** The sun's height above the horizon now (degrees), at the sun dock's date and time. */
export function useSunElevation(): number {
  return useApp((st) => {
    const [m, d] = doyToMonthDay(st.doy);
    return solarPosition(localToUtc(st.site.timeZone, st.engine.referenceYear, m, d, 0, st.minutes), st.site.latitude, st.site.longitude, st.engine.sun.refraction).elevationDeg;
  });
}

/** How brightly the windows of a building glow now, 0 to 1 (`interior` in engine.json): on as the sun sets, out at bedtime. */
export function useInteriorGlow(building: string): number {
  const elev = useSunElevation();
  const minutes = useApp((st) => st.minutes);
  const cfg = useApp((st) => st.engine.interior);
  return interiorLight(elev, minutes, cfg, seedOf(building));
}

/** How brightly the round outdoor lights glow now, 0 to 1: on from dusk until the sun is up. */
export function useOutdoorGlow(): number {
  const elev = useSunElevation();
  const cfg = useApp((st) => st.engine.interior);
  return outdoorLight(elev, cfg);
}

/**
 * The wide clerestory glass in a structure's wall: dark, glossy panes that mirror the sky (an environment map of the sky's
 * gradient and the sun, rebuilt as the sun moves), a bright rim of reflection at grazing angles, slim dark mullions and rails,
 * and a warm glow at night as if lit from inside. Drawn in site coordinates.
 */
export function Glazing({ s, rank = 0 }: { s: StructureCfg; rank?: number }) {
  const bands = useMemo(() => glassBands(s), [s]);
  const env = useSkyEnvironment();
  const cfg = useApp((st) => st.engine.interior);
  const glow = useInteriorGlow(s.group ?? s.id);
  const geos = useMemo(() => bands.map((b) => bandGeometry(b, 0.03, 0.18)), [bands]);
  useEffect(() => () => geos.forEach((g) => { g.glass.dispose(); g.frame.forEach((p) => p.dispose()); }), [geos]);
  if (!bands.length) return null;
  return (
    <group {...noHit}>
      {geos.map((g, i) => (
        <group key={i}>
          <mesh geometry={g.glass} receiveShadow {...noHit}>
            <meshPhysicalMaterial
              color="#0d1620" metalness={0.8} roughness={0.05} envMap={env} envMapIntensity={1.35} clearcoat={1} clearcoatRoughness={0.02}
              emissive={cfg.color} emissiveIntensity={glow * 0.8} side={THREE.DoubleSide} {...depthBias(3, rank)}
            />
          </mesh>
          {g.frame.map((p, k) => (
            <mesh key={k} geometry={p} {...noHit}>
              <meshStandardMaterial color="#1b1f26" roughness={0.45} metalness={0.5} side={THREE.DoubleSide} {...depthBias(4, rank)} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}
