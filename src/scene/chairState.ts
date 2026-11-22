/**
 * How far each chair is pulled out from its table, from 0 (pushed in) to 1 (pulled out), by seat id (`tableId:index`).
 * The people simulation writes it every frame; the table reads it to draw its chairs. A seat not in it is pushed in.
 */
export const chairPull = new Map<string, number>();
