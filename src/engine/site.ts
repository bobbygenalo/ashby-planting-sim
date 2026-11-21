import { bbox, pointInPolygon } from './geometry';
import { parseFeetInches } from './units';
import type { ContextObjectCfg, EngineConfig, Measure, Pt, Pt3, SiteConfig, StructureCfg } from './types';

export interface SiteFlags {
  /** Whether toggleable structures (the ADU) are modeled. */
  aduEnabled: boolean;
}

export function loadSite(raw: unknown): SiteConfig {
  const s = raw as SiteConfig;
  if (!s || s.schema !== 'ashby-site/1') throw new Error('Unsupported site config schema');
  for (const k of ['lot', 'structures', 'zones', 'timeZone'] as const) {
    if (!(k in s)) throw new Error(`Site config missing "${k}"`);
  }
  return s;
}

export function activeStructures(site: SiteConfig, flags: SiteFlags): StructureCfg[] {
  return site.structures.filter((s) => !s.toggleable || flags.aduEnabled);
}

/** 3D points of the convex roof volume, in site coordinates. */
export function roofPoints(s: StructureCfg): Pt3[] {
  const outline = s.roofFootprint ?? s.footprint;
  const eave = s.eaveHeight;
  if (s.roofForm === 'flat' || outline.length !== 4) {
    const top = s.roofForm === 'flat' ? eave + 0.5 : s.ridgeHeight;
    return [...outline.map(([x, y]): Pt3 => [x, y, eave]), ...outline.map(([x, y]): Pt3 => [x, y, top])];
  }
  const { minX, minY, maxX, maxY } = bbox(outline);
  const w = maxX - minX;
  const d = maxY - minY;
  const pts: Pt3[] = outline.map(([x, y]) => [x, y, eave]);
  const ridgeAlongX = w >= d;
  const inset = s.roofForm === 'hip' ? Math.min(w, d) / 2 : 0;
  if (ridgeAlongX) {
    const cy = (minY + maxY) / 2;
    pts.push([minX + inset, cy, s.ridgeHeight], [maxX - inset, cy, s.ridgeHeight]);
  } else {
    const cx = (minX + maxX) / 2;
    pts.push([cx, minY + inset, s.ridgeHeight], [cx, maxY - inset, s.ridgeHeight]);
  }
  return pts;
}

/** Convex 3D body of a structure for shadow casting: footprint at ground plus roof volume. */
export function structureSolidPoints(s: StructureCfg): Pt3[] {
  return [...s.footprint.map(([x, y]): Pt3 => [x, y, 0]), ...roofPoints(s)];
}

export interface Solid {
  id: string;
  points: Pt3[];
  /** Share of sunlight blocked (1 = opaque). */
  density: number;
}

export interface SunScene {
  latitude: number;
  longitude: number;
  timeZone: string;
  rearBearingDeg: number;
  driveSide: 'left' | 'right';
  lotWidth: number;
  lotDepth: number;
  solids: Solid[];
  /** Ground footprints that block cells from the sun map. */
  footprints: Pt[][];
  zones: { id: string; name: string; polygon: Pt[] }[];
}

function treeSolid(o: ContextObjectCfg, rings: number): Solid {
  const [cx, cy] = o.position ?? [0, 0];
  const r = (o.canopyWidth ?? 10) / 2;
  const base = o.trunkHeight ?? o.height * 0.3;
  const mid = (base + o.height) / 2;
  const pts: Pt3[] = [];
  const ring = (z: number, radius: number) => {
    for (let i = 0; i < rings; i++) {
      const a = (i / rings) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, z]);
    }
  };
  ring(base, r * 0.6);
  ring(mid, r);
  ring(o.height, r * 0.5);
  return { id: o.id, points: pts, density: o.density ?? 0.75 };
}

