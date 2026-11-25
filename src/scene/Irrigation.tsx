import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { DeviceKind, IrrigationPlan } from '../engine/irrigation';
import { useIrrigationPlan } from '../store/derived';
import { useApp } from '../store/store';
import { IrrigationFlow, useRunningValves } from './IrrigationFlow';
import { useOverlayBase } from './overlay';

type Seg = {
  a: [number, number]; b: [number, number]; w: number;
  /** What it belongs to (a valve id, or `supply:` and an access id), so its waves run only while that runs. */
  vid: string;
  dz?: number;
  /** Height of the surface it lies on, when that is not the ground (soil in a raised bed). */
  zAbs?: number;
  /** Feet of line from the manifold at its `a` end: where along the flow it starts, so a wave can be drawn travelling out. */
  s0?: number;
};

/**
 * Flat ribbons for every line segment, one merged mesh. Each segment is cut into short pieces so a wave of color can be
 * drawn along even a long straight run; every vertex keeps its distance along the flow (`flow`), and its owner's vertices
 * are one range (`ranges`) so only the running valves are recolored each frame.
 */
function ribbons(segs: Seg[], z: number, pieceFt: number, rest: THREE.Color): { geo: THREE.BufferGeometry; ranges: Map<string, [number, number]>; flow: Float32Array } {
  const pieces = segs.map((s) => Math.max(1, Math.ceil(Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) / pieceFt)));
  const total = pieces.reduce((x, y) => x + y, 0);
  const pos = new Float32Array(total * 12);
  const col = new Float32Array(total * 12);
  const flow = new Float32Array(total * 4);
  const idx = new Uint32Array(total * 6);
  const ranges = new Map<string, [number, number]>();
  let q = 0;
  segs.forEach((s, si) => {
    const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1];
    const len = Math.hypot(dx, dy);
    const l = len || 1;
    const nx = (-dy / l) * (s.w / 2), ny = (dx / l) * (s.w / 2);
    const zz = (s.zAbs ?? z) + (s.dz ?? 0);
    const n = pieces[si];
    const first = q;
    for (let k = 0; k < n; k++, q++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const ax = s.a[0] + dx * t0, ay = s.a[1] + dy * t0, bx = s.a[0] + dx * t1, by = s.a[1] + dy * t1;
      const v = [ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny];
      for (let c = 0; c < 4; c++) {
        pos.set([v[c * 2], v[c * 2 + 1], zz], q * 12 + c * 3);
        col.set([rest.r, rest.g, rest.b], q * 12 + c * 3);
      }
      const sa = (s.s0 ?? 0) + len * t0, sb = (s.s0 ?? 0) + len * t1;
      flow.set([sa, sb, sb, sa], q * 4);
      idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
    }
    const r = ranges.get(s.vid);
    if (r) r[1] = q * 4; else ranges.set(s.vid, [first * 4, q * 4]);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return { geo: g, ranges, flow };
}

function Devices({ plan, kind, z }: { plan: IrrigationPlan; kind: DeviceKind; z: number }) {
  const draw = useApp((s) => s.engine.irrigation.draw);
  const ref = useRef<THREE.InstancedMesh>(null);
  const list = useMemo(() => plan.valves.flatMap((v) => v.devices.filter((d) => d.kind === kind).map((d) => ({ d, color: draw.deviceColor }))), [plan, kind, draw.deviceColor]);
  const size = { emitter: draw.emitterFt, bubbler: draw.bubblerFt, spray: draw.sprayFt, rotor: draw.rotorFt, inline: 0 }[kind];
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    list.forEach(({ d, color }, i) => {
      o.position.set(d.at[0], d.at[1], (d.z !== undefined ? d.z + draw.liftFt : z) + size / 2);
      o.rotation.set(Math.PI / 2, 0, 0); // cylinders and cones stand up in site coordinates (z up)
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, c.set(color));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [list, size, z]);
  if (list.length === 0 || kind === 'inline') return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, list.length]} key={`${kind}-${list.length}`} renderOrder={6} frustumCulled={false}>
      {kind === 'emitter' ? <sphereGeometry args={[size / 2, 10, 8]} /> : kind === 'bubbler' ? <cylinderGeometry args={[size * 0.4, size * 0.4, size, 12]} /> : kind === 'spray' ? <coneGeometry args={[size * 0.45, size, 12]} /> : <cylinderGeometry args={[size * 0.35, size * 0.5, size, 12]} />}
      <meshBasicMaterial />
    </instancedMesh>
  );
}

/**
 * The suggested irrigation layout, drawn over the yard: a line from the hose bib to a valve manifold, one colored
 * set of lines per valve (wider where more water flows), micro tubing to each emitter, bubbler and head, a ring
 * round each hand-watered plant, and a tag per valve. Plants in raised beds are not part of it.
 */
