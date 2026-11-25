import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ContextObjectCfg, OpeningCfg } from '../engine/types';
import { activeStructures } from '../engine/site';
import { slatLayout } from '../engine/slats';
import { useApp } from '../store/store';
import { doorOpen } from './doorState';
import { useInteriorGlow, useOutdoorGlow, useSkyEnvironment } from './glass';

const noHit = { raycast: () => null } as const;

/** A box in a wall-aligned frame: `x` along the wall, `y` out from it, `z` up. */
function Box({ x, y, z, w, d, h, color, rough = 0.8, metal = 0, shadow = false, glowColor, glow = 0 }: { x: number; y: number; z: number; w: number; d: number; h: number; color: string; rough?: number; metal?: number; shadow?: boolean; glowColor?: string; glow?: number }) {
  return (
    <mesh position={[x, y, z]} castShadow={shadow} receiveShadow {...noHit}>
      <boxGeometry args={[w, d, h]} />
      <meshStandardMaterial color={color} roughness={rough} metalness={metal} emissive={glowColor ?? '#000000'} emissiveIntensity={glow} />
    </mesh>
  );
}

/** A casing of four boards round an opening: `w` by `h` outside, `f` wide, `d` proud of the wall, with its bottom at `z0`. */
function Casing({ w, h, f, d, z0, color }: { w: number; h: number; f: number; d: number; z0: number; color: string }) {
  return (
    <>
      <Box x={-w / 2 + f / 2} y={d / 2} z={z0 + h / 2} w={f} d={d} h={h} color={color} />
      <Box x={w / 2 - f / 2} y={d / 2} z={z0 + h / 2} w={f} d={d} h={h} color={color} />
      <Box x={0} y={d / 2} z={z0 + h - f / 2} w={w - 2 * f} d={d} h={f} color={color} />
      <Box x={0} y={d / 2} z={z0 + f / 2} w={w - 2 * f} d={d} h={f} color={color} />
    </>
  );
}

