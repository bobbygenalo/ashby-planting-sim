/**
 * Where the slats of a screen stand, along its line: `count` slats turned `angleDeg`, evenly spaced from just inside the first
 * post to just inside the last. Also the along-line extent of one turned slat, and the clear gaps between neighbors: along the
 * line and square to their faces (what you would slip a hand into).
 */
export function slatLayout(lenFt: number, o: { slatFt: number; slatWidthFt: number; slatAngleDeg: number; slatCount: number; endPostFt: number }) {
  const a = (o.slatAngleDeg * Math.PI) / 180;
  const extent = Math.abs(o.slatWidthFt * Math.cos(a)) + Math.abs(o.slatFt * Math.sin(a));
  const inner = lenFt - o.endPostFt; // between the post faces
  const pitch = o.slatCount > 1 ? (inner - extent) / (o.slatCount - 1) : 0;
  const first = o.endPostFt / 2 + extent / 2;
  const centers = Array.from({ length: o.slatCount }, (_, i) => first + i * pitch);
  return { centers, pitch, extent, gapAlongFt: pitch - extent, gapAcrossFt: pitch * Math.abs(Math.sin(a)) - o.slatFt };
}
