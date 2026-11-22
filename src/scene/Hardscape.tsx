import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import { polygonArea } from '../engine/geometry';
import { footprint, snapAnchors, snapPoint, type SnapResult } from '../engine/hardscape';
import { activeStructures } from '../engine/site';
import { formatFeetInches } from '../engine/units';
import type { HardscapeElement, Material, Pt } from '../engine/types';
import { tableLayout } from '../engine/furniture';
import { chairPull } from './chairState';
import { chairGeometry, modelFor, rectFrame } from './furniture';
import { useApp } from '../store/store';

const SNAP_COLOR: Record<SnapResult['kind'], string> = { vertex: '#f97316', edge: '#2563eb', grid: '#6b7280' };

/** Snap a ground point using the drawing rules (corner, then edge, then grid). Shared by drawing and vertex drags. */
export function useSnapper(excludeId?: string) {
  const site = useApp((s) => s.site);
  const engine = useApp((s) => s.engine);
  const aduEnabled = useApp((s) => s.aduEnabled);
  const hardscape = useApp((s) => s.hardscape);
  const snap = useApp((s) => s.snap);
  const anchors = useMemo(
    () => snapAnchors(site, activeStructures(site, { aduEnabled }), hardscape, engine.hardscape, excludeId),
    [site, aduEnabled, hardscape, engine, excludeId],
  );
  return (p: Pt): SnapResult => snapPoint(p, snap, anchors, engine.hardscape.snapToleranceFt);
}