function OpeningMesh({ o, env }: { o: OpeningCfg; env: THREE.Texture | null }) {
  const [nx, ny] = o.facing;
  // Local x runs along the wall, local y points out of it: turn the frame so local +y is `facing`.
  const rot = Math.atan2(-nx, ny);
  const { widthFt: w, heightFt: h, sillFt: z0 } = o;
  const f = o.frameFt ?? 0.15;
  const frame = o.frameColor ?? '#f2f0ea';
  const interior = useApp((s) => s.engine.interior);
  const glow = useInteriorGlow(o.building ?? 'house') * interior.emissive;
  const lamp = useOutdoorGlow();
  // A door that people use opens and closes: it swings out on its hinge, a pane of a sliding door slides along, a garage door rolls up.
  const leaf = useRef<THREE.Group>(null);
  const slide = useRef<THREE.Group>(null);
  const recess = useRef<THREE.Mesh>(null);
  const panes = (o.mullions ?? 0) + 1;
  const paneW = (w - 2 * f) / panes;
  useFrame(() => {
    const k = doorOpen.get(o.id) ?? 0;
    if (leaf.current) {
      if (o.kind === 'door') leaf.current.rotation.z = k * 1.4;
      else leaf.current.scale.z = 1 - 0.96 * k;
    }
    if (slide.current) slide.current.position.x = -(w - 2 * f) / 2 + paneW * (panes - 0.5) - k * (paneW - 0.04);
    if (recess.current) recess.current.visible = k > 0.01;
  });
  const dark = (
    // what the opened doorway shows: a dark room, glowing when its lights are on
    <mesh ref={recess} position={[0, 0.03, z0 + h / 2]} visible={false} {...noHit}>
      <boxGeometry args={[w - 2 * f, 0.02, h - 2 * f]} />
      <meshStandardMaterial color="#0b0d10" emissive={interior.color} emissiveIntensity={glow * 0.8} />
    </mesh>
  );
  return (
    <group position={[o.at[0], o.at[1], 0]} rotation={[0, 0, rot]} {...noHit}>
      {o.kind === 'panel' && <Box x={0} y={0.02} z={z0 + h / 2} w={w} d={0.03} h={h} color={o.color ?? '#9a9f84'} rough={0.95} />}
      {o.kind === 'door' && (
        <>
          {dark}
          <group ref={leaf} position={[-(w / 2 - f), 0, 0]}>
            <group position={[w / 2 - f, 0, 0]}>
              <Box x={0} y={0.04} z={z0 + h / 2} w={w - 2 * f} d={0.07} h={h - f} color={o.color ?? '#b9701f'} rough={0.55} shadow />
              {o.lite && (
                <mesh position={[0, 0.085, z0 + h * 0.5]} {...noHit}>
                  <boxGeometry args={o.liteMarginFt !== undefined ? [w - 2 * f - 2 * o.liteMarginFt, 0.02, h - f - 2 * o.liteMarginFt] : [(w - 2 * f) * 0.72, 0.02, (h - f) * 0.76]} />
                  <meshPhysicalMaterial color="#0d1620" metalness={0.8} roughness={0.06} envMap={env} envMapIntensity={1.2} clearcoat={1} clearcoatRoughness={0.03} emissive={interior.color} emissiveIntensity={glow} />
                </mesh>
              )}
              <Box x={w / 2 - f - 0.28} y={0.12} z={z0 + 3.0} w={0.05} d={0.1} h={0.55} color="#c9c9c9" rough={0.3} metal={0.8} />
            </group>
          </group>
          <Casing w={w} h={h} f={f} d={0.12} z0={z0} color={frame} />
        </>
      )}
      {o.kind === 'garageDoor' && (
        <>
          {dark}
          {/* the door hangs from its top edge, so scaling it down in height rolls it up */}
          <group ref={leaf} position={[0, 0, z0 + h]}>
            <group position={[0, 0, -(z0 + h)]}>
              <Box x={0} y={0.05} z={z0 + h / 2} w={w - 2 * f} d={0.08} h={h - f} color={o.color ?? '#5a5d62'} rough={0.9} />
              {/* the sectional door's rows of panels: darker insets between rails and stiles */}
              {Array.from({ length: (o.rows ?? 4) }, (_, r) => Array.from({ length: (o.mullions ?? 3) + 1 }, (_, c) => {
                const cols = (o.mullions ?? 3) + 1, rows = o.rows ?? 4;
                const iw = (w - 2 * f) / cols, ih = (h - f) / rows;
                return <Box key={`${r}-${c}`} x={-(w - 2 * f) / 2 + iw * (c + 0.5)} y={0.1} z={z0 + ih * (r + 0.5)} w={iw * 0.86} d={0.03} h={ih * 0.7} color="#3f4348" rough={0.6} glowColor={interior.color} glow={glow * 0.6} />;
              }))}
            </group>
          </group>
          <Casing w={w} h={h} f={f} d={0.12} z0={z0} color={frame} />
        </>
      )}
      {o.kind === 'unit' && <Box x={0} y={(o.depthFt ?? 1) / 2} z={z0 + h / 2} w={w} d={o.depthFt ?? 1} h={h} color={o.color ?? '#e6e8ea'} rough={0.6} shadow />}
      {o.kind === 'window' && o.slider && (
        <>
          {dark}
          {Array.from({ length: panes }, (_, i) => {
            const x0 = -(w - 2 * f) / 2 + paneW * (i + 0.5);
            const moving = i === panes - 1;
            return (
              <group key={i} ref={moving ? slide : undefined} position={[x0, moving ? 0.045 : 0, 0]}>
                <mesh position={[0, 0.06, z0 + h / 2]} {...noHit}>
                  <boxGeometry args={[paneW, 0.03, h - 2 * f]} />
                  <meshPhysicalMaterial color="#0d1620" metalness={0.8} roughness={0.06} envMap={env} envMapIntensity={1.2} clearcoat={1} clearcoatRoughness={0.03} emissive={interior.color} emissiveIntensity={glow} />
                </mesh>
                <Box x={-paneW / 2 + f * 0.4} y={0.07} z={z0 + h / 2} w={f * 0.8} d={0.07} h={h - 2 * f} color={frame} />
                <Box x={paneW / 2 - f * 0.4} y={0.07} z={z0 + h / 2} w={f * 0.8} d={0.07} h={h - 2 * f} color={frame} />
              </group>
            );
          })}
          <Casing w={w} h={h} f={f} d={0.14} z0={z0} color={frame} />
        </>
      )}
      {o.kind === 'window' && !o.slider && (
        <>
          {o.trimFt && <Casing w={w + 2 * o.trimFt} h={h + 2 * o.trimFt} f={o.trimFt} d={0.1} z0={z0 - o.trimFt} color={o.trimColor ?? '#c8923a'} />}
          <mesh position={[0, 0.06, z0 + h / 2]} {...noHit}>
            <boxGeometry args={[w - 2 * f, 0.03, h - 2 * f]} />
            <meshPhysicalMaterial color="#0d1620" metalness={0.8} roughness={0.06} envMap={env} envMapIntensity={1.2} clearcoat={1} clearcoatRoughness={0.03} emissive={interior.color} emissiveIntensity={glow} />
          </mesh>
          <Casing w={w} h={h} f={f} d={0.14} z0={z0} color={frame} />
          {Array.from({ length: o.mullions ?? 0 }, (_, i) => {
            const k = (i + 1) / ((o.mullions ?? 0) + 1);
            return <Box key={i} x={-w / 2 + k * w} y={0.09} z={z0 + h / 2} w={f * 0.8} d={0.12} h={h - 2 * f} color={frame} />;
          })}
        </>
      )}
      {o.kind === 'sconce' && (
        <group position={[0, o.depthFt ?? 0.3, z0]}>
          <mesh {...noHit}>
            <sphereGeometry args={[Math.max(w, h) / 2, 16, 12]} />
            <meshStandardMaterial color={o.color ?? '#f6f2e8'} roughness={0.4} emissive="#ffe9b8" emissiveIntensity={0.08 + lamp * interior.outdoorEmissive} />
          </mesh>
          {lamp > 0.02 && (
            // a soft glow round the bulb
            <mesh {...noHit}>
              <sphereGeometry args={[Math.max(w, h) * 1.6, 16, 12]} />
              <meshBasicMaterial color="#ffd89a" transparent opacity={lamp * interior.haloOpacity} depthWrite={false} toneMapped={false} />
            </mesh>
          )}
        </group>
      )}
    </group>
  );
}

