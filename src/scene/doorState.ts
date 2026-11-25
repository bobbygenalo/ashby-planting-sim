/**
 * How far each drawn door is open, by opening id, 0 (shut) to 1 (wide open): written every frame by the life layer from the
 * simulation (people open and close the doors they use) and read by the facade to swing, slide or roll the door. A door not here is shut.
 */
export const doorOpen = new Map<string, number>();
