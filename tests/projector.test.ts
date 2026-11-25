import { describe, expect, it } from 'vitest';
import { beamTriangle, castOnWall, coverage, dogSpheres, inBeam, personSpheres } from '../src/engine/projector';

// A wall at x = 0 facing east; a projector 17 ft out at 5.2 ft; a screen 9 wide and 5 high, its bottom 3.4 ft up, centered on y = 100.
const lens: [number, number, number] = [16.45, 100, 5.2];
const wallX = 0;
const screen = { y0: 95.5, y1: 104.5, z0: 3.4, z1: 8.4 };

describe('shadows on the screen', () => {
  it('a person standing in the beam shadows the screen, bigger the nearer they stand to the projector', () => {
    const near = coverage(castOnWall(personSpheres(12, 100, Math.PI, 5.6), lens, wallX), screen);
    const mid = coverage(castOnWall(personSpheres(8, 100, Math.PI, 5.6), lens, wallX), screen);
    const far = coverage(castOnWall(personSpheres(3, 100, Math.PI, 5.6), lens, wallX), screen);
    expect(near).toBeGreaterThan(0.12);
    expect(mid).toBeGreaterThan(far);
    expect(near).toBeGreaterThan(mid);
    expect(far).toBeGreaterThan(0.03);
  });

  it('the shadow lies where the light says: on the far side of the wall from the person, scaled from the lens', () => {
    const body = personSpheres(8, 100, 0, 5.6)[0]; // the head
    const [d] = castOnWall([body], lens, wallX);
    const k = (lens[0] - wallX) / (lens[0] - body.x);
    expect(d.r).toBeCloseTo(body.r * k, 6);
    expect(d.z).toBeCloseTo(lens[2] + (body.z - lens[2]) * k, 6);
    // someone to the left of the beam's middle (smaller y) casts to the left on the screen too
    const [left] = castOnWall([{ ...body, y: 98 }], lens, wallX);
    expect(left.y).toBeLessThan(100);
  });

  it('nobody out of the light casts one: beside the beam, behind the projector, or at the wall itself', () => {
    expect(coverage(castOnWall(personSpheres(8, 112, 0, 5.6), lens, wallX), screen)).toBe(0); // well to the side
    expect(coverage(castOnWall(personSpheres(20, 100, 0, 5.6), lens, wallX), screen)).toBe(0); // behind the lens
    expect(castOnWall(personSpheres(0.2, 100, 0, 5.6), lens, wallX).length).toBeLessThan(personSpheres(0.2, 100, 0, 5.6).length); // balls at the wall cast none
  });

  it('a small child below the beam casts no shadow on the screen, but a tall teen does', () => {
    expect(coverage(castOnWall(personSpheres(6, 100, 0, 3.0), lens, wallX), screen)).toBe(0);
    expect(coverage(castOnWall(personSpheres(6, 100, 0, 5.6), lens, wallX), screen)).toBeGreaterThan(0.04);
  });

  it('raised arms for a shadow puppet make the shadow wider', () => {
    const down = castOnWall(personSpheres(8, 100, 0, 5.0), lens, wallX), up = castOnWall(personSpheres(8, 100, 0, 5.0, true), lens, wallX);
    const span = (ds: typeof down) => Math.max(...ds.map((d) => d.y + d.r)) - Math.min(...ds.map((d) => d.y - d.r));
    expect(span(up)).toBeGreaterThan(span(down));
    expect(coverage(up, screen)).toBeGreaterThan(coverage(down, screen));
  });

  it('a dog in the beam casts a shadow, low on the wall: under the screen, so not on it', () => {
    const discs = castOnWall(dogSpheres(5, 100, 0, 1.9), lens, wallX);
    expect(discs.length).toBe(3);
    expect(Math.max(...discs.map((d) => d.z + d.r))).toBeGreaterThan(0.5);
    expect(coverage(discs, screen)).toBe(0);
  });

  it('the beam on the ground is the triangle from the lens to the screen, and its edge counts with a margin', () => {
    const tri = beamTriangle(lens, wallX, screen.y0, screen.y1);
    expect(inBeam(8, 100, tri, 0)).toBe(true);
    expect(inBeam(8, 106, tri, 0)).toBe(false);
    expect(inBeam(8, 104.5, tri, 0)).toBe(false); // outside the fan at that distance from the wall
    expect(inBeam(8, 104.5, tri, 2.5)).toBe(true); // but near it
    expect(inBeam(30, 100, tri, 1)).toBe(false);
  });
});
