import { useEffect, useMemo } from 'react';
import { fenceLayout, fenceRun, type FenceDesign } from '../engine/fencedesign';
import { fenceVineGrowth } from '../engine/fencevine';
import { quantizeSize } from '../engine/foliage';
import { isBlooming, type PlacedPlant } from '../engine/growth';
import { seedFromId } from '../engine/fruit';
import { useApp } from '../store/store';
import { branchGeometry } from './branchGeometry';
import { Flowers, Leaves } from './DetailedPlant';

/** Whether a plant is one this fence set out (so it is drawn climbing the fence panels, not as a free-standing shrub). */
export function isFenceVine(p: PlacedPlant, design: FenceDesign | null, prefix: string): boolean {
  return !!design && p.inst.id.startsWith(prefix) && !!p.species.look;
}

/**
 * A climbing plant on the west fence: stems lean from its base to the fence and fan up the hog wire, with leaves along them and
 * flowers while it blooms. Young, it stays on the wire; once grown it creeps onto the boards beside the panel (`engine/fencevine.ts`).
 * Drawn in the plant's own frame. It casts no shadow of its own: the plant's invisible crown does that, as for other detailed plants.
 */
export function FenceVine({ p, month, design }: { p: PlacedPlant; month: number; design: FenceDesign }) {
  const engine = useApp((x) => x.engine);
  const site = useApp((x) => x.site);
  const showBloom = useApp((x) => x.layers.bloom);
  const s = p.species;
  const look = s.look!;
  const run = fenceRun(site, engine.fenceDesign);
  const step = engine.foliage.quantizeStep;
  const h = quantizeSize(p.size.height, step), w = quantizeSize(p.size.width, step);
  const blooming = showBloom && isBlooming(s, month);
  const seed = seedFromId(p.inst.id);
  const result = useMemo(() => {
    if (!run) return null;
    const layout = fenceLayout(design, run.lengthFt, engine.fenceDesign);
    const dir: [number, number] = [(run.b[0] - run.a[0]) / run.lengthFt, (run.b[1] - run.a[1]) / run.lengthFt];
    const yard: [number, number] = [dir[1], -dir[0]];
    const [px, py] = p.inst.position;
    return fenceVineGrowth({
      seed, along: (px - run.a[0]) * dir[0] + (py - run.a[1]) * dir[1], height: h, width: w, matureHeight: s.matureHeight,
      panels: layout.panels.map((q) => ({ from: q.from, to: q.to, top: q.topFt })),
      boards: layout.segments.filter((sg) => sg.kind === 'boards').map((sg) => ({ from: sg.from, to: sg.to, top: sg.heightFt })),
      a: run.a, dir, yard, origin: [px, py],
      leaf: { lengthFt: look.leaf.lengthFt, widthFt: look.leaf.widthFt, perFt: look.leaf.perFt ?? 10, displayScale: engine.foliage.leafDisplayScale * (look.leaf.display ?? 1) },
      flower: look.flower ? { sizeFt: look.flower.sizeFt ?? 0.08, displayScale: engine.foliage.flowerDisplayScale } : undefined,
      blooming: blooming && !!look.flower,
    }, engine.fenceVine);
  }, [run, design, engine, p.inst.position, seed, h, w, s.matureHeight, look, blooming]);
  const wood = useMemo(() => (result ? branchGeometry({ segments: result.segments, tips: [] }) : null), [result]);
  useEffect(() => () => { wood?.dispose(); }, [wood]);
  if (!result) return null;
  return (
    <group raycast={() => null}>
      {wood && (
        <mesh raycast={() => null} geometry={wood} castShadow>
          <meshStandardMaterial color={look.trunkColor ?? '#6b5a48'} roughness={1} />
        </mesh>
      )}
      <Leaves leaves={result.leaves} shape={look.leaf.shape} fold={look.leaf.fold} droop={0} color={s.foliageColor} under={look.leaf.underColor} />
      {result.flowers.length > 0 && <Flowers list={result.flowers} form="petal" color={look.flower?.color ?? s.bloomColor} center={look.flower?.centerColor ?? '#f2d55c'} />}
    </group>
  );
}
