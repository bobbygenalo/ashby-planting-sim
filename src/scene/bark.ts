import * as THREE from 'three';

let shared: THREE.CanvasTexture | null | undefined;

/**
 * A tileable grey bark texture: vertical furrows, a fine grain and a scatter of short cracks. It is tinted by the
 * material color, used both as the color map and as a bump map, and made once and shared. Null without a document (tests).
 */
export function barkTexture(): THREE.CanvasTexture | null {
  if (shared !== undefined) return shared;
  if (typeof document === 'undefined') return (shared = null);
  const W = 128, H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return (shared = null);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  // Furrows: a few sine waves whose frequencies are whole numbers across the width, so the texture tiles sideways.
  const waves = [3, 5, 9, 14, 22].map((k) => ({ k, a: 0.9 / Math.sqrt(k), p: rnd() * 6.283 }));
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const along = Math.sin((y / H) * 6.283 * 2 + 1) * 0.06;
    for (let x = 0; x < W; x++) {
      let n = 0;
      for (const w of waves) n += w.a * Math.sin((x / W) * 6.283 * w.k + w.p + Math.sin((y / H) * 6.283 * 2) * 0.5);
      const v = 176 + 38 * Math.max(-1, Math.min(1, n * 0.6)) + 14 * (rnd() - 0.5) + along * 40;
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, v));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Short dark cracks and a few paler flakes.
  for (let n = 0; n < 70; n++) {
    const x0 = rnd() * W, y0 = rnd() * H, len = 14 + rnd() * 50;
    ctx.strokeStyle = `rgba(0,0,0,${0.12 + rnd() * 0.18})`;
    ctx.lineWidth = 0.8 + rnd() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    for (let s = 1; s <= 4; s++) ctx.lineTo(x0 + (rnd() - 0.5) * 6, y0 + (len * s) / 4);
    ctx.stroke();
  }
  for (let n = 0; n < 40; n++) {
    ctx.fillStyle = `rgba(255,255,255,${0.05 + rnd() * 0.08})`;
    ctx.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 5, 4 + rnd() * 12);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return (shared = tex);
}
