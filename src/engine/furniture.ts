import type { Pt } from './types';

/** The frame of a placed rectangle: its center, the angle of its first edge, and its two side lengths. */
export function rectFrame(points: Pt[]): { cx: number; cy: number; angle: number; long: number; short: number } {
  const [p0, p1, p2] = points;
  const cx = points.reduce((a, p) => a + p[0], 0) / points.length;
  const cy = points.reduce((a, p) => a + p[1], 0) / points.length;
  return { cx, cy, angle: Math.atan2(p1[1] - p0[1], p1[0] - p0[0]), long: Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), short: Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) };
}

/** Chairs pulled out around the table: this much of each side of the footprint is chair, in feet. */
export const CHAIR_ZONE = { end: 1.5, side: 1.75 };
/** A chair seat is this wide and deep. */
export const CHAIR = 1.4;
const GAP = 0.1;

export interface SeatSpot {
  /** Chair center in the table's own frame (feet from its center, long side along X). */
  x: number;
  y: number;
  /** Unit vector from the chair toward the table. */
  fx: number;
  fy: number;
}

/**
 * Where a table of an `L` by `W` footprint is laid out: the table itself, and eight seats (three a side, one at each
 * end) in a ring, so seats with neighboring numbers sit next to one another. One description for the drawing and for
 * the people who sit there.
 */
export function tableLayout(L: number, W: number): { tableL: number; tableW: number; seats: SeatSpot[] } {
  const tl = Math.max(2, L - 2 * CHAIR_ZONE.end), tw = Math.max(1.5, W - 2 * CHAIR_ZONE.side);
  const side = tw / 2 + GAP + CHAIR / 2, end = tl / 2 + GAP + CHAIR / 2;
  const xs = [-1, 0, 1].map((i) => i * (tl / 3.2));
  const seats: SeatSpot[] = [
    ...xs.map((x): SeatSpot => ({ x, y: -side, fx: 0, fy: 1 })),
    { x: end, y: 0, fx: -1, fy: 0 },
    ...[...xs].reverse().map((x): SeatSpot => ({ x, y: side, fx: 0, fy: -1 })),
    { x: -end, y: 0, fx: 1, fy: 0 },
  ];
  return { tableL: tl, tableW: tw, seats };
}

/** A table's seats in site coordinates: where each chair stands, which way it faces, and where a person waits behind it. */
export interface WorldSeat {
  id: string;
  table: string;
  index: number;
  chair: Pt;
  /** Direction the chair faces, in radians. */
  facing: number;
  /** Unit vector pointing away from the table, the way the chair slides out. */
  out: Pt;
  /** Where someone stands behind the chair before pulling it out. */
  approach: Pt;
}

export function worldSeats(id: string, points: Pt[], approachFt: number): { center: Pt; seats: WorldSeat[] } {
  const f = rectFrame(points);
  const { seats } = tableLayout(f.long, f.short);
  const c = Math.cos(f.angle), s = Math.sin(f.angle);
  const toWorld = (x: number, y: number): Pt => [f.cx + x * c - y * s, f.cy + x * s + y * c];
  return {
    center: [f.cx, f.cy],
    seats: seats.map((seat, index): WorldSeat => {
      const chair = toWorld(seat.x, seat.y);
      const out: Pt = [-(seat.fx * c - seat.fy * s), -(seat.fx * s + seat.fy * c)];
      return {
        id: `${id}:${index}`, table: id, index, chair,
        facing: f.angle + Math.atan2(seat.fy, seat.fx),
        out,
        approach: [chair[0] + out[0] * (CHAIR / 2 + approachFt), chair[1] + out[1] * (CHAIR / 2 + approachFt)],
      };
    }),
  };
}
