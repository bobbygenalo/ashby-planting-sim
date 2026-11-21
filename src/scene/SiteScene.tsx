import { useMemo } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, Line, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { activeStructures, roofPoints } from '../engine/site';
import { solarPosition, sunVectorSite } from '../engine/solar';
import { classify, type SunHoursResult } from '../engine/sunhours';
import { localToUtc, doyToMonthDay } from '../engine/time';
import { formatFeetInches } from '../engine/units';
import type { ContextObjectCfg, Pt, StructureCfg } from '../engine/types';
import { useApp } from '../store/store';
import { PlantLayer } from './Plants';

const SITE_TO_THREE = (x: number, y: number, z: number): [number, number, number] => [x, z, -y];

function shapeOf(poly: Pt[]) {
  return new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
}

function StructureMesh({ s }: { s: StructureCfg }) {
  const walls = useMemo(
    () => new THREE.ExtrudeGeometry(shapeOf(s.footprint), { depth: s.eaveHeight, bevelEnabled: false }),
    [s],
  );
  const roof = useMemo(() => new ConvexGeometry(roofPoints(s).map(([x, y, z]) => new THREE.Vector3(x, y, z))), [s]);
  const proposed = s.status === 'proposed';
  return (
    <group>
      <mesh geometry={walls} castShadow receiveShadow>
        <meshStandardMaterial color={proposed ? '#cdd8e6' : '#e9e3d6'} roughness={0.9} />
      </mesh>
      <mesh geometry={roof} castShadow receiveShadow>
        <meshStandardMaterial color={proposed ? '#5d6b7d' : '#6d5b52'} roughness={0.8} />
      </mesh>
    </group>
  );
}

function FenceMesh({ o }: { o: ContextObjectCfg }) {
  const line = o.line ?? [];
  const t = o.thickness ?? 0.3;
  return (
    <group>
      {line.slice(0, -1).map(([x1, y1], i) => {
        const [x2, y2] = line[i + 1];
        const len = Math.hypot(x2 - x1, y2 - y1);
        const ang = Math.atan2(y2 - y1, x2 - x1);
        return (
          <mesh key={i} position={[(x1 + x2) / 2, (y1 + y2) / 2, o.height / 2]} rotation={[0, 0, ang]} castShadow receiveShadow>
            <boxGeometry args={[len, t, o.height]} />
            <meshStandardMaterial color="#b49a78" roughness={1} />
          </mesh>
        );
      })}
    </group>
  );
}

function TreeMesh({ o }: { o: ContextObjectCfg }) {
  const showTags = useApp((s) => s.layers.dimensions);
  const [x, y] = o.position ?? [0, 0];
  const r = (o.canopyWidth ?? 10) / 2;
  const base = o.trunkHeight ?? o.height * 0.3;
  const canopyH = o.height - base;
  return (
    <group position={[x, y, 0]}>
      <mesh position={[0, 0, base / 2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.5, 0.7, base, 8]} />
        <meshStandardMaterial color="#6b4f3a" />
      </mesh>
      <mesh position={[0, 0, base + canopyH / 2]} scale={[r, r, canopyH / 2]} castShadow>
        <sphereGeometry args={[1, 20, 14]} />
        <meshStandardMaterial color="#4f7d45" roughness={1} transparent opacity={0.92} />
      </mesh>
      {o.placeholder && showTags && (
        <Html position={[0, 0, o.height + 1.5]} center style={{ pointerEvents: 'none' }}>
          <span className="tag">placeholder</span>
        </Html>
      )}
    </group>
  );
}