function ElementMesh({ el, mat, z }: { el: HardscapeElement; mat: Material | undefined; z: number }) {
  const cfg = useApp((s) => s.engine.hardscape);
  const selectedId = useApp((s) => s.selectedElementId);
  const tool = useApp((s) => s.drawing || s.placingSpeciesId || s.measureActive);
  const edit = useApp((s) => s.mode === 'edit');
  const selectElement = useApp((s) => s.selectElement);
  const setHsDrag = useApp((s) => s.setHsDrag);
  const beginGesture = useApp((s) => s.beginGesture);
  const duplicateElement = useApp((s) => s.duplicateElement);
  const controls = useThree((st) => st.controls) as unknown as { enabled: boolean } | null;
  const poly = useMemo(() => footprint(el, cfg), [el, cfg]);
  const geo = useMemo(() => {
    const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
    return el.height > 0 ? new THREE.ExtrudeGeometry(shape, { depth: el.height, bevelEnabled: false }) : new THREE.ShapeGeometry(shape);
  }, [poly, el.height]);
  const modelKind = cfg.types[el.type].model;
  const frame = useMemo(() => (modelKind && poly.length >= 3 ? rectFrame(poly) : null), [modelKind, poly]);
  const modelParts = useMemo(() => (modelKind && frame ? modelFor(modelKind, frame.long, frame.short) : []), [modelKind, frame]);
  useEffect(() => () => modelParts.forEach((m) => m.geometry.dispose()), [modelParts]);
  // A table's chairs are drawn one by one so people can pull them out; they come from the same layout as the seats.
  const pullFt = useApp((st) => st.engine.life.dining.pullFt);
  const chairGeo = useMemo(() => (modelKind === 'table' ? chairGeometry() : null), [modelKind]);
  useEffect(() => () => chairGeo?.dispose(), [chairGeo]);
  const seats = useMemo(() => (modelKind === 'table' && frame ? tableLayout(frame.long, frame.short).seats : []), [modelKind, frame]);
  const chairRefs = useRef<(THREE.Group | null)[]>([]);
  useFrame(() => {
    seats.forEach((seat, i) => {
      const g = chairRefs.current[i];
      if (!g) return;
      const pull = (chairPull.get(`${el.id}:${i}`) ?? 0) * pullFt;
      g.position.set(seat.x - seat.fx * pull, seat.y - seat.fy * pull, 0);
    });
  });
  if (poly.length < 3) return null;
  const selected = selectedId === el.id;
  const ghost = !!el.removed;
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (tool) return;
    e.stopPropagation();
    selectElement(el.id);
  };
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (tool || !edit) return;
    if (e.nativeEvent.altKey) {
      // Option-drag: leave this element where it is and drag a copy.
      e.stopPropagation();
      const copyId = duplicateElement(el.id, [0, 0]);
      if (!copyId) return;
      setHsDrag({ id: copyId, kind: 'move', last: [e.point.x, -e.point.z] });
      if (controls) controls.enabled = false;
      return;
    }
    if (!selected || el.existing) return;
    e.stopPropagation();
    beginGesture();
    setHsDrag({ id: el.id, kind: 'move', last: [e.point.x, -e.point.z] });
    if (controls) controls.enabled = false;
  };
  const base = el.color ?? mat?.color ?? '#aaa';
  return (
    <group>
      {frame ? (
        <group position={[frame.cx, frame.cy, 0]} rotation={[0, 0, frame.angle]}>
          {modelParts.map((m, i) => (
            <mesh key={i} geometry={m.geometry} castShadow receiveShadow onClick={onClick} onPointerDown={onDown}>
              <meshStandardMaterial color={ghost ? '#c0392b' : (m.color ?? base)} roughness={0.85} transparent={ghost} opacity={ghost ? 0.3 : 1} />
            </mesh>
          ))}
          {chairGeo && seats.map((seat, i) => (
            <group key={i} ref={(g) => { chairRefs.current[i] = g; }} position={[seat.x, seat.y, 0]} rotation={[0, 0, Math.atan2(seat.fy, seat.fx)]}>
              <mesh geometry={chairGeo} castShadow receiveShadow onClick={onClick} onPointerDown={onDown}>
                <meshStandardMaterial color={ghost ? '#c0392b' : '#6a5845'} roughness={0.85} transparent={ghost} opacity={ghost ? 0.3 : 1} />
              </mesh>
            </group>
          ))}
        </group>
      ) : (
        <mesh geometry={geo} position={[0, 0, el.height > 0 ? 0 : z]} castShadow={el.height > 0} receiveShadow onClick={onClick} onPointerDown={onDown}>
          <meshStandardMaterial color={ghost ? '#c0392b' : base} roughness={0.95} transparent={ghost} opacity={ghost ? 0.3 : 1} />
        </mesh>
      )}
      {selected && (
        <Line points={[...poly, poly[0]].map(([x, y]): [number, number, number] => [x, y, el.height + 0.12])} color="#2563eb" lineWidth={2.5} />
      )}
    </group>
  );
}

function Handles({ el }: { el: HardscapeElement }) {
  const edit = useApp((s) => s.mode === 'edit');
  const setHsDrag = useApp((s) => s.setHsDrag);
  const beginGesture = useApp((s) => s.beginGesture);
  const controls = useThree((st) => st.controls) as unknown as { enabled: boolean } | null;
  if (!edit || el.existing) return null;
  return (
    <group>
      {el.points.map(([x, y], i) => (
        <mesh
          key={i}
          position={[x, y, el.height + 0.3]}
          renderOrder={6}
          onPointerDown={(e) => {
            e.stopPropagation();
            beginGesture();
            setHsDrag({ id: el.id, kind: 'vertex', index: i });
            if (controls) controls.enabled = false;
          }}
        >
          <sphereGeometry args={[0.55, 14, 10]} />
          <meshBasicMaterial color="#2563eb" depthTest={false} />
        </mesh>
      ))}
    </group>
  );
}

const dimLabel = (text: string, pos: [number, number, number], key: string) => (
  <Html key={key} position={pos} center style={{ pointerEvents: 'none' }}>
    <span className="dim-label live">{text}</span>
  </Html>
);

