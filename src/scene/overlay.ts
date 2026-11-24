import { useMemo } from 'react';
import { overlayHeightFt } from '../engine/hardscape';
import { useApp } from '../store/store';

/**
 * The height at which flat overlays (the sun map, the easement, the placement heatmap, the lot and setback lines) are drawn:
 * above the top of the tallest flat surface in the plan. At a fixed low height they were level with some patio or bed top
 * and flickered through it as the camera moved.
 */
export function useOverlayBase(): number {
  const hardscape = useApp((s) => s.hardscape);
  const cfg = useApp((s) => s.engine.hardscape);
  return useMemo(() => overlayHeightFt(hardscape, cfg), [hardscape, cfg]);
}

/** Depth bias for a surface of a given kind and place in a list, so that where two coplanar surfaces overlap the same one always wins: later in the list, and a roof over a wall and a slab over a roof. */
export function depthBias(kind: number, index: number): { polygonOffset: true; polygonOffsetFactor: number; polygonOffsetUnits: number } {
  const i = Math.min(Math.max(index, 0), 39); // the part's place never outweighs a step in kind
  return { polygonOffset: true, polygonOffsetFactor: -(kind * 4 + i * 0.1), polygonOffsetUnits: -(kind * 40 + i * 0.5) };
}
