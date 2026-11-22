/**
 * What the birthday party looks like right now, written by the life layer each frame and read by what it dresses: the
 * table (is the cake out?), the projector (what to say) and the presents. Everything is off when there is no birthday.
 */
export const partyState = {
  cake: false,
  presents: false,
  balloons: false,
  /** The greeting on the projector, or null for an ordinary film. */
  greeting: null as string | null,
};
