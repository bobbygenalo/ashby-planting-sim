import { footprint } from './hardscape';
import type { PlacedPlant } from './growth';
import type { EngineConfig, HardscapeElement, Pt } from './types';

/** Settings for framing something in the view (`scene.fit` in engine.json). */
export interface FitCfg {
  /** How much room to leave round it: 1.5 means the thing fills about two thirds of the view. */
  margin: number;
  /** Never frame closer than this radius, in feet, so a groundcover or a small bed is still seen in its surroundings. */
  minRadiusFt: number;
  /** The camera takes this long to glide there. */
  animateS: number;
}

/** A box round something in the yard, in site feet (z up from the ground). */
export interface FitBox {
  minX: number; maxX: number; minY: number; maxY: number; maxZ: number;
}

export interface FitSphere {
  center: [number, number, number];
  radius: number;
}

/**
 * The box round whatever is selected in the yard: a plant at the size it has now (crown and height), a drawn element (its outline
 * and height) or the hive; null when nothing is selected (or the thing is gone).
 */
export function selectionBox(args: {
  plants: PlacedPlant[];
  elements: HardscapeElement[];
  hardscapeCfg: EngineConfig['hardscape'];
  selectedId: string | null;
  selectedElementId: string | null;
  hive: Pt | null;
  hiveSelected: boolean;
}): FitBox | null {
  const { selectedId, selectedElementId } = args;
  if (selectedElementId) {
    const el = args.elements.find((e) => e.id === selectedElementId);
    if (!el) return null;
    const pts = footprint(el, args.hardscapeCfg);
    if (!pts.length) return null;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), maxZ: Math.max(el.height, 0.2) };
  }
  if (selectedId) {
    const p = args.plants.find((q) => q.inst.id === selectedId);
    if (!p) return null;
    const [x, y] = p.inst.position;
    const r = p.size.width / 2;
    return { minX: x - r, maxX: x + r, minY: y - r, maxY: y + r, maxZ: p.size.height };
  }
  if (args.hiveSelected && args.hive) {
    const [x, y] = args.hive;
    return { minX: x - 1.5, maxX: x + 1.5, minY: y - 1.5, maxY: y + 1.5, maxZ: 4 };
  }
  return null;
}

/** The sphere round a box, never smaller than `minRadiusFt`. */
export function fitSphere(box: FitBox, cfg: FitCfg): FitSphere {
  const center: [number, number, number] = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, box.maxZ / 2];
  const r = Math.hypot(box.maxX - box.minX, box.maxY - box.minY, box.maxZ) / 2;
  return { center, radius: Math.max(r, cfg.minRadiusFt) };
}

/**
 * The distance from the target at which a perspective camera sees a sphere filling the view with room to spare: it must fit
 * across the narrower of the vertical and horizontal fields of view.
 */
export function fitDistance(radius: number, verticalFovDeg: number, aspect: number, margin: number): number {
  const v = (verticalFovDeg * Math.PI) / 180;
  const h = 2 * Math.atan(Math.tan(v / 2) * aspect);
  return (radius * margin) / Math.sin(Math.min(v, h) / 2);
}

/** Where a camera goes to frame a sphere without turning: the same direction from its target, at the fitting distance, looking at the sphere's center. */
export function fitPose(camera: [number, number, number], target: [number, number, number], sphere: FitSphere, distance: number): { position: [number, number, number]; target: [number, number, number] } {
  const d: [number, number, number] = [camera[0] - target[0], camera[1] - target[1], camera[2] - target[2]];
  const len = Math.hypot(...d) || 1;
  const u: [number, number, number] = [d[0] / len, d[1] / len, d[2] / len];
  return { position: [sphere.center[0] + u[0] * distance, sphere.center[1] + u[1] * distance, sphere.center[2] + u[2] * distance], target: sphere.center };
}

/** The zoom at which a top-down orthographic camera, whose unzoomed view is `halfW` by `halfH` feet either side of center, fits a sphere. */
export function fitZoom(radius: number, halfW: number, halfH: number, margin: number): number {
  return Math.min(halfW, halfH) / (radius * margin);
}
