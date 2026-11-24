/**
 * Where each picker's basket opens, in site coordinates, by walker index. The person drawing writes it every frame; the
 * fruit flying in from the plants reads it to know where to land.
 */
export const basketAt = new Map<number, [number, number, number]>();

/** Where each picker's picking hand is, in site coordinates, by walker index, while a pick is under way: the fruit rides there. */
export const handTipAt = new Map<number, [number, number, number]>();
