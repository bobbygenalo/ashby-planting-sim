import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CROPS } from '../data/cropLibrary';
import { buildCropPlant } from '../engine/cropPlants';
import { activeCrop, cropPositions, planOf } from '../engine/crops';
import { mulberry32 } from '../engine/shuffle';
import { doyToMonthDay } from '../engine/time';
import type { HardscapeElement } from '../engine/types';
import { footprint } from '../engine/hardscape';
import { useApp } from '../store/store';
import { cropMeshes } from './cropGeometry';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const VARIANTS = 3;

/** Instances of one built crop plant (or its produce) at the given places, sizes and turns. */
function Instances({ geometry, matrices, material, shadow }: { geometry: THREE.BufferGeometry; matrices: THREE.Matrix4[]; material: THREE.Material; shadow?: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    matrices.forEach((mat, i) => m.setMatrixAt(i, mat));
    m.count = matrices.length;
    m.instanceMatrix.needsUpdate = true;
  }, [matrices]);
  if (!matrices.length) return null;
  return <instancedMesh ref={mesh} args={[geometry, material, matrices.length]} key={matrices.length} frustumCulled={false} castShadow={shadow} raycast={() => null} />;
}

/** Vegetables and fruit growing in one raised bed, for the month: seedlings, full plants with produce, fading, then pulled. */
function BedCrops({ bed, index, month }: { bed: HardscapeElement; index: number; month: number }) {
  const cfg = useApp((s) => s.engine.crops);
  const branches = useApp((s) => s.engine.branches);
  const foliageCfg = useApp((s) => s.engine.foliage);
  const hs = useApp((s) => s.engine.hardscape);
  const poly = useMemo(() => footprint(bed, hs), [bed, hs]);
  const active = useMemo(() => activeCrop(planOf(bed, CROPS, index), CROPS, month, cfg), [bed, index, month, cfg]);
  const spots = useMemo(() => (active ? cropPositions(poly, active.crop.spacingFt, cfg) : []), [active, poly, cfg]);
  const top = bed.height;
  const cropId = active?.crop.id;

  // A few different plants of the crop, built once and drawn at every spot, so a bed is not a row of clones.
  const variants = useMemo(() => {
    if (!active) return [];
    return Array.from({ length: VARIANTS }, (_, v) => cropMeshes(active.crop, buildCropPlant(active.crop, hash(bed.id) + v * 7919 + 13, branches, foliageCfg, cfg)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropId, bed.id, branches, foliageCfg, cfg]);
  useEffect(() => () => variants.forEach((v) => { v.foliage?.dispose(); v.produce?.dispose(); }), [variants]);

  // Where each variant stands, how big it is this month, and which way it is turned.
  const matrices = useMemo(() => {
    const out: THREE.Matrix4[][] = Array.from({ length: VARIANTS }, () => []);
    if (!active) return out;
    const q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    spots.forEach(([x, y], n) => {
      const rng = mulberry32(hash(bed.id) + n * 31);
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), rng() * Math.PI * 2);
      const k = Math.max(active.stage.size, 0.05) * (0.92 + rng() * 0.16);
      pos.set(x, y, top);
      scl.set(k, k, k);
      out[n % VARIANTS].push(new THREE.Matrix4().compose(pos.clone(), q.clone(), scl.clone()));
    });
    return out;
  }, [active, spots, bed.id, top]);

  const leafMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });
    if (active) m.color.set('#ffffff').lerp(new THREE.Color(cfg.spentColor), active.stage.fade * cfg.spentBlend);
    return m;
  }, [active, cfg]);
  const fruitMat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), []);
  useEffect(() => () => leafMat.dispose(), [leafMat]);
  useEffect(() => () => fruitMat.dispose(), [fruitMat]);

  if (!active || spots.length === 0) return null;
  return (
    <group>
      {variants.map((v, i) => v.foliage && <Instances key={`f${i}`} geometry={v.foliage} matrices={matrices[i]} material={leafMat} shadow />)}
      {active.stage.produce && variants.map((v, i) => v.produce && <Instances key={`p${i}`} geometry={v.produce} matrices={matrices[i]} material={fruitMat} />)}
    </group>
  );
}

/** What is growing in the raised beds this month, from each bed's crop plan. */
export function CropLayer() {
  const hardscape = useApp((s) => s.hardscape);
  const show = useApp((s) => s.layers.crops);
  const doy = useApp((s) => s.doy);
  const month = doyToMonthDay(doy)[0];
  if (!show) return null;
  const beds = hardscape.filter((e) => e.type === 'raisedBed' && !e.removed);
  return (
    <group>
      {beds.map((b, i) => <BedCrops key={b.id} bed={b} index={i} month={month} />)}
    </group>
  );
}
