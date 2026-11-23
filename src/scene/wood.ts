import * as THREE from 'three';

let grain: THREE.CanvasTexture | null | undefined;
let soil: THREE.CanvasTexture | null | undefined;

const lcg = (seed: number) => { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

/**
 * A tileable grey plank texture: long grain lines along U with a gentle wave, a few darker streaks and the odd knot.
 * Tinted by the plank's vertex color. Null without a document (tests).
 */
export function woodTexture(): THREE.CanvasTexture | null {
  if (grain !== undefined) return grain;
  if (typeof document === 'undefined') return (grain = null);
  const W = 256, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return (grain = null);
  const rnd = lcg(777);
  ctx.fillStyle = '#ececec';
  ctx.fillRect(0, 0, W, H);
  for (let n = 0; n < 150; n++) {
    const y0 = rnd() * H, amp = 1 + rnd() * 3, f = 1 + Math.floor(rnd() * 3), ph = rnd() * 6.28;
    ctx.strokeStyle = `rgba(${rnd() < 0.5 ? '70,50,30' : '255,245,230'},${0.06 + rnd() * 0.14})`;
    ctx.lineWidth = 0.6 + rnd() * 1.6;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 8) {
      const y = y0 + Math.sin((x / W) * 6.283 * f + ph) * amp;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let n = 0; n < 2; n++) {
    const x = rnd() * W, y = 20 + rnd() * (H - 40);
    for (let r = 12; r > 2; r -= 3) {
      ctx.strokeStyle = `rgba(60,40,25,${0.12 + (12 - r) * 0.02})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.8, r * 0.7, 0, 0, 6.283);
      ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return (grain = t);
}

/** A tileable crumbly soil texture: mottled darks and lights with scattered specks. Null without a document. */
export function soilTexture(): THREE.CanvasTexture | null {
  if (soil !== undefined) return soil;
  if (typeof document === 'undefined') return (soil = null);
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  if (!ctx) return (soil = null);
  const rnd = lcg(4242);
  ctx.fillStyle = '#c4c4c4';
  ctx.fillRect(0, 0, S, S);
  for (let n = 0; n < 900; n++) {
    const x = rnd() * S, y = rnd() * S, r = 2 + rnd() * 9;
    const v = Math.floor(120 + rnd() * 110);
    ctx.fillStyle = `rgba(${v},${v},${v},${0.18 + rnd() * 0.25})`;
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, r, 0, 6.283);
      ctx.fill();
    }
  }
  for (let n = 0; n < 1400; n++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(20,12,6,0.55)' : 'rgba(255,255,255,0.4)';
    ctx.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2.2, 1 + rnd() * 2.2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(0.5, 0.5); // a tile every two feet
  t.anisotropy = 4;
  return (soil = t);
}