function lineSolids(o: ContextObjectCfg): Solid[] {
  const line = o.line ?? [];
  const out: Solid[] = [];
  const t = (o.thickness ?? 0.3) / 2;
  for (let i = 0; i < line.length - 1; i++) {
    const [x1, y1] = line[i];
    const [x2, y2] = line[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const nx = (-(y2 - y1) / len) * t;
    const ny = ((x2 - x1) / len) * t;
    const ends: Pt[] = [
      [x1 + nx, y1 + ny],
      [x1 - nx, y1 - ny],
      [x2 + nx, y2 + ny],
      [x2 - nx, y2 - ny],
    ];
    out.push({
      id: `${o.id}#${i}`,
      points: [...ends.map(([x, y]): Pt3 => [x, y, 0]), ...ends.map(([x, y]): Pt3 => [x, y, o.height])],
      density: 1,
    });
  }
  return out;
}

export function buildSunScene(site: SiteConfig, flags: SiteFlags, engine: EngineConfig): SunScene {
  const solids: Solid[] = [];
  const footprints: Pt[][] = [];
  for (const s of activeStructures(site, flags)) {
    solids.push({ id: s.id, points: structureSolidPoints(s), density: 1 });
    footprints.push(s.footprint);
  }
  for (const o of site.contextObjects) {
    if (o.kind === 'tree') solids.push(treeSolid(o, engine.scene.treeCanopyRings));
    else if (o.kind === 'pole' && o.position) {
      const [x, y] = o.position;
      const h = 0.5;
      const pts: Pt[] = [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]];
      solids.push({
        id: o.id,
        points: [...pts.map(([px, py]): Pt3 => [px, py, 0]), ...pts.map(([px, py]): Pt3 => [px, py, o.height])],
        density: 1,
      });
    } else if (o.kind === 'fence' || o.kind === 'wall') solids.push(...lineSolids(o));
    else if (o.kind === 'building' && o.footprint) {
      solids.push({
        id: o.id,
        points: [...o.footprint.map(([x, y]): Pt3 => [x, y, 0]), ...o.footprint.map(([x, y]): Pt3 => [x, y, o.height])],
        density: 1,
      });
      footprints.push(o.footprint);
    }
  }
  return {
    latitude: site.latitude,
    longitude: site.longitude,
    timeZone: site.timeZone,
    rearBearingDeg: site.rearBearingDeg,
    driveSide: site.driveSide,
    lotWidth: site.lot.width,
    lotDepth: site.lot.depth,
    solids,
    footprints,
    zones: site.zones.map((z) => ({ id: z.id, name: z.name, polygon: z.polygon })),
  };
}

export interface PrintedCheck {
  id: string;
  label: string;
  printed: number;
  measured: number;
  deltaInches: number;
  ok: boolean;
}

function measure(site: SiteConfig, m: Measure): number {
  const find = (id: string) => {
    const s = site.structures.find((x) => x.id === id);
    if (!s) throw new Error(`Unknown structure ${id}`);
    return s;
  };
  switch (m.type) {
    case 'lot':
      return m.axis === 'x' ? site.lot.width : site.lot.depth;
    case 'extent': {
      const s = find(m.structure);
      const b = bbox(m.roof && s.roofFootprint ? s.roofFootprint : s.footprint);
      return m.axis === 'x' ? b.maxX - b.minX : b.maxY - b.minY;
    }
    case 'edgeToLot': {
      const b = bbox(find(m.structure).footprint);
      if (m.edge === 'minX') return b.minX;
      if (m.edge === 'minY') return b.minY;
      if (m.edge === 'maxX') return site.lot.width - b.maxX;
      return site.lot.depth - b.maxY;
    }
    case 'gap': {
      const a = bbox(find(m.from).footprint);
      const b = bbox(find(m.to).footprint);
      return m.axis === 'x' ? b.minX - a.maxX : b.minY - a.maxY;
    }
  }
}

/** Compare every printed plan dimension with what the site config measures. */
export function checkPrintedDimensions(site: SiteConfig, toleranceInches = 1): PrintedCheck[] {
  return site.printed.map((p) => {
    const printed = parseFeetInches(p.value);
    const measured = measure(site, p.measure);
    const deltaInches = (measured - printed) * 12;
    return { id: p.id, label: p.label, printed, measured, deltaInches, ok: Math.abs(deltaInches) <= toleranceInches };
  });
}

/** Grid of zone indices per cell (255 = no zone) and a structure mask. */
export function rasterizeSite(scene: SunScene, cellSize: number) {
  const nx = Math.ceil(scene.lotWidth / cellSize);
  const ny = Math.ceil(scene.lotDepth / cellSize);
  /** 0 outside the lot, 1 open ground, 2 under a structure */
  const mask = new Uint8Array(nx * ny);
  const zone = new Uint8Array(nx * ny).fill(255);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = (i + 0.5) * cellSize;
      const y = (j + 0.5) * cellSize;
      const k = j * nx + i;
      if (x > scene.lotWidth || y > scene.lotDepth) continue;
      mask[k] = scene.footprints.some((f) => pointInPolygon(x, y, f)) ? 2 : 1;
      for (let z = 0; z < scene.zones.length; z++) {
        if (pointInPolygon(x, y, scene.zones[z].polygon)) {
          zone[k] = z;
          break;
        }
      }
    }
  }
  return { nx, ny, mask, zone };
}
