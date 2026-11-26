import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { fenceLayout, type FenceDesign } from '../engine/fencedesign';
import { useApp } from '../store/store';
import { grab, groundUnder, takeHold } from './grab';

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
  // Picking and dragging a block in the yard: press on it to select it, then drag it along the fence (the ground handler in SiteScene follows the pointer).
  const edit = useApp((st) => st.mode === 'edit');
  const tool = useApp((st) => !!(st.drawing || st.placingSpeciesId || st.measureActive));
  const pickedId = useApp((st) => st.fenceBlockId);
  const selectBlock = useApp((st) => st.selectFenceBlock);
  const setDragging = useApp((st) => st.setFenceDragging);
  const controls = useThree((st) => st.controls) as unknown as { enabled: boolean } | null;
  const gl = useThree((st) => st.gl);
  const dragging = useApp((st) => st.fenceDragging);
  const dragBlock = useApp((st) => st.dragFenceBlock);
  const camera = useThree((st) => st.camera);
  useEffect(() => {
    const up = () => {
      setDragging(false);
      if (controls) controls.enabled = true;
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [controls, setDragging]);
  // While a block is dragged, follow the pointer anywhere over the yard: the ground under it (shifted by where the block was grabbed)
  // gives the block's center along the fence. Listening on the window, not the ground mesh, keeps the drag going over buildings and fences.
  useEffect(() => {
    if (!dragging || !pickedId) return;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const move = (e: PointerEvent) => {
      const r = gl.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const g = groundUnder(ray.ray);
      if (!g) return;
      const x = g[0] + grab.dx, y = g[1] + grab.dy;
      dragBlock(pickedId, (x - a[0]) * ((b[0] - a[0]) / len) + (y - a[1]) * ((b[1] - a[1]) / len));
    };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, [dragging, pickedId, gl, camera, dragBlock, a, b, len]);
  const dirX = (b[0] - a[0]) / len, dirY = (b[1] - a[1]) / len;
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

  // the wooden top piece: a board laid flat along the top of each wire panel that has one, sitting on the wire between its posts
  const tops = useMemo(() => layout.panels.filter((q) => q.topPiece).map((q) => {
    const t = cfg.wireTop.thicknessIn * IN;
    return { p: [(q.from + q.to) / 2, yWire, q.bottomFt + q.heightFt + t / 2] as [number, number, number], s: [q.to - q.from, cfg.wireTop.widthIn * IN, t] as [number, number, number] };
  }), [layout, cfg.wireTop, yWire]);

  return (
    <group position={[a[0], a[1], 0]} rotation={[0, 0, ang]}>
      {layout.segments.filter((sg) => sg.blockId).map((sg) => {
        const top = sg.kind === 'boards' ? sg.heightFt : sg.bottomFt + sg.heightFt + (sg.topPiece ? cfg.wireTop.thicknessIn / 12 : 0);
        const bottom = sg.kind === 'boards' ? 0 : sg.bottomFt;
        const mid = (sg.from + sg.to) / 2;
        const on = sg.blockId === pickedId;
        return (
          <group key={sg.blockId} position={[mid, 0, (top + bottom) / 2]}>
            {/* an invisible box over the block to pick it and drag it by */}
            <mesh
              onPointerOver={() => { if (edit && !tool) gl.domElement.style.cursor = 'grab'; }}
              onPointerOut={() => { gl.domElement.style.cursor = ''; }}
              onClick={(e) => { if (tool || e.delta > 3) return; e.stopPropagation(); selectBlock(sg.blockId!); }}
              onPointerDown={(e) => {
                if (tool) return;
                e.stopPropagation();
                selectBlock(sg.blockId!);
                if (!edit) return;
                takeHold(e.ray, [a[0] + dirX * mid, a[1] + dirY * mid]);
                setDragging(true);
                if (controls) controls.enabled = false;
              }}
            >
              <boxGeometry args={[sg.to - sg.from, 0.7, top - bottom]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            {on && (
              <mesh raycast={() => null} renderOrder={6}>
                <boxGeometry args={[sg.to - sg.from + 0.12, 0.5, top - bottom + 0.12]} />
                <meshBasicMaterial color="#2563eb" transparent opacity={0.28} depthWrite={false} />
              </mesh>
            )}
          </group>
        );
      })}
      {boardGroups.map(([color, items]) => <Boxes key={`b${color}`} items={items} color={color} jitter={0.07} />)}
      <Boxes items={rails} color={cfg.colors.rail} />
      <Boxes items={posts} color={cfg.colors.post} />
      <Boxes items={tops} color={cfg.wireTop.color} />
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
