import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { fenceLayout, type FenceDesign } from '../engine/fencedesign';
import { useApp } from '../store/store';

const IN = 1 / 12;

/** One instanced box per item: `items` give each box's center and size in the run's own frame. */
function Boxes({ items, color, cast = true, jitter = 0, metal = 0 }: { items: { p: [number, number, number]; s: [number, number, number] }[]; color: string; cast?: boolean; jitter?: number; metal?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    items.forEach((it, i) => {
      o.position.set(...it.p);
      o.scale.set(...it.s);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      // a slightly different tone for each piece of wood, steady for a given board
      const t = jitter ? ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 : 0.5;
      m.setColorAt(i, c.set(color).multiplyScalar(1 - jitter + t * jitter * 2));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [items, color, jitter]);
  if (!items.length) return null;
  return (
    <instancedMesh key={items.length} ref={ref} args={[undefined, undefined, items.length]} castShadow={cast} receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={metal ? 0.45 : 0.95} metalness={metal} />
    </instancedMesh>
  );
}

type Item = { p: [number, number, number]; s: [number, number, number] };

/**
 * The west fence as the owner designed it: a run of blocks between 4x4 posts, each a stretch of one material, boards of a
 * kind (cedar, redwood, weathered) or a wire panel (hog, cattle, welded), never both in one stretch, with the fill between.
 * The rails and posts are on the west side of the boards. All in the run's own frame (x along the fence, y to its left, which
 * is west here, z up).
 */
export function CustomFence({ a, b, design }: { a: [number, number]; b: [number, number]; design: FenceDesign }) {
  const cfg = useApp((st) => st.engine.fenceDesign);
  const capCfg = useApp((st) => st.engine.hardscape.fence);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const layout = useMemo(() => fenceLayout(design, len, cfg), [design, len, cfg]);
  const boardT = cfg.boardThicknessIn * IN;
  const railT = cfg.railIn[0] * IN, railW = cfg.railIn[1] * IN;
  const post = cfg.postIn * IN;
  // The rails and posts are on the west side of the boards (local +y is west for this fence), so the rails face west and the boards show to the yard.
  const yRail = boardT / 2 + railT / 2;
  const yPost = boardT / 2 + railT + post / 2;
  const wire = cfg.wireIn * IN * cfg.wireDisplayScale;
  // a wire panel is fixed to the yard face of its posts
  const yWire = boardT / 2 + railT - wire / 2;

  // boards grouped by material color, one instanced mesh each
  const boardGroups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const bd of layout.boards) {
      const list = m.get(bd.color) ?? [];
      list.push({ p: [bd.at, 0, bd.heightFt / 2], s: [bd.widthFt, boardT, bd.heightFt] });
      m.set(bd.color, list);
    }
    return [...m.entries()];
  }, [layout, boardT]);
  const posts = useMemo(() => layout.posts.map((x, i) => ({ p: [x, yPost, layout.postHeights[i] / 2] as [number, number, number], s: [post, post, layout.postHeights[i]] as [number, number, number] })), [layout, yPost, post]);
  const boardSegs = useMemo(() => layout.segments.filter((sg) => sg.kind === 'boards'), [layout]);
  const rails = useMemo(() => layout.rails.map((r) => ({ p: [(r.from + r.to) / 2, yRail, r.z] as [number, number, number], s: [r.to - r.from, railT, railW] as [number, number, number] })), [layout, yRail, railT, railW]);
  const wireGroups = useMemo(() => {
    const m = new Map<string, Item[]>();
    let n = 0;
    for (const p of layout.panels) {
      const list = m.get(p.color) ?? [];
      const w = p.to - p.from;
      for (let i = 0; i < p.verticals && n < cfg.maxWires; i++, n++) {
        const x = Math.min(p.to, p.from + (i * p.gridWidthIn) / 12);
        list.push({ p: [x, yWire, p.bottomFt + p.heightFt / 2], s: [wire, wire, p.heightFt] });
      }
      for (let j = 0; j < p.horizontals && n < cfg.maxWires; j++, n++) {
        const z = Math.min(p.bottomFt + p.heightFt, p.bottomFt + (j * p.gridHeightIn) / 12);
        list.push({ p: [p.from + w / 2, yWire, z], s: [w, wire, wire] });
      }
      m.set(p.color, list);
    }
    return [...m.entries()];
  }, [layout, cfg.maxWires, yWire, wire]);

  return (
    <group position={[a[0], a[1], 0]} rotation={[0, 0, ang]}>
      {boardGroups.map(([color, items]) => <Boxes key={`b${color}`} items={items} color={color} jitter={0.07} />)}
      <Boxes items={rails} color={cfg.colors.rail} />
      <Boxes items={posts} color={cfg.colors.post} />
      {wireGroups.map(([color, items]) => <Boxes key={`w${color}`} items={items} color={color} cast={false} metal={0.25} />)}
      {boardSegs.map((sg, i) => (
        <mesh key={i} position={[(sg.from + sg.to) / 2, 0, sg.heightFt + capCfg.capFt / 2]} castShadow>
          <boxGeometry args={[sg.to - sg.from, boardT + capCfg.capOverhangFt * 2, capCfg.capFt]} />
          <meshStandardMaterial color={cfg.colors.rail} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}
