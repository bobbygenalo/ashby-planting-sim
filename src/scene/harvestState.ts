/**
 * Where each picker's basket opens, in site coordinates, by walker index. The person drawing writes it every frame; the
 * fruit flying in from the plants reads it to know where to land.
 */
export const basketAt = new Map<number, [number, number, number]>();
