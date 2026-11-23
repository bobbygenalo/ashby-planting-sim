import * as THREE from 'three';
import type { SurfacePattern } from '../engine/types';

const S = 512;
const cache = new Map<SurfacePattern, THREE.CanvasTexture | null>();

const lcg = (seed: number) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
const gray = (v: number, a = 1) => { const g = Math.max(0, Math.min(255, Math.round(v))); return `rgba(${g},${g},${g},${a})`; };
const OFFS = [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S], [S, S], [-S, -S], [S, -S], [-S, S]];

/** Draw something at each wrapped copy near the edges, so the texture tiles without a seam. */
function wrapped(x: number, y: number, r: number, draw: (x: number, y: number) => void) {
  for (const [ox, oy] of OFFS) {
    const nx = x + ox, ny = y + oy;
    if (nx > -r && nx < S + r && ny > -r && ny < S + r) draw(nx, ny);
  }
}

function noise(ctx: CanvasRenderingContext2D, base: number, amp: number, seed: number) {
  const r = lcg(seed);
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = base + (r() - 0.5) * amp;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** Large soft blotches of lighter and darker, so a big area does not look like one flat tone. */
function blotches(ctx: CanvasRenderingContext2D, rnd: () => number, count: number, strength: number) {
  for (let n = 0; n < count; n++) {
    const x = rnd() * S, y = rnd() * S, r = 30 + rnd() * 90;
    const dark = rnd() < 0.5;
    wrapped(x, y, r, (px, py) => {
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, dark ? `rgba(0,0,0,${strength})` : `rgba(255,255,255,${strength})`);
      g.addColorStop(1, 'rgba(128,128,128,0)');
      ctx.fillStyle = g;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
}

type Painter = (ctx: CanvasRenderingContext2D, rnd: () => number) => void;

const PAINT: Record<SurfacePattern, Painter> = {
  // Poured concrete: fine pores and specks, trowel sweeps, soft staining, and a saw-cut control joint on two edges.
  slab(ctx, rnd) {
    noise(ctx, 214, 20, 11);
    blotches(ctx, rnd, 40, 0.07);
    for (let n = 0; n < 24; n++) {
      const x = rnd() * S, y = rnd() * S, len = 90 + rnd() * 160, a = rnd() * Math.PI;
      ctx.strokeStyle = gray(rnd() < 0.5 ? 120 : 255, 0.05 + rnd() * 0.06);
      ctx.lineWidth = 6 + rnd() * 12;
      wrapped(x, y, len, (px, py) => { ctx.beginPath(); ctx.arc(px, py, len * 0.6, a, a + 0.9); ctx.stroke(); });
    }
    for (let n = 0; n < 500; n++) {
      ctx.fillStyle = gray(rnd() < 0.6 ? 90 : 245, 0.5);
      const x = rnd() * S, y = rnd() * S, r = 0.6 + rnd() * 1.6;
      ctx.fillRect(x, y, r, r);
    }
    ctx.fillStyle = gray(70);
    ctx.fillRect(0, 0, 3, S);
    ctx.fillRect(0, 0, S, 3);
    ctx.fillStyle = gray(240, 0.6);
    ctx.fillRect(3, 0, 2, S);
    ctx.fillRect(0, 3, S, 2);
  },

  // Interlocking pavers, 8 by 4 in, in running bond, each its own shade, with narrow sand joints.
  pavers(ctx, rnd) {
    ctx.fillStyle = gray(110);
    ctx.fillRect(0, 0, S, S);
    const rows = 12, bw = S / 6, bh = S / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = -1; c < 6; c++) {
        const x = c * bw + (r % 2 ? bw / 2 : 0), y = r * bh;
        const tone = 196 + (rnd() - 0.5) * 38;
        const draw = (px: number) => {
          ctx.fillStyle = gray(tone);
          ctx.fillRect(px + 2, y + 2, bw - 4, bh - 4);
          for (let k = 0; k < 40; k++) { ctx.fillStyle = gray(rnd() < 0.5 ? tone - 40 : tone + 30, 0.5); ctx.fillRect(px + 2 + rnd() * (bw - 4), y + 2 + rnd() * (bh - 4), 1.4, 1.4); }
          ctx.fillStyle = gray(tone + 22, 0.7);
          ctx.fillRect(px + 2, y + 2, bw - 4, 2);
        };
        draw(x);
        if (x + bw > S) draw(x - S);
      }
    }
  },

  // Irregular flagstone cut by a Voronoi pattern of a dozen stones per tile, with mortar or open joints, each stone its own tone.
  'flagstone-mortar'(ctx, rnd) { flagstone(ctx, rnd, true); },
  'flagstone-dry'(ctx, rnd) { flagstone(ctx, rnd, false); },

  // Compacted decomposed granite: a dense scatter of tiny grains, light and dark, with a few larger flecks.
  granular(ctx, rnd) {
    noise(ctx, 200, 44, 29);
    blotches(ctx, rnd, 50, 0.08);
    for (let n = 0; n < 700; n++) {
      ctx.fillStyle = gray(rnd() < 0.5 ? 100 + rnd() * 50 : 225 + rnd() * 30, 0.8);
      const r = 1 + rnd() * 2.6;
      ctx.beginPath();
      ctx.arc(rnd() * S, rnd() * S, r, 0, 6.283);
      ctx.fill();
    }
  },

  // Rounded gravel: stones with a shadow underneath and a highlight, over dark gaps.
  gravel(ctx, rnd) {
    ctx.fillStyle = gray(60);
    ctx.fillRect(0, 0, S, S);
    for (let n = 0; n < 900; n++) {
      const x = rnd() * S, y = rnd() * S, rx = 5 + rnd() * 9, ry = rx * (0.65 + rnd() * 0.35), a = rnd() * 3.14;
      const tone = 140 + rnd() * 90;
      wrapped(x, y, rx + 4, (px, py) => {
        ctx.fillStyle = gray(30, 0.55);
        ctx.beginPath(); ctx.ellipse(px + 2, py + 2.5, rx, ry, a, 0, 6.283); ctx.fill();
        ctx.fillStyle = gray(tone);
        ctx.beginPath(); ctx.ellipse(px, py, rx, ry, a, 0, 6.283); ctx.fill();
        ctx.fillStyle = gray(tone + 35, 0.6);
        ctx.beginPath(); ctx.ellipse(px - rx * 0.25, py - ry * 0.3, rx * 0.4, ry * 0.3, a, 0, 6.283); ctx.fill();
      });
    }
  },

  // Wood chip mulch: a heap of long chips at all angles, some pale, some dark, over a dark base.
  mulch(ctx, rnd) {
    ctx.fillStyle = gray(52);
    ctx.fillRect(0, 0, S, S);
    for (let n = 0; n < 1300; n++) {
      const x = rnd() * S, y = rnd() * S, len = 12 + rnd() * 24, wid = 4 + rnd() * 5, a = rnd() * 3.14;
      const tone = 80 + rnd() * 115;
      wrapped(x, y, len, (px, py) => {
        ctx.fillStyle = gray(tone);
        ctx.beginPath(); ctx.ellipse(px, py, len / 2, wid / 2, a, 0, 6.283); ctx.fill();
        ctx.strokeStyle = gray(tone - 45, 0.7);
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.fillStyle = gray(tone + 28, 0.5);
        ctx.beginPath(); ctx.ellipse(px - 1, py - 1, len / 3, wid / 5, a, 0, 6.283); ctx.fill();
      });
    }
  },

  // Turf: a mat of short blades leaning every way, with soft patches of lighter and darker grass.
  turf(ctx, rnd) {
    noise(ctx, 150, 30, 41);
    blotches(ctx, rnd, 60, 0.1);
    for (let n = 0; n < 9000; n++) {
      const x = rnd() * S, y = rnd() * S, len = 7 + rnd() * 12, a = -Math.PI / 2 + (rnd() - 0.5) * 2.2;
      ctx.strokeStyle = gray(rnd() < 0.35 ? 90 + rnd() * 40 : 170 + rnd() * 70, 0.55);
      ctx.lineWidth = 0.9 + rnd() * 0.9;
      wrapped(x, y, len, (px, py) => { ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(px + Math.cos(a) * len * 0.4 + 2, py + Math.sin(a) * len * 0.5, px + Math.cos(a) * len, py + Math.sin(a) * len); ctx.stroke(); });
    }
  },

  // Wood decking: 5.5 in boards running along the texture, gaps between them, staggered butt joints, grain and the odd knot.
  planks(ctx, rnd) { decking(ctx, rnd, true); },
  composite(ctx, rnd) { decking(ctx, rnd, false); },

  // Concrete block wall: 16 by 8 in blocks in running bond, mortar joints lighter, a rough pitted face.
  cmu(ctx, rnd) {
    ctx.fillStyle = gray(222);
    ctx.fillRect(0, 0, S, S);
    const rows = 6, bw = S / 3, bh = S / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = -1; c < 3; c++) {
        const x = c * bw + (r % 2 ? bw / 2 : 0), y = r * bh;
        const tone = 170 + (rnd() - 0.5) * 24;
        const draw = (px: number) => {
          ctx.fillStyle = gray(tone);
          ctx.fillRect(px + 4, y + 4, bw - 8, bh - 8);
          for (let k = 0; k < 160; k++) { ctx.fillStyle = gray(rnd() < 0.6 ? tone - 55 : tone + 40, 0.5); const s = 0.8 + rnd() * 2; ctx.fillRect(px + 4 + rnd() * (bw - 8), y + 4 + rnd() * (bh - 8), s, s); }
        };
        draw(x);
        if (x + bw > S) draw(x - S);
      }
    }
  },

  // Fence boards: tall boards 5.3 in wide with gaps, vertical grain, each a slightly different tone.
  boards(ctx, rnd) {
    ctx.fillStyle = gray(70);
    ctx.fillRect(0, 0, S, S);
    const n = 9, w = S / n;
    for (let i = 0; i < n; i++) {
      const tone = 205 + (rnd() - 0.5) * 36;
      ctx.fillStyle = gray(tone);
      ctx.fillRect(i * w + 2, 0, w - 4, S);
      for (let k = 0; k < 26; k++) {
        const x = i * w + 3 + rnd() * (w - 6), a = (rnd() - 0.5) * 6;
        ctx.strokeStyle = gray(rnd() < 0.5 ? tone - 55 : tone + 25, 0.18 + rnd() * 0.22);
        ctx.lineWidth = 0.7 + rnd();
        ctx.beginPath(); ctx.moveTo(x, 0);
        for (let y = 0; y <= S; y += 64) ctx.lineTo(x + Math.sin(y * 0.02 + a) * 2.2, y);
        ctx.stroke();
      }
    }
  },
};

