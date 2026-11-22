import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CROPS } from '../data/cropLibrary';
import { activeCrop, cropPositions, planOf, produceOffsets } from '../engine/crops';
import { doyToMonthDay } from '../engine/time';
import type { HardscapeElement } from '../engine/types';
import { footprint } from '../engine/hardscape';
import { useApp } from '../store/store';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Vegetables and fruit growing in one raised bed, for the month: seedlings, full plants with produce, fading, then pulled. */
function BedCrops({ bed, index, month }: { bed: HardscapeElement; index: number; month: number }) {
  const cfg = useApp((s) => s.engine.crops);
  const hs = useApp((s) => s.engine.hardscape);
  const poly = useMemo(() => footprint(bed, hs), [bed, hs]);
  const active = useMemo(() => activeCrop(planOf(bed, CROPS, index), CROPS, month, cfg), [bed, index, month, cfg]);
  const spots = useMemo(() => (active ? cropPositions(poly, active.crop.spacingFt, cfg) : []), [active, poly, cfg]);
  const leaf = useRef<THREE.InstancedMesh>(null);
  const fruit = useRef<THREE.InstancedMesh>(null);
  const top = bed.height;

  const produce = useMemo(() => {
    if (!active || !active.stage.produce || !active.crop.produce) return [];
    const pr = active.crop.produce;
    const out: [number, number, number][] = [];
    spots.forEach(([x, y], n) => {
      for (const [dx, dy, dz] of produceOffsets(pr.count, active.crop.widthFt * active.stage.size, hash(bed.id) + n)) {
        out.push([x + dx, y + dy, top + active.crop.heightFt * active.stage.size * dz]);
      }
    });
    return out;
  }, [active, spots, bed.id, top]);

  useLayoutEffect(() => {
    if (!active) return;
    const dummy = new THREE.Object3D();
    const { crop, stage } = active;
    const m = leaf.current;
    if (m) {
      const w = Math.max(crop.widthFt * stage.size, 0.12) / 2, h = Math.max(crop.heightFt * stage.size, 0.1) / 2;
      spots.forEach(([x, y], i) => {
        dummy.position.set(x, y, top + h);
        dummy.scale.set(w, w, h);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
      });
      m.count = spots.length;
      m.instanceMatrix.needsUpdate = true;
    }
    const f = fruit.current;
    if (f && crop.produce) {
      const d = Math.max(crop.produce.sizeFt * cfg.produceDisplayScale, cfg.produceMinFt) / 2;
      produce.forEach(([x, y, z], i) => {
        dummy.position.set(x, y, z);
        dummy.scale.set(d, d, d);
        dummy.updateMatrix();
        f.setMatrixAt(i, dummy.matrix);
      });
      f.count = produce.length;
      f.instanceMatrix.needsUpdate = true;
    }
  }, [active, spots, produce, top, cfg]);

  const color = useMemo(() => {
    if (!active) return new THREE.Color();
    const c = new THREE.Color(active.crop.leafColor);
    return c.lerp(new THREE.Color(cfg.spentColor), active.stage.fade * cfg.spentBlend);
  }, [active, cfg]);

  if (!active || spots.length === 0) return null;
  return (
    <group>
      <instancedMesh ref={leaf} args={[undefined, undefined, spots.length]} key={`l-${bed.id}-${active.crop.id}-${spots.length}`} frustumCulled={false} castShadow>
        <sphereGeometry args={[1, 10, 8]} />
        <meshStandardMaterial color={color} roughness={1} />
      </instancedMesh>
      {produce.length > 0 && active.crop.produce && (
        <instancedMesh ref={fruit} args={[undefined, undefined, produce.length]} key={`p-${bed.id}-${active.crop.id}-${produce.length}`} frustumCulled={false}>
          <sphereGeometry args={[1, 8, 6]} />
          <meshStandardMaterial color={active.crop.produce.color} roughness={0.55} />
        </instancedMesh>
      )}
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
