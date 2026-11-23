import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { buildFlowers, buildFoliage, quantizeSize, type FlowerSpec, type LeafSpec } from '../engine/foliage';
import { isBlooming, isLeafOff, type PlacedPlant } from '../engine/growth';
import { seedFromId } from '../engine/fruit';
import { trunkTopRadius } from '../engine/trunk';
import { barkTexture } from './bark';
import { trunkGeometry } from './trunkGeometry';
import { useApp } from '../store/store';
import { branchGeometry } from './branchGeometry';
import { aimMatrix, bladesGeometry, leafGeometry, petalGeometry, plumeGeometry, tubeGeometry } from './foliageGeometry';
import { MIN_FORM_SIZE } from './forms';

/** Instanced leaves, colored by shade and by whether they show their underside. */
function Leaves({ leaves, shape, fold, droop, color, under }: { leaves: LeafSpec[]; shape: Parameters<typeof leafGeometry>[0]; fold?: number; droop?: number; color: string; under?: string }) {
  const geometry = useMemo(() => leafGeometry(shape, fold ?? 0.3, (droop ?? 0.25) * 0.7), [shape, fold, droop]);
  const mesh = useRef<THREE.InstancedMesh>(null);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const top = new THREE.Color(color);
    const back = new THREE.Color(under ?? color);
    const c = new THREE.Color();
    const mat = new THREE.Matrix4();
    leaves.forEach((l, i) => {
      m.setMatrixAt(i, aimMatrix(l.p, l.dir, l.roll, [l.length, l.width, l.width], 'x', mat));
      c.copy(l.under ? back : top).offsetHSL(0, 0, (l.shade - 0.5) * 0.1);
      m.setColorAt(i, c);
    });
    m.count = leaves.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [leaves, color, under]);
  if (!leaves.length) return null;
  return (
    <instancedMesh raycast={() => null} ref={mesh} args={[geometry, undefined, leaves.length]} key={leaves.length} frustumCulled={false} receiveShadow>
      <meshStandardMaterial side={THREE.DoubleSide} roughness={0.75} />
    </instancedMesh>
  );
}

/** Flowers of one form, instanced; `color` is the petals or tubes, `center` the heart of a blossom. */
function Flowers({ list, form, color, center }: { list: FlowerSpec[]; form: FlowerSpec['form']; color: string; center: string }) {
  const geometry = useMemo(() => (form === 'petal' ? petalGeometry(new THREE.Color(color), new THREE.Color(center)) : form === 'tube' ? tubeGeometry() : plumeGeometry()), [form, color, center]);
  const mesh = useRef<THREE.InstancedMesh>(null);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const c = new THREE.Color();
    const mat = new THREE.Matrix4();
    const base = new THREE.Color(form === 'petal' ? '#ffffff' : color);
    list.forEach((f, i) => {
      const s = f.size;
      m.setMatrixAt(i, aimMatrix(f.p, f.dir, f.shade * Math.PI * 2, form === 'petal' ? [s, s, s] : form === 'plume' ? [s, s, s] : [s, s, s], form === 'petal' ? 'z' : 'x', mat));
      c.copy(base).offsetHSL(0, 0, (f.shade - 0.5) * 0.12);
      m.setColorAt(i, c);
    });
    m.count = list.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [list, color, form]);
  if (!list.length) return null;
  return (
    <instancedMesh raycast={() => null} ref={mesh} args={[geometry, undefined, list.length]} key={list.length} frustumCulled={false}>
      <meshStandardMaterial side={THREE.DoubleSide} roughness={0.6} vertexColors={form === 'petal'} />
    </instancedMesh>
  );
}

/**
 * A plant up close: its own branches or stems, leaves, and flowers while it blooms, from the species' `look` data.
 * Built at a size rounded onto a ladder and stretched to the exact size, so a growing plant is rebuilt only now and then.
 * It casts no shadow itself: the simple crown shape (drawn invisibly by the caller) does that, so the sun map agrees.
 */