export function IrrigationLayer() {
  const plan = useIrrigationPlan();
  const draw = useApp((s) => s.engine.irrigation.draw);
  const base = useOverlayBase();
  const z = base + draw.liftFt;
  const running = useRunningValves();
  const allLabels = useApp((s) => s.layers.irrigationLabels);
  /** Which owners' lines were last painted as running (true) or at rest (false), so a line at rest is not repainted every frame. */
  const lit = useRef(new Map<string, boolean>());
  const built = useMemo(() => {
    if (!plan) return null;
    const segs: Seg[] = [];
    // Where two valves' lines share a trench their ribbons overlap; each valve sits one step above the one before it
    // (and the supply line above all), so the same ribbon always wins instead of flickering as the camera moves.
    const step = draw.layerStepFt;
    const stackOf = (vi: number) => (vi + 1) * step;
    for (const [vi, v] of plan.valves.entries()) {
      const vid = v.id;
      const dz = stackOf(vi);
      for (const r of v.runs) {
        let at = r.fromFt;
        for (let i = 1; i < r.points.length; i++) {
          segs.push({ a: r.points[i - 1], b: r.points[i], w: draw.ribbonFt[String(r.sizeInches)] ?? draw.tailFt * 3, vid, dz, s0: at });
          at += Math.hypot(r.points[i][0] - r.points[i - 1][0], r.points[i][1] - r.points[i - 1][1]);
        }
      }
      for (const t of v.tails) segs.push({ a: t.from, b: t.to, w: draw.tailFt, vid, dz, zAbs: t.z !== undefined ? t.z + draw.liftFt : undefined, s0: t.s });
      for (const d of v.devices) {
        if (d.kind !== 'inline' || !d.ringFt) continue;
        const n = 24;
        for (let i = 0; i < n; i++) {
          const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
          segs.push({ a: [d.at[0] + Math.cos(a0) * d.ringFt, d.at[1] + Math.sin(a0) * d.ringFt], b: [d.at[0] + Math.cos(a1) * d.ringFt, d.at[1] + Math.sin(a1) * d.ringFt], w: draw.tailFt, vid, dz });
        }
      }
    }
    // the supply line ends at the manifold, so its flow distance runs from minus its length up to zero
    for (const sp of plan.supplies) segs.push({ a: sp.from, b: sp.to, w: draw.ribbonFt[String(sp.sizeInches)] ?? 0.3, vid: `supply:${sp.sourceId}`, dz: stackOf(plan.valves.length), s0: -Math.hypot(sp.to[0] - sp.from[0], sp.to[1] - sp.from[1]) });
    lit.current.clear();
    return ribbons(segs, z, draw.wavePieceFt, new THREE.Color(draw.lineColor));
  }, [plan, draw, z]);
  const geo = built?.geo ?? null;
  useLayoutEffect(() => () => geo?.dispose(), [geo]);
  // while a valve runs, bands of darker blue are pushed out from the manifold along its lines (and the supply line feeding it)
  const light = useMemo(() => new THREE.Color(draw.lineColor), [draw.lineColor]);
  const dark = useMemo(() => new THREE.Color(draw.lineFlowColor), [draw.lineFlowColor]);
  useFrame((state) => {
    if (!built || !plan) return;
    const attr = built.geo.getAttribute('color') as THREE.BufferAttribute;
    const t = state.clock.elapsedTime;
    const c = new THREE.Color();
    let changed = false;
    for (const [vid, [from, to]] of built.ranges) {
      const on = vid.startsWith('supply:') ? plan.valves.some((v) => v.sourceId === vid.slice(7) && running.has(v.id)) : running.has(vid);
      if (!on) {
        if (lit.current.get(vid) === false) continue; // already at rest
        for (let i = from; i < to; i++) attr.setXYZ(i, light.r, light.g, light.b);
        lit.current.set(vid, false);
        changed = true;
        continue;
      }
      for (let i = from; i < to; i++) {
        const phase = (built.flow[i] - draw.waveSpeedFtS * t) / draw.waveLengthFt;
        const w = Math.pow(0.5 + 0.5 * Math.sin(phase * Math.PI * 2), 1.4);
        c.copy(light).lerp(dark, w);
        attr.setXYZ(i, c.r, c.g, c.b);
      }
      lit.current.set(vid, true);
      changed = true;
    }
    if (changed) attr.needsUpdate = true;
  });
  if (!plan || !geo) return null;
  return (
    <group>
      <mesh geometry={geo} renderOrder={5} frustumCulled={false}>
        <meshBasicMaterial vertexColors side={THREE.DoubleSide} />
      </mesh>
      {(['emitter', 'bubbler', 'spray', 'rotor'] as DeviceKind[]).map((k) => <Devices key={k} plan={plan} kind={k} z={z} />)}
      <IrrigationFlow plan={plan} z={z} />
      {plan.sources.filter((sp) => sp.valveIds.length > 0).map((sp) => (
        <mesh key={sp.id} position={[sp.manifold[0], sp.manifold[1], z + draw.manifoldFt / 4]} renderOrder={6}>
          <boxGeometry args={[draw.manifoldFt, draw.manifoldFt * 0.6, draw.manifoldFt / 2]} />
          <meshBasicMaterial color="#333333" />
        </mesh>
      ))}
      {plan.hand.filter((r) => r.radiusFt > 0).map((r) => (
        <mesh key={r.id} position={[r.at[0], r.at[1], z + 0.01]} renderOrder={5}>
          <ringGeometry args={[Math.max(r.radiusFt - draw.handRingFt, 0.05), Math.max(r.radiusFt, 0.2), 40]} />
          <meshBasicMaterial color={draw.handColor} transparent opacity={0.8} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
      {plan.valves.filter((v) => allLabels || running.has(v.id)).map((v) => (
        <Html key={v.id} position={[v.labelAt[0], v.labelAt[1], z + 0.3]} center zIndexRange={[18, 0]}>
          <span className={`valvetag ${running.has(v.id) ? 'running' : ''}`} title={`${v.name}: ${Math.round(v.gph)} gal/hr${running.has(v.id) ? ' (running now)' : ''}`}>{running.has(v.id) ? '\u{1F4A7} ' : ''}{v.id}</span>
        </Html>
      ))}
    </group>
  );
}