function PoleMesh({ o }: { o: ContextObjectCfg }) {
  const [x, y] = o.position ?? [0, 0];
  return (
    <mesh position={[x, y, o.height / 2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
      <cylinderGeometry args={[0.45, 0.6, o.height, 8]} />
      <meshStandardMaterial color="#7a6a58" />
    </mesh>
  );
}

function FlatPoly({ poly, z, color, opacity }: { poly: Pt[]; z: number; color: string; opacity: number }) {
  const geo = useMemo(() => new THREE.ShapeGeometry(shapeOf(poly)), [poly]);
  return (
    <mesh geometry={geo} position={[0, 0, z]} receiveShadow>
      <meshStandardMaterial color={color} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  );
}

const CLASS_RGBA: [number, number, number, number][] = [
  [45, 45, 105, 175],
  [80, 130, 205, 150],
  [245, 170, 55, 140],
  [255, 230, 80, 125],
];

function SunOverlay({ result }: { result: SunHoursResult }) {
  const classes = useApp((s) => s.engine.sun.classes);
  const texture = useMemo(() => {
    const data = new Uint8Array(result.nx * result.ny * 4);
    for (let k = 0; k < result.hours.length; k++) {
      if (result.mask[k] !== 1) continue;
      const c = CLASS_RGBA[classify(result.hours[k], classes)];
      data.set(c, k * 4);
    }
    const tex = new THREE.DataTexture(data, result.nx, result.ny, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  }, [result, classes]);
  const w = result.nx * result.cellSize;
  const h = result.ny * result.cellSize;
  return (
    <mesh position={[w / 2, h / 2, 0.08]} renderOrder={2}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

function Sun({ target }: { target: THREE.Object3D }) {
  const site = useApp((s) => s.site);
  const engine = useApp((s) => s.engine);
  const doy = useApp((s) => s.doy);
  const minutes = useApp((s) => s.minutes);
  const [month, day] = doyToMonthDay(doy);
  const utc = localToUtc(site.timeZone, engine.referenceYear, month, day, 0, minutes);
  const sun = solarPosition(utc, site.latitude, site.longitude, engine.sun.refraction);
  const v = sunVectorSite(site.rearBearingDeg, site.driveSide, sun.azimuthDeg, Math.max(sun.elevationDeg, 0.5));
  const [tx, ty, tz] = SITE_TO_THREE(site.lot.width / 2, site.lot.depth / 2, 0);
  const [dx, dy, dz] = SITE_TO_THREE(v[0], v[1], v[2]);
  const up = sun.elevationDeg > 0;
  return (
    <>
      <primitive object={target} position={[tx, ty, tz]} />
      <directionalLight
        position={[tx + dx * 260, ty + dy * 260, tz + dz * 260]}
        target={target}
        intensity={up ? 2.6 : 0.15}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-camera-left={-110}
        shadow-camera-right={110}
        shadow-camera-top={110}
        shadow-camera-bottom={-110}
        shadow-camera-near={10}
        shadow-camera-far={700}
        shadow-bias={-0.0004}
        shadow-normalBias={0.05}
      />
      <hemisphereLight args={['#cfe3ff', '#7d8a6a', up ? 0.7 : 0.25]} />
    </>
  );
}

function Ground() {
  const site = useApp((s) => s.site);
  const snap = useApp((s) => s.snap);
  const measureActive = useApp((s) => s.measureActive);
  const addMeasurePoint = useApp((s) => s.addMeasurePoint);
  const placing = useApp((s) => s.placingSpeciesId);
  const addInstance = useApp((s) => s.addInstance);
  const setHover = useApp((s) => s.setHover);
  const select = useApp((s) => s.select);
  const { width, depth } = site.lot;
  const snapPoint = (e: ThreeEvent<MouseEvent | PointerEvent>): [number, number] => [
    Math.round(e.point.x / snap) * snap,
    Math.round(-e.point.z / snap) * snap,
  ];
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (measureActive) {
      e.stopPropagation();
      addMeasurePoint(snapPoint(e));
    } else if (placing) {
      e.stopPropagation();
      const [x, y] = snapPoint(e);
      if (x >= 0 && x <= width && y >= 0 && y <= depth) addInstance(placing, [x, y]);
    } else {
      select(null);
    }
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (placing) setHover(snapPoint(e));
  };
  return (
    <>
      <mesh position={[width / 2, depth / 2, -0.05]} receiveShadow>
        <planeGeometry args={[400, 500]} />
        <meshStandardMaterial color="#b9bdb0" />
      </mesh>
      <mesh position={[width / 2, depth / 2, 0]} receiveShadow onClick={onClick} onPointerMove={onMove}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#a9b98f" roughness={1} />
      </mesh>
      <Line
        points={[[0, 0, 0.1], [width, 0, 0.1], [width, depth, 0.1], [0, depth, 0.1], [0, 0, 0.1]]}
        color="#222"
        lineWidth={2}
      />
    </>
  );
}

function Setbacks() {
  const site = useApp((s) => s.site);
  const { width: w, depth: d } = site.lot;
  return (
    <>
      {site.setbacks.map((sb) => {
        const pts: [number, number, number][] =
          sb.edge === 'left' ? [[sb.distance, 0, 0.12], [sb.distance, d, 0.12]]
          : sb.edge === 'right' ? [[w - sb.distance, 0, 0.12], [w - sb.distance, d, 0.12]]
          : sb.edge === 'rear' ? [[0, d - sb.distance, 0.12], [w, d - sb.distance, 0.12]]
          : [[0, sb.distance, 0.12], [w, sb.distance, 0.12]];
        return <Line key={sb.id} points={pts} color="#c0392b" lineWidth={1.5} dashed dashSize={2} gapSize={1.5} />;
      })}
    </>
  );
}

function Compass() {
  const site = useApp((s) => s.site);
  const n = sunVectorSite(site.rearBearingDeg, site.driveSide, 0, 0);
  const o: [number, number] = [-14, 12];
  const tip: [number, number, number] = [o[0] + n[0] * 10, o[1] + n[1] * 10, 0.2];
  return (
    <group>
      <Line points={[[o[0], o[1], 0.2], tip]} color="#111" lineWidth={3} />
      <Html position={[tip[0] + n[0] * 2, tip[1] + n[1] * 2, 0.2]} center style={{ pointerEvents: 'none' }}>
        <span className="north">N</span>
      </Html>
    </group>
  );
}

function Measure() {
  const pts = useApp((s) => s.measurePoints);
  if (pts.length === 0) return null;
  const [a, b] = pts;
  return (
    <group>
      {pts.map(([x, y], i) => (
        <mesh key={i} position={[x, y, 0.3]}>
          <sphereGeometry args={[0.45, 12, 8]} />
          <meshBasicMaterial color="#e11d48" />
        </mesh>
      ))}
      {b && (
        <>
          <Line points={[[a[0], a[1], 0.3], [b[0], b[1], 0.3]]} color="#e11d48" lineWidth={3} />
          <Html position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 1]} center style={{ pointerEvents: 'none' }}>
            <span className="measure-label">
              {formatFeetInches(Math.hypot(b[0] - a[0], b[1] - a[1]))}
              <small>
                {' '}dx {formatFeetInches(Math.abs(b[0] - a[0]))} dy {formatFeetInches(Math.abs(b[1] - a[1]))}
              </small>
            </span>
          </Html>
        </>
      )}
    </group>
  );
}

function Dimensions() {
  const site = useApp((s) => s.site);
  const aduEnabled = useApp((s) => s.aduEnabled);
  const { width: w, depth: d } = site.lot;
  const tag = (text: string, pos: [number, number, number]) => (
    <Html key={text + pos.join()} position={pos} center style={{ pointerEvents: 'none' }}>
      <span className="dim-label">{text}</span>
    </Html>
  );
  return (
    <group>
      {tag(formatFeetInches(w), [w / 2, -3, 0.5])}
      {tag(formatFeetInches(d), [w + 4, d / 2, 0.5])}
      {activeStructures(site, { aduEnabled }).map((s) => {
        const xs = s.footprint.map((p) => p[0]);
        const ys = s.footprint.map((p) => p[1]);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        return [
          tag(formatFeetInches(x1 - x0), [(x0 + x1) / 2, y0 - 1.5, 0.5]),
          tag(formatFeetInches(y1 - y0), [x1 + 2.5, (y0 + y1) / 2, 0.5]),
        ];
      })}
    </group>
  );
}

function Cameras() {
  const site = useApp((s) => s.site);
  const view = useApp((s) => s.view);
  const { size } = useThree();
  const cfg = site.views.find((v) => v.id === view) ?? site.views[0];
  const cx = site.lot.width / 2;
  const cy = site.lot.depth / 2;
  if (cfg.kind === 'plan') {
    // Frustum in feet, fit so the whole lot (plus margin) is visible at any aspect ratio.
    const aspect = size.width / Math.max(1, size.height);
    const needH = site.lot.depth + 70;
    const cyView = cy - 24; // shift the lot up so the bottom control bar does not cover it
    const needW = site.lot.width + 40;
    const halfH = Math.max(needH, needW / aspect) / 2;
    const halfW = halfH * aspect;
    return (
      <>
        {/* Straight down, offset 0.5 ft toward the street so the rear of the lot is screen-up without a custom up vector. */}
        <OrthographicCamera
          key="plan-cam"
          makeDefault
          manual
          position={[cx, 400, -cyView + 0.5]}
          left={-halfW}
          right={halfW}
          top={halfH}
          bottom={-halfH}
          zoom={1}
          near={1}
          far={1200}
        />
        <OrbitControls key="plan-ctl" makeDefault target={[cx, 0, -cyView]} enableRotate={false} screenSpacePanning />
      </>
    );
  }
  const pos = SITE_TO_THREE(...(cfg.position ?? [cx, -60, 60]));
  const tgt = SITE_TO_THREE(...(cfg.target ?? [cx, cy, 0]));
  return (
    <>
      <PerspectiveCamera key={`cam-${cfg.id}`} makeDefault fov={48} near={0.5} far={2000} position={pos} />
      <OrbitControls key={`ctl-${cfg.id}`} makeDefault target={tgt} maxPolarAngle={Math.PI / 2 - 0.02} />
    </>
  );
}

export function SiteScene({ sunResult }: { sunResult: SunHoursResult | null }) {
  const site = useApp((s) => s.site);
  const aduEnabled = useApp((s) => s.aduEnabled);
  const layers = useApp((s) => s.layers);
  const target = useMemo(() => new THREE.Object3D(), []);
  const structures = activeStructures(site, { aduEnabled });

  return (
    <Canvas shadows="soft" dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={['#dfe7ee']} />
      <Cameras />
      <Sun target={target} />
      {/* Site coordinates: x across the lot, y toward the rear, z up. Rotating -90 deg about X maps them to three.js (x, z, -y). */}
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <Ground />
        {site.hardscape.map((h) => (
          <FlatPoly key={h.id} poly={h.polygon} z={0.04} color="#9a9a96" opacity={1} />
        ))}
        {layers.easements &&
          site.easements.map((e) => <FlatPoly key={e.id} poly={e.polygon} z={0.06} color="#f59e0b" opacity={0.55} />)}
        {layers.setbacks && <Setbacks />}
        {structures.map((s) => (
          <StructureMesh key={s.id} s={s} />
        ))}
        {layers.context &&
          site.contextObjects.map((o) =>
            o.kind === 'tree' ? <TreeMesh key={o.id} o={o} />
            : o.kind === 'pole' ? <PoleMesh key={o.id} o={o} />
            : o.kind === 'fence' || o.kind === 'wall' ? <FenceMesh key={o.id} o={o} />
            : null,
          )}
        {layers.sunHours && sunResult && <SunOverlay result={sunResult} />}
        {layers.dimensions && <Dimensions />}
        <PlantLayer />
        <Compass />
        <Measure />
      </group>
    </Canvas>
  );
}