function flagstone(ctx: CanvasRenderingContext2D, rnd: () => number, mortared: boolean) {
  const N = 11;
  const pts = Array.from({ length: N }, () => [rnd() * S, rnd() * S]);
  const tones = pts.map(() => 170 + rnd() * 55);
  const img = ctx.createImageData(S, S);
  const jr = lcg(7);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let d1 = 1e9, d2 = 1e9, k1 = 0;
      for (let k = 0; k < N; k++) {
        for (const [ox, oy] of OFFS) {
          const dx = pts[k][0] + ox - x, dy = pts[k][1] + oy - y;
          const d = dx * dx + dy * dy;
          if (d < d1) { d2 = d1; d1 = d; k1 = k; } else if (d < d2) d2 = d;
        }
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      const joint = mortared ? 6 : 5;
      let v: number;
      if (edge < joint) v = mortared ? 232 - jr() * 14 : 55 + jr() * 40;
      else v = tones[k1] + (jr() - 0.5) * 26 - Math.max(0, 8 - (edge - joint)) * (mortared ? 3 : 5);
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Pale streaks and a few darker pits on each stone.
  for (let n = 0; n < 260; n++) {
    ctx.fillStyle = gray(rnd() < 0.5 ? 120 : 240, 0.2);
    ctx.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 6, 1 + rnd() * 2);
  }
}