/** The doors, windows, sconces and wall panels of the buildings. */
export function Openings() {
  const all = useApp((s) => s.site.openings);
  const site = useApp((s) => s.site);
  const aduEnabled = useApp((s) => s.aduEnabled);
  const present = useMemo(() => new Set(activeStructures(site, { aduEnabled }).flatMap((st) => [st.id, st.group ?? st.id])), [site, aduEnabled]);
  const openings = useMemo(() => all?.filter((o) => !o.building || present.has(o.building)), [all, present]);
  const env = useSkyEnvironment();
  if (!openings?.length) return null;
  return <group {...noHit}>{openings.map((o) => <OpeningMesh key={o.id} o={o} env={env} />)}</group>;
}

/** A screen of vertical wood slats (2x4s turned like louvers) between two thick posts, standing on a porch floor. */
function SlatScreen({ o }: { o: ContextObjectCfg }) {
  const line = o.line ?? [];
  const a = line[0], b = line[line.length - 1];
  const len = a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
  const ang = a && b ? Math.atan2(b[1] - a[1], b[0] - a[0]) : 0;
  const base = o.baseHeight ?? 0;
  const h = o.height - base;
  const post = o.endPostFt ?? 0.38;
  const cfg = { slatFt: o.slatFt ?? 0.125, slatWidthFt: o.slatWidthFt ?? 0.2917, slatAngleDeg: o.slatAngleDeg ?? 45, slatCount: o.slatCount ?? 25, endPostFt: post };
  const color = o.color ?? '#d3992b';
  const layout = useMemo(() => slatLayout(len, cfg), [len, cfg.slatFt, cfg.slatWidthFt, cfg.slatAngleDeg, cfg.slatCount, post]); // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const t = new THREE.Object3D();
    layout.centers.forEach((x, i) => {
      t.position.set(x, 0, base + h / 2);
      t.rotation.set(0, 0, (cfg.slatAngleDeg * Math.PI) / 180);
      t.updateMatrix();
      m.setMatrixAt(i, t.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [layout, base, h, cfg.slatAngleDeg]);
  if (!a || !b || len <= 0) return null;
  return (
    <group position={[a[0], a[1], 0]} rotation={[0, 0, ang]} {...noHit}>
      {[0, len].map((x) => (
        <mesh key={x} position={[x, 0, base + h / 2]} castShadow receiveShadow {...noHit}>
          <boxGeometry args={[post, post, h]} />
          <meshStandardMaterial color={color} roughness={0.7} />
        </mesh>
      ))}
      <instancedMesh key={layout.centers.length} ref={ref} args={[undefined, undefined, Math.max(1, layout.centers.length)]} castShadow receiveShadow frustumCulled={false} {...noHit}>
        <boxGeometry args={[cfg.slatFt, cfg.slatWidthFt, h]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </instancedMesh>
    </group>
  );
}

function PostMesh({ o }: { o: ContextObjectCfg }) {
  const [x, y] = o.position ?? [0, 0];
  const base = o.baseHeight ?? 0;
  const s = o.postFt ?? 0.4;
  return (
    <mesh position={[x, y, base + (o.height - base) / 2]} castShadow receiveShadow {...noHit}>
      <boxGeometry args={[s, s, o.height - base]} />
      <meshStandardMaterial color={o.color ?? '#d3992b'} roughness={0.7} />
    </mesh>
  );
}

/** The permanent wood on the house front: the slatted screen and the porch post. */
export function Screens() {
  const objects = useApp((s) => s.site.contextObjects);
  return (
    <group {...noHit}>
      {objects.map((o) => (o.kind === 'screen' ? <SlatScreen key={o.id} o={o} /> : o.kind === 'post' ? <PostMesh key={o.id} o={o} /> : null))}
    </group>
  );
}