/** Segment lengths along a polyline or polygon outline. */
function segmentLabels(points: Pt[], closed: boolean, z: number, prefix: string) {
  const out = [];
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.05) continue;
    out.push(dimLabel(formatFeetInches(len, 4), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z], `${prefix}${i}`));
  }
  return out;
}

function DrawingPreview() {
  const drawing = useApp((s) => s.drawing);
  const hover = useApp((s) => s.hover);
  const cfg = useApp((s) => s.engine.hardscape);
  const snapKind = useApp((s) => s.hoverSnap);
  if (!drawing) return null;
  const isLine = cfg.types[drawing.type].shape === 'line';
  const preset = cfg.types[drawing.type].placeSize;
  // Furniture and fixtures show the outline they would take where the pointer is.
  const ghost: Pt[] | null = preset && hover ? [[hover[0] - preset[0] / 2, hover[1] - preset[1] / 2], [hover[0] + preset[0] / 2, hover[1] - preset[1] / 2], [hover[0] + preset[0] / 2, hover[1] + preset[1] / 2], [hover[0] - preset[0] / 2, hover[1] + preset[1] / 2]] : null;
  if (preset) {
    return ghost ? <Line points={[...ghost, ghost[0]].map(([x, y]): [number, number, number] => [x, y, 0.25])} color="#16a34a" lineWidth={2.5} /> : null;
  }
  const pts: Pt[] = hover ? [...drawing.points, hover] : drawing.points;
  const closed = !isLine && pts.length >= 3;
  const path = (closed ? [...pts, pts[0]] : pts).map(([x, y]): [number, number, number] => [x, y, 0.25]);
  const area = closed ? polygonArea(pts) : 0;
  return (
    <group>
      {path.length >= 2 && <Line points={path} color="#16a34a" lineWidth={2.5} dashed={false} />}
      {drawing.points.map(([x, y], i) => (
        <mesh key={i} position={[x, y, 0.3]} renderOrder={6}>
          <sphereGeometry args={[0.45, 12, 8]} />
          <meshBasicMaterial color="#16a34a" depthTest={false} />
        </mesh>
      ))}
      {hover && (
        <mesh position={[hover[0], hover[1], 0.3]} renderOrder={7}>
          <sphereGeometry args={[0.35, 12, 8]} />
          <meshBasicMaterial color={SNAP_COLOR[snapKind]} depthTest={false} />
        </mesh>
      )}
      {segmentLabels(pts, closed, 0.6, 'd')}
      {closed && hover && dimLabel(`${area.toFixed(1)} sq ft`, [hover[0], hover[1] + 2.5, 0.6], 'area')}
    </group>
  );
}

/** All hardscape elements, the selection outline and handles, and the live drawing preview. */
export function HardscapeLayer() {
  const hardscape = useApp((s) => s.hardscape);
  const materials = useApp((s) => s.materials);
  const cfg = useApp((s) => s.engine.hardscape);
  const selectedId = useApp((s) => s.selectedElementId);
  const setHsDrag = useApp((s) => s.setHsDrag);
  const controls = useThree((st) => st.controls) as unknown as { enabled: boolean } | null;
  const byId = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const selected = hardscape.find((e) => e.id === selectedId);

  // End a drag wherever the pointer is released, and give the camera back.
  useEffect(() => {
    const up = () => {
      setHsDrag(null);
      if (controls) controls.enabled = true;
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [controls, setHsDrag]);

  return (
    <group>
      {hardscape.map((el) => (
        <ElementMesh key={el.id} el={el} mat={byId.get(el.materialId)} z={0.03 + Math.max(0, cfg.drawOrder.indexOf(el.type)) * 0.006} />
      ))}
      {selected && !selected.removed && (
        <>
          <Handles el={selected} />
          {segmentLabels(selected.points, cfg.types[selected.type].shape !== 'line', selected.height + 0.7, 's')}
        </>
      )}
      <DrawingPreview />
    </group>
  );
}