export function DetailedPlant({ p, month }: { p: PlacedPlant; month: number }) {
  const s = p.species;
  const look = s.look!;
  const engine = useApp((x) => x.engine);
  const showBloom = useApp((x) => x.layers.bloom);
  const trunkFrac = engine.growth.trunkClearanceFraction[s.type] ?? 0;
  const step = engine.foliage.quantizeStep;
  const h = Math.max(p.size.height, MIN_FORM_SIZE);
  const w = Math.max(p.size.width, MIN_FORM_SIZE);
  const qh = quantizeSize(h, step), qw = quantizeSize(w, step);
  const leafOff = isLeafOff(s, month);
  const blooming = showBloom && isBlooming(s, month) && !leafOff;
  const seed = seedFromId(p.inst.id);
  const ctx = useMemo(() => {
    const base = qh * trunkFrac;
    return { habit: s.habit, r: qw / 2, base, canopyH: qh - base, matureR: s.matureWidth / 2, matureH: s.matureHeight, seed, profile: s.crown?.profile, branches: engine.branches, cfg: engine.foliage, trunkR: trunkTopRadius(qh, engine.trunk) };
  }, [s.habit, s.crown, s.matureWidth, s.matureHeight, qw, qh, trunkFrac, seed, engine.branches, engine.foliage, engine.trunk]);
  const fol = useMemo(() => buildFoliage(look, ctx), [look, ctx]);
  const flowers = useMemo(() => (blooming ? buildFlowers(look, fol, ctx) : { flowers: [], stalks: [] }), [blooming, look, fol, ctx]);
  const trunkH = qh * trunkFrac;
  const trunkGeo = useMemo(() => (look.kind === 'tree' && trunkH > 0.02 ? trunkGeometry(trunkH, qh, seed, engine.trunk) : null), [look.kind, trunkH, qh, seed, engine.trunk]);
  const bark = useMemo(() => (look.kind === 'tree' ? barkTexture() : null), [look.kind]);
  const woodGeo = useMemo(() => (fol.skeleton ? branchGeometry(fol.skeleton) : null), [fol]);
  const stalkGeo = useMemo(() => (flowers.stalks.length ? branchGeometry({ segments: flowers.stalks, tips: [] }) : null), [flowers.stalks]);
  const base = useMemo(() => new THREE.Color(s.foliageColor), [s.foliageColor]);
  const bladeGeo = useMemo(() => bladesGeometry(fol.blades, base.clone().multiplyScalar(0.62), base.clone().lerp(new THREE.Color(look.kind === 'blades' ? '#d9c98f' : '#ffffff'), look.kind === 'blades' ? 0.45 : 0.12)), [fol.blades, base, look.kind]);
  useEffect(() => () => { woodGeo?.dispose(); }, [woodGeo]);
  useEffect(() => () => { trunkGeo?.dispose(); }, [trunkGeo]);
  useEffect(() => () => { stalkGeo?.dispose(); }, [stalkGeo]);
  useEffect(() => () => { bladeGeo?.dispose(); }, [bladeGeo]);
  // A deciduous tree in blossom is only half in leaf: the new leaves are still small and few.
  const budding = blooming && look.flower?.form === 'blossom' && !s.evergreen;
  const shownLeaves = useMemo(() => (budding ? fol.leaves.filter((_, i) => i % 5 < 2).map((l) => ({ ...l, length: l.length * 0.7, width: l.width * 0.7 })) : fol.leaves), [budding, fol.leaves]);
  const form = look.flower?.form;
  const petalColor = look.flower?.color ?? s.bloomColor;
  const stalkColor = useMemo(() => new THREE.Color(s.foliageColor).lerp(new THREE.Color(form === 'plume' ? '#d8c9a0' : '#ffffff'), 0.35), [s.foliageColor, form]);
  const flowerForm = flowers.flowers[0]?.form;
  return (
    <group scale={[w / qw, w / qw, h / qh]} raycast={() => null}>
      {trunkGeo && (
        <mesh raycast={() => null} geometry={trunkGeo} castShadow>
          <meshStandardMaterial color={look.trunkColor ?? '#5e4632'} map={bark} bumpMap={bark} bumpScale={1.2} roughness={1} />
        </mesh>
      )}
      {woodGeo && (
        <mesh raycast={() => null} geometry={woodGeo}>
          <meshStandardMaterial color={look.trunkColor ?? (look.kind === 'tree' ? '#5e4632' : s.foliageColor)} map={bark} bumpMap={bark} bumpScale={0.8} roughness={1} />
        </mesh>
      )}
      {!leafOff && fol.leaves.length > 0 && (
        <Leaves leaves={shownLeaves} shape={look.leaf.shape} fold={look.leaf.fold} droop={look.leaf.droop} color={s.foliageColor} under={look.leaf.underColor} />
      )}
      {bladeGeo && (
        <mesh raycast={() => null} geometry={bladeGeo}>
          <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.8} />
        </mesh>
      )}
      {stalkGeo && (
        <mesh raycast={() => null} geometry={stalkGeo}>
          <meshStandardMaterial color={stalkColor} roughness={0.9} />
        </mesh>
      )}
      {flowerForm && <Flowers list={flowers.flowers} form={flowerForm} color={petalColor} center={look.flower?.centerColor ?? '#f2d55c'} />}
    </group>
  );
}
