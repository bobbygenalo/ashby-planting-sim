import { WalkRig } from './Walk';
import { driftOffset } from '../engine/drift';
import { viewPose } from './viewPose';
import { depthBias, useOverlayBase } from './overlay';
import { skyColor } from '../engine/sky';
import { tiledSurface } from './surfaces';
import { useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { elementAt } from '../engine/hardscape';
import { Html, Line, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { activeStructures, overhangPoints, roofPoints } from '../engine/site';
import { solarPosition, sunVectorSite } from '../engine/solar';
import { classify, type SunHoursResult } from '../engine/sunhours';
import { localToUtc, doyToMonthDay } from '../engine/time';
import { formatFeetInches } from '../engine/units';
import type { ContextObjectCfg, Pt, StructureCfg } from '../engine/types';
import { appStore, useApp } from '../store/store';
import { PlantLayer } from './Plants';
import { CropLayer } from './Crops';
import { HolidayLights } from './HolidayLights';
import { LifeLayer } from './Life';
import { HardscapeLayer, useSnapper } from './Hardscape';
import { ConflictRings, SuggestionLayer } from './Suggestions';

const SITE_TO_THREE = (x: number, y: number, z: number): [number, number, number] => [x, z, -y];

function shapeOf(poly: Pt[]) {
  return new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
}

function StructureMesh({ s, rank = 0 }: { s: StructureCfg; rank?: number }) {
  const walls = useMemo(
    () => new THREE.ExtrudeGeometry(shapeOf(s.footprint), { depth: s.eaveHeight, bevelEnabled: false }),
    [s],
  );
  const roof = useMemo(() => new ConvexGeometry(roofPoints(s).map(([x, y, z]) => new THREE.Vector3(x, y, z))), [s]);
  const slab = useMemo(() => { const p = overhangPoints(s); return p ? new ConvexGeometry(p.map(([x, y, z]) => new THREE.Vector3(x, y, z))) : null; }, [s]);
  const proposed = s.status === 'proposed';
  return (
    <group>
      {/* Where parts of a building meet, their faces can lie in one plane (a fin's roof and the slab above it): a roof wins over a
          wall, a slab over a roof, and a later part over an earlier one, by a hair of depth, so the same one is always seen. */}
      <mesh geometry={walls} castShadow receiveShadow>
        <meshStandardMaterial color={proposed ? '#cdd8e6' : '#e9e3d6'} roughness={0.9} {...depthBias(0, rank)} />
      </mesh>
      <mesh geometry={roof} castShadow receiveShadow>
        <meshStandardMaterial color={proposed ? '#5d6b7d' : '#6d5b52'} roughness={0.8} {...depthBias(1, rank)} />
      </mesh>
      {slab && (
        <mesh geometry={slab} castShadow receiveShadow>
          <meshStandardMaterial color={proposed ? '#5d6b7d' : '#6d5b52'} roughness={0.8} {...depthBias(2, rank)} />
        </mesh>
      )}
    </group>
  );
}

/** One run of fence or wall: boards (or blocks) on posts, with a cap along the top. */
function FenceRun({ a, b, o }: { a: [number, number]; b: [number, number]; o: ContextObjectCfg }) {
  const cfg = useApp((st) => st.engine.hardscape.fence);
  const isWall = o.kind === 'wall';
  const t = o.thickness ?? 0.3;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const tex = useMemo(() => {
    const m = tiledSurface(isWall ? 'cmu' : 'boards', 4);
    // One repeat per four feet along the run and up its height, on every face of the box.
    m?.repeat.set(len / 4, o.height / 4);
    return m;
  }, [isWall, len, o.height]);
  useEffect(() => () => tex?.dispose(), [tex]);
  const posts = isWall ? 0 : Math.max(1, Math.round(len / cfg.postSpacingFt));
  const color = isWall ? '#a6a29a' : '#b49a78';
  return (
    <group position={[a[0], a[1], 0]} rotation={[0, 0, ang]}>
      <mesh position={[len / 2, 0, o.height / 2]} castShadow receiveShadow>
        <boxGeometry args={[len, t, o.height]} />
        <meshStandardMaterial color={color} map={tex} bumpMap={tex} bumpScale={0.7} roughness={1} />
      </mesh>
      {/* The cap rail along the top, a little wider than the fence. */}
      <mesh position={[len / 2, 0, o.height + cfg.capFt / 2]} castShadow>
        <boxGeometry args={[len + cfg.capOverhangFt * 2, t + cfg.capOverhangFt * 2, cfg.capFt]} />
        <meshStandardMaterial color={isWall ? '#bdb9b1' : '#9a8460'} roughness={1} />
      </mesh>
      {Array.from({ length: posts + 1 }, (_, i) => (
        <mesh key={i} position={[(i / posts) * len, 0, (o.height + cfg.postRiseFt) / 2]} castShadow>
          <boxGeometry args={[cfg.postFt, t + cfg.postFt * 0.5, o.height + cfg.postRiseFt]} />
          <meshStandardMaterial color="#8f7a58" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function FenceMesh({ o }: { o: ContextObjectCfg }) {
  const line = o.line ?? [];
  return (
    <group>
      {line.slice(0, -1).map((a, i) => <FenceRun key={i} a={a} b={line[i + 1]} o={o} />)}
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
  const base = useOverlayBase();
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
    <mesh position={[w / 2, h / 2, base + 0.01]} renderOrder={2}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

/** The background follows the sun: bright by day, a warm glow at sunset, dark at night. */
function Sky() {
  const site = useApp((s) => s.site);
  const engine = useApp((s) => s.engine);
  const doy = useApp((s) => s.doy);
  const minutes = useApp((s) => s.minutes);
  const [month, day] = doyToMonthDay(doy);
  const sun = solarPosition(localToUtc(site.timeZone, engine.referenceYear, month, day, 0, minutes), site.latitude, site.longitude, engine.sun.refraction);
  return <color attach="background" args={[skyColor(sun.elevationDeg, engine.sky)]} />;
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
        shadow-mapSize={[2048, 2048]}
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
  const lotZ = useOverlayBase() + 0.02;
  const snap = useApp((s) => s.snap);
  const measureActive = useApp((s) => s.measureActive);
  const addMeasurePoint = useApp((s) => s.addMeasurePoint);
  const placing = useApp((s) => s.placingSpeciesId);
  const addInstance = useApp((s) => s.addInstance);
  const setHover = useApp((s) => s.setHover);
  const select = useApp((s) => s.select);
  const dragId = useApp((s) => s.dragId);
  const updateInstance = useApp((s) => s.updateInstance);
  const drawing = useApp((s) => s.drawing);
  const addDrawPoint = useApp((s) => s.addDrawPoint);
  const finishDrawing = useApp((s) => s.finishDrawing);
  const placePreset = useApp((s) => s.placePreset);
  const duplicateElement = useApp((s) => s.duplicateElement);
  const hardscapeAll = useApp((s) => s.hardscape);
  const editMode = useApp((s) => s.mode === 'edit');
  const controls = useThree((st) => st.controls) as unknown as { enabled: boolean } | null;
  const selectHive = useApp((s) => s.selectHive);
  const hiveDragging = useApp((s) => s.hiveDragging);
  const moveHive = useApp((s) => s.moveHive);
  const hardscapeCfg = useApp((s) => s.engine.hardscape);
  const selectElement = useApp((s) => s.selectElement);
  const hsDrag = useApp((s) => s.hsDrag);
  const setVertex = useApp((s) => s.setVertex);
  const moveElementBy = useApp((s) => s.moveElementBy);
  const setHsDrag = useApp((s) => s.setHsDrag);
  const snapper = useSnapper(hsDrag?.id);
  const { width, depth } = site.lot;
  const gridPoint = (e: ThreeEvent<MouseEvent | PointerEvent>): [number, number] => [
    Math.round(e.point.x / snap) * snap,
    Math.round(-e.point.z / snap) * snap,
  ];
  const clampPt = (x: number, y: number): [number, number] => [Math.min(width, Math.max(0, x)), Math.min(depth, Math.max(0, y))];
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    // A click that follows a drag (reshaping, moving) is not a click on the ground.
    if (e.delta > 3) return;
    if (measureActive) {
      e.stopPropagation();
      addMeasurePoint(gridPoint(e));
    } else if (placing) {
      e.stopPropagation();
      const [x, y] = gridPoint(e);
      if (x >= 0 && x <= width && y >= 0 && y <= depth) addInstance(placing, [x, y]);
    } else if (drawing) {
      e.stopPropagation();
      const spot = snapper([e.point.x, -e.point.z]).point;
      if (hardscapeCfg.types[drawing.type].placeSize) placePreset(spot);
      else addDrawPoint(spot);
    } else {
      select(null);
      selectElement(null);
      selectHive(false);
    }
  };
  // Option-drag copies whatever hardscape lies under the pointer, even when its own mesh did not take the press
  // (a flat patio under an overlay, say): the topmost element at that spot is copied and the copy dragged.
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (!e.nativeEvent.altKey || !editMode || drawing || placing || measureActive) return;
    const el = elementAt(hardscapeAll, [e.point.x, -e.point.z], hardscapeCfg);
    if (!el) return;
    e.stopPropagation();
    const copyId = duplicateElement(el.id, [0, 0]);
    if (!copyId) return;
    setHsDrag({ id: copyId, kind: 'move', last: [e.point.x, -e.point.z] });
    if (controls) controls.enabled = false;
  };
  const onDouble = (e: ThreeEvent<MouseEvent>) => {
    if (!drawing) return;
    e.stopPropagation();
    finishDrawing();
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (placing) setHover(gridPoint(e));
    if (drawing) {
      const s = snapper([e.point.x, -e.point.z]);
      setHover(s.point, s.kind);
    }
    if (hiveDragging) {
      const [x, y] = gridPoint(e);
      moveHive(clampPt(x, y));
    }
    if (dragId) {
      const [x, y] = gridPoint(e);
      updateInstance(dragId, { position: clampPt(x, y) }, { silent: true });
    }
    if (hsDrag?.kind === 'vertex') {
      const s = snapper([e.point.x, -e.point.z]);
      setVertex(hsDrag.id, hsDrag.index, clampPt(s.point[0], s.point[1]));
      setHover(s.point, s.kind);
    } else if (hsDrag?.kind === 'move') {
      const [gx, gy] = gridPoint(e);
      const [lx, ly] = [Math.round(hsDrag.last[0] / snap) * snap, Math.round(hsDrag.last[1] / snap) * snap];
      if (gx !== lx || gy !== ly) {
        moveElementBy(hsDrag.id, gx - lx, gy - ly);
        setHsDrag({ ...hsDrag, last: [e.point.x, -e.point.z] });
      }
    }
  };
  // The bare ground between everything else: dusty and slightly gritty, not a flat color.
  const groundTex = useMemo(() => tiledSurface('granular', 6), []);
  useEffect(() => () => groundTex?.dispose(), [groundTex]);
  return (
    <>
      <mesh position={[width / 2, depth / 2, -0.05]} receiveShadow>
        <planeGeometry args={[400, 500]} />
        <meshStandardMaterial color="#b9bdb0" />
      </mesh>
      <mesh position={[width / 2, depth / 2, 0]} receiveShadow onClick={onClick} onDoubleClick={onDouble} onPointerDown={onDown} onPointerMove={onMove}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#a9b98f" map={groundTex} bumpMap={groundTex} bumpScale={0.6} roughness={1} />
      </mesh>
      <Line
        points={[[0, 0, lotZ], [width, 0, lotZ], [width, depth, lotZ], [0, depth, lotZ], [0, 0, lotZ]]}
        color="#222"
        lineWidth={2}
      />
    </>
  );
}

function Setbacks() {
  const site = useApp((s) => s.site);
  const zLine = useOverlayBase() + 0.03;
  const { width: w, depth: d } = site.lot;
  return (
    <>
      {site.setbacks.map((sb) => {
        const pts: [number, number, number][] =
          sb.edge === 'left' ? [[sb.distance, 0, zLine], [sb.distance, d, zLine]]
          : sb.edge === 'right' ? [[w - sb.distance, 0, zLine], [w - sb.distance, d, zLine]]
          : sb.edge === 'rear' ? [[0, d - sb.distance, zLine], [w, d - sb.distance, zLine]]
          : [[0, sb.distance, zLine], [w, sb.distance, zLine]];
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


/**
 * Remembers where the current camera is looking on the ground (the point at the middle of the view) and which way it faces,
 * so that entering the Walk view drops the person there instead of at a fixed spot.
 */
function ViewPoseTracker() {
  const dir = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    const st = appStore.getState();
    if (st.site.views.find((v) => v.id === st.view)?.kind === 'walk') return;
    if (import.meta.env.DEV) (window as unknown as { __cam?: THREE.Camera }).__cam = camera; // for inspecting the camera from the console
    const o = camera.position;
    camera.getWorldDirection(dir);
    // The ground under the middle of the view; with the camera level or looking up, a point a little way ahead of it.
    let gx: number, gz: number;
    if (dir.y < -0.05) {
      const t = -o.y / dir.y;
      gx = o.x + dir.x * Math.min(t, 600);
      gz = o.z + dir.z * Math.min(t, 600);
    } else {
      gx = o.x + dir.x * 30;
      gz = o.z + dir.z * 30;
    }
    // Which way it faces along the ground; looking straight down, the way the top of the screen points.
    let hx = dir.x, hy = -dir.z;
    if (Math.hypot(hx, hy) < 0.25) {
      up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      hx = up.x;
      hy = -up.z;
    }
    viewPose.valid = true;
    viewPose.x = gx;
    viewPose.y = -gz;
    viewPose.heading = Math.atan2(hx, hy);
  });
  return null;
}

/**
 * Slowly circles the camera round the property, counter-clockwise seen from above, for a view that has `drift`. It stops while
 * the viewer has hold of the view (and for `resumeS` seconds after), while anything is selected, in hand to place, being
 * dragged or measured, when the layer is off, and for anyone who has asked their system for less motion.
 */
function Drift({ degPerSecond, resumeS }: { degPerSecond: number; resumeS: number }) {
  const controls = useThree((st) => st.controls) as unknown as (THREE.EventDispatcher & { target: THREE.Vector3; update: () => void }) | null;
  const enabled = useApp((s) => s.layers.drift);
  const busy = useApp((s) => !!(s.selectedId || s.selectedElementId || s.hiveSelected || s.placingSpeciesId || s.drawing || s.hsDrag || s.dragId || s.measureActive || s.quickFindOpen));
  const held = useMemo(() => ({ down: false, last: -1e9 }), []);
  const calm = useMemo(() => (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) || false, []);
  useEffect(() => {
    if (!controls) return;
    const start = () => { held.down = true; };
    const end = () => { held.down = false; held.last = performance.now(); };
    controls.addEventListener('start' as never, start);
    controls.addEventListener('end' as never, end);
    return () => { controls.removeEventListener('start' as never, start); controls.removeEventListener('end' as never, end); };
  }, [controls, held]);
  useFrame(({ camera }, dt) => {
    if (!controls || !enabled || busy || calm || held.down || performance.now() - held.last < resumeS * 1000) return;
    const t = controls.target;
    const o = driftOffset(camera.position.x - t.x, camera.position.z - t.z, degPerSecond, Math.min(dt, 0.1));
    camera.position.x = t.x + o.x;
    camera.position.z = t.z + o.z;
    controls.update();
  });
  return null;
}

function Cameras() {
  const site = useApp((s) => s.site);
  const view = useApp((s) => s.view);
  const engine = useApp((s) => s.engine);
  const { size } = useThree();
  const cfg = site.views.find((v) => v.id === view) ?? site.views[0];
  const cx = site.lot.width / 2;
  const cy = site.lot.depth / 2;
  if (cfg.kind === 'plan') {
    // Fit the whole lot (plus a 35 ft margin) into the part of the yard the time controls leave free, and center it
    // there, so it is centered between the top edge and the controls at any window shape.
    const dock = document.querySelector('.simdock')?.getBoundingClientRect().height ?? 0;
    const covered = dock > 0 ? dock + 10 : 0;
    const visibleH = Math.max(1, size.height - covered);
    const needH = site.lot.depth + 70;
    const needW = site.lot.width + 40;
    const pxPerFt = Math.min(visibleH / needH, size.width / needW);
    const halfH = size.height / (2 * pxPerFt);
    const halfW = size.width / (2 * pxPerFt);
    const cyView = cy - covered / 2 / pxPerFt; // the free area's center sits above the stage's by half the covered strip
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
        <OrbitControls key="plan-ctl" makeDefault enableDamping={false} target={[cx, 0, -cyView]} enableRotate={false} screenSpacePanning />
      </>
    );
  }
  if (cfg.kind === 'walk') {
    // First person: no orbit controls; WalkRig moves the camera with the keyboard.
    return (
      <>
        <PerspectiveCamera key={`cam-${cfg.id}`} makeDefault fov={engine.player.fovDeg} near={0.1} far={2000} position={SITE_TO_THREE(cfg.position?.[0] ?? cx, cfg.position?.[1] ?? 14, engine.player.eyeHeightFt)} />
        <WalkRig key={`rig-${cfg.id}`} viewId={cfg.id} />
      </>
    );
  }
  const pos = SITE_TO_THREE(...(cfg.position ?? [cx, -60, 60]));
  const tgt = SITE_TO_THREE(...(cfg.target ?? [cx, cy, 0]));
  return (
    <>
      <PerspectiveCamera key={`cam-${cfg.id}`} makeDefault fov={48} near={1} far={1500} position={pos} />
      <OrbitControls key={`ctl-${cfg.id}`} makeDefault enableDamping={false} target={tgt} maxPolarAngle={Math.PI / 2 - 0.02} />
      {cfg.drift && <Drift key={`drift-${cfg.id}`} degPerSecond={cfg.drift.degPerSecond} resumeS={cfg.drift.resumeS} />}
    </>
  );
}

export function SiteScene({ sunResult }: { sunResult: SunHoursResult | null }) {
  const site = useApp((s) => s.site);
  const aduEnabled = useApp((s) => s.aduEnabled);
  const layers = useApp((s) => s.layers);
  const target = useMemo(() => new THREE.Object3D(), []);
  const overlayBase = useOverlayBase();
  const structures = activeStructures(site, { aduEnabled });

  return (
    <Canvas shadows dpr={[1, 1.5]} gl={{ antialias: true }}>
      <Sky />
      <Cameras />
      <ViewPoseTracker />
      <Sun target={target} />
      {/* Site coordinates: x across the lot, y toward the rear, z up. Rotating -90 deg about X maps them to three.js (x, z, -y). */}
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <Ground />
        {layers.easements &&
          site.easements.map((e) => <FlatPoly key={e.id} poly={e.polygon} z={overlayBase} color="#f59e0b" opacity={0.55} />)}
        {layers.setbacks && <Setbacks />}
        {structures.map((s, i) => (
          <StructureMesh key={s.id} s={s} rank={i} />
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
        <HardscapeLayer />
        <CropLayer />
        <PlantLayer />
        <HolidayLights />
        {layers.life && <LifeLayer />}
        <ConflictRings />
        <SuggestionLayer />
        <Compass />
        <Measure />
      </group>
    </Canvas>
  );
}