function decking(ctx: CanvasRenderingContext2D, rnd: () => number, wood: boolean) {
  ctx.fillStyle = gray(50);
  ctx.fillRect(0, 0, S, S);
  const rows = 11, h = S / rows;
  for (let r = 0; r < rows; r++) {
    const tone = wood ? 205 + (rnd() - 0.5) * 34 : 196 + (rnd() - 0.5) * 12;
    ctx.fillStyle = gray(tone);
    ctx.fillRect(0, r * h + 1.5, S, h - 3);
    if (wood) {
      for (let k = 0; k < 30; k++) {
        const y = r * h + 3 + rnd() * (h - 6), amp = 0.6 + rnd() * 1.6, ph = rnd() * 6;
        ctx.strokeStyle = gray(rnd() < 0.5 ? tone - 60 : tone + 25, 0.14 + rnd() * 0.22);
        ctx.lineWidth = 0.6 + rnd() * 1.1;
        ctx.beginPath();
        for (let x = 0; x <= S; x += 32) { const yy = y + Math.sin(x * 0.03 + ph) * amp; if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); }
        ctx.stroke();
      }
      if (rnd() < 0.25) { const kx = rnd() * S, ky = r * h + h / 2; ctx.strokeStyle = gray(tone - 80, 0.4); ctx.lineWidth = 1.3; ctx.beginPath(); ctx.ellipse(kx, ky, 9, 4, 0, 0, 6.283); ctx.stroke(); }
    } else {
      for (let k = 0; k < 90; k++) { ctx.fillStyle = gray(rnd() < 0.5 ? tone - 25 : tone + 20, 0.4); ctx.fillRect(rnd() * S, r * h + 2 + rnd() * (h - 4), 1.5, 1.5); }
    }
    // A butt joint where two boards meet, a different place on every row.
    const bx = rnd() * S;
    ctx.fillStyle = gray(45);
    ctx.fillRect(bx, r * h, 2.2, h);
  }
}

/** Every pattern there is a painter for. */
export const SURFACE_PATTERNS = Object.keys(PAINT) as SurfacePattern[];

/** The shared seamless grey texture for a surface pattern, made once. Null without a document (tests). */
export function surfaceTexture(pattern: SurfacePattern): THREE.CanvasTexture | null {
  if (cache.has(pattern)) return cache.get(pattern) ?? null;
  if (typeof document === 'undefined') { cache.set(pattern, null); return null; }
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  if (!ctx) { cache.set(pattern, null); return null; }
  let seed = 1;
  for (const ch of pattern) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  PAINT[pattern](ctx, lcg(seed));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  cache.set(pattern, t);
  return t;
}

/** A copy of a surface texture that repeats once every `tileFt` feet, for UVs measured in feet. */
export function tiledSurface(pattern: SurfacePattern, tileFt: number): THREE.CanvasTexture | null {
  const base = surfaceTexture(pattern);
  if (!base) return null;
  const t = base.clone();
  t.repeat.set(1 / tileFt, 1 / tileFt);
  t.needsUpdate = true;
  return t;
}
