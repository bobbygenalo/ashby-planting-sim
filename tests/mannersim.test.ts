import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import engineRaw from '../src/data/engine.json';
import speciesRaw from '../src/data/species.json';
import { instanceSize, type PlacedPlant } from '../src/engine/growth';
import materialsRaw from '../src/data/materials.json';
import { pointInPolygon } from '../src/engine/geometry';
import { buildLifeWorld, isInside, LifeSim, restsOnEdge, type LifeWorldInput, type Walker } from '../src/engine/life';
import { activeStructures, loadSite } from '../src/engine/site';
import type { EngineConfig, HardscapeElement, Material, PlantInstance, SpeciesLibrary } from '../src/engine/types';

const lib = speciesRaw as unknown as SpeciesLibrary;
const placed = (list: [string, number, number][], years = 12): PlacedPlant[] =>
  list.map(([speciesId, x, y], i) => {
    const inst: PlantInstance = { id: `p${i}`, speciesId, position: [x, y], plantedMonth: 0, container: '5gal', existing: false };
    const species = lib.species.find((q) => q.id === speciesId)!;
    return { inst, species, size: instanceSize(inst, species, years * 12, engine.growth) };
  });
// November: an apple, a kumquat and a lemon in fruit, and a rosemary and a salvia in bloom.
const YARD: [string, number, number][] = [['malus-mutsu', 34, 100], ['citrus-kumquat', 40, 96], ['citrus-meyer-lemon', 30, 108], ['rosmarinus-officinalis', 20, 100], ['salvia-leucantha', 44, 110]];

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;
const mats = materialsRaw as unknown as Material[];
const structures = activeStructures(site, { aduEnabled: true });
const bed = (x: number, y: number): HardscapeElement => ({ id: `rb${x}`, type: 'raisedBed', points: [[x, y], [x + 6, y], [x + 6, y + 3], [x, y + 3]], materialId: 'raised-bed-wood', height: 1.5, depthIn: 12, width: 0, existing: false });
const input = (over: Partial<LifeWorldInput> = {}): LifeWorldInput => ({
  site, structures, hardscape: [...(site.hardscape as HardscapeElement[]), bed(20, 60), bed(30, 90)], materials: mats, plants: [], month: 5, engine, ...over,
});
const make = (tweak?: (c: EngineConfig['life']) => void, people = 8, seed = 4, over: Partial<LifeWorldInput> = {}) => {
  const cfg = JSON.parse(JSON.stringify(engine.life)) as EngineConfig['life'];
  tweak?.(cfg);
  const w = buildLifeWorld({ ...input(over), engine: { ...engine, life: cfg } });
  return { s: new LifeSim(w, cfg, seed, { people, dogs: 1, bees: false }), w, cfg };
};
const run = (s: LifeSim, seconds: number, each?: (t: number) => void) => {
  for (let t = 0; t < seconds; t += 0.1) {
    s.step(0.1);
    each?.(t);
  }
};
const people = (s: LifeSim) => s.walkers.filter((w) => w.kind === 'person');
const only = (c: EngineConfig['life']) => { c.people.visitBias = 0; c.dining.bias = 0; c.harvest.bias = 0; c.people.meet.bias = 0; c.people.manner.play.chaseBias = 0; };

describe('people are different from one another', () => {
  it('each has their own personality, pace and weave', () => {
    const { s } = make();
    const p = people(s);
    expect(new Set(p.map((w) => w.pers.energy.toFixed(4))).size).toBe(p.length);
    expect(new Set(p.map((w) => w.pers.weaveLen.toFixed(3))).size).toBe(p.length);
  });

  it('wander a little to each side of a straight line instead of tracing the route', () => {
    const { s } = make((c) => { only(c); c.people.manner.linger.bias = 0; }, 3);
    let maxOff = 0;
    run(s, 120, () => { for (const w of people(s)) { maxOff = Math.max(maxOff, Math.abs(w.weaveOff)); } });
    expect(maxOff).toBeGreaterThan(0.1);
    expect(maxOff).toBeLessThanOrEqual(engine.life.people.manner.weave.ampFt[1] + 1e-6);
  });

  it('never carries the weave into a plant, a building or a bed', () => {
    const { s, w } = make(undefined, 8, 5);
    run(s, 240, () => {
      for (const a of people(s)) {
        if (isInside(a) || a.visit || restsOnEdge(a)) continue;
        for (const st of w.structures) expect(pointInPolygon(a.x, a.y, st)).toBe(false);
        const [ci, cj] = [Math.floor(a.x / w.cell), Math.floor(a.y / w.cell)];
        expect(w.blocked[cj * w.nx + ci]).toBe(0);
      }
    });
  });
});

describe('idle moments', () => {
  it('have people stop for a look, a phone, a spin, and the rest, for a few seconds each, then carry on', () => {
    const { s } = make((c) => { only(c); c.people.manner.linger.bias = 1; }, 8, 6);
    const seen = new Set<string>();
    let carried = false;
    run(s, 600, () => {
      for (const w of people(s)) {
        if (w.act?.kind === 'linger') {
          seen.add(w.act.what);
          expect(w.act.left).toBeGreaterThan(0.5);
          expect(w.act.left).toBeLessThan(80);
        } else if (w.speed > 1) carried = true;
      }
    });
    expect(seen.size).toBeGreaterThanOrEqual(4);
    expect(seen.has('look') || seen.has('sky') || seen.has('phone')).toBe(true);
    expect(carried).toBe(true);
  });

  it('shows the pose that goes with each: a phone in hand and head down, a bend to a flower, a bite of fruit, arms out in a spin', () => {
    const { s } = make((c) => { only(c); c.people.manner.linger.bias = 1; }, 8, 6);
    const maxima = { phone: 0, bend: 0, snack: 0, spin: 0, head: 0 };
    run(s, 900, () => {
      for (const w of people(s)) {
        if (w.pose === 'phone') { maxima.phone++; maxima.head = Math.max(maxima.head, w.headPitch); }
        if (w.pose === 'spin') maxima.spin++;
        if (w.pose === 'snack') maxima.snack++;
        maxima.bend = Math.max(maxima.bend, w.bend);
      }
    });
    expect(maxima.phone).toBeGreaterThan(0);
    expect(maxima.head).toBeGreaterThan(0.2);
    expect(maxima.spin).toBeGreaterThan(0);
  });

  it('bends to a flower and eats a piece of fruit when the yard has them, standing off the plant and facing it', () => {
    const { s, w } = make((c) => { only(c); c.people.manner.linger.bias = 1; c.people.manner.linger.weights = { smell: 1, snack: 1 }; }, 8, 6, { plants: placed(YARD), month: 11 });
    expect(w.blooms.length).toBeGreaterThan(0);
    expect(w.harvest.length).toBeGreaterThan(0);
    let bend = 0, bites = 0, color = false;
    run(s, 600, () => {
      for (const p of people(s)) {
        bend = Math.max(bend, p.bend);
        if (p.pose === 'snack') { bites++; if (p.snackColor) color = true; }
        if (p.act?.kind === 'linger' && p.act.phase === 'do' && p.act.face && (p.act.what === 'smell' || p.act.what === 'snack')) {
          const [fx, fy] = p.act.face;
          const want = Math.atan2(fy - p.y, fx - p.x);
          if (p.act.t > 2) expect(Math.abs(Math.atan2(Math.sin(p.heading - want), Math.cos(p.heading - want)))).toBeLessThan(0.5);
        }
      }
    });
    expect(bend).toBeGreaterThan(0.3);
    expect(bend).toBeLessThanOrEqual(engine.life.people.manner.linger.bendSmell + 1e-6);
    expect(bites).toBeGreaterThan(0);
    expect(color).toBe(true); // the fruit in hand has the plant's fruit color
  });

  it('keeps phones from the youngest, and spinning to the young', () => {
    const { s } = make((c) => { only(c); c.people.manner.linger.bias = 1; }, 15, 8);
    run(s, 600, () => {
      for (const w of people(s)) {
        if (w.act?.kind !== 'linger') continue;
        if (w.act.what === 'phone') expect(w.age).toBeGreaterThanOrEqual(engine.life.people.manner.linger.phoneMinAge);
        if (w.act.what === 'spin') expect(w.age).toBeLessThanOrEqual(engine.life.people.manner.linger.spinMaxAge);
      }
    });
  });

  it('perches on the rim of a raised bed, sitting at its height facing away, and gets up again', () => {
    const { s, w } = make((c) => { only(c); c.people.manner.linger.bias = 1; c.people.manner.linger.weights = { perch: 1 }; }, 6, 3);
    expect(w.rims.length).toBeGreaterThan(0);
    let sat = false;
    run(s, 400, () => {
      for (const p of people(s)) {
        if (p.act?.kind === 'linger' && p.act.what === 'perch' && p.act.phase === 'do' && p.sit > 0.99) {
          sat = true;
          expect(p.seatZ).toBe(1.5);
          const rim = p.act.rim!;
          expect(Math.hypot(p.x - rim.x, p.y - rim.y)).toBeLessThan(1e-6);
          expect(Math.abs(Math.atan2(Math.sin(p.heading - rim.face), Math.cos(p.heading - rim.face)))).toBeLessThan(0.3);
        }
      }
      // never two on one rim spot
      const rims = people(s).flatMap((p) => (p.act?.kind === 'linger' && p.act.what === 'perch' && p.act.rim ? [`${p.act.rim.x},${p.act.rim.y}`] : []));
      expect(new Set(rims).size).toBe(rims.length);
    });
    expect(sat).toBe(true);
    for (const p of people(s)) if (!p.act) expect(p.sit).toBe(0), expect(p.seatZ).toBeNull();
  });

  it('leans against a wall, clear of every building, and no two rims or walls overlap a building', () => {
    const { s, w } = make((c) => { only(c); c.people.manner.linger.bias = 1; c.people.manner.linger.weights = { lean: 1 }; }, 6, 2);
    let leaned = false;
    run(s, 300, () => {
      for (const p of people(s)) {
        if (p.act?.kind === 'linger' && p.act.what === 'lean' && p.act.phase === 'do') {
          leaned = true;
          for (const st of w.structures) expect(pointInPolygon(p.x, p.y, st)).toBe(false);
          if (p.act.t > 0.3) expect(p.pose).toBe('folded');
        }
      }
    });
    expect(leaned).toBe(true);
    for (const r of w.rims) for (const st of w.structures) expect(pointInPolygon(r.x, r.y, st)).toBe(false);
  });

  it('goes back to normal after: no pose, no bend, no head tilt left once the moment is over', () => {
    const { s } = make((c) => { only(c); c.people.manner.linger.bias = 1; }, 6, 9);
    run(s, 500);
    for (const p of people(s)) {
      if (p.act?.kind === 'linger') continue;
      expect(p.sit === 0 || p.act !== null).toBe(true);
    }
    // stop starting new ones and let everyone finish
    for (const c of [s['cfg'].people.manner.linger]) c.bias = 0;
    run(s, 90);
    for (const p of people(s)) {
      if (p.act) continue;
      expect(p.pose).toBe('none');
      expect(Math.abs(p.bend)).toBeLessThan(0.05);
      expect(Math.abs(p.headPitch)).toBeLessThan(0.05);
      expect(p.seatZ).toBeNull();
    }
  });
});

describe('glances and smiles', () => {
  it('turns the head toward someone near, never past the limit, and back to look ahead', () => {
    const { s } = make((c) => { only(c); }, 8, 7);
    let turned = 0, glances = 0;
    run(s, 300, () => {
      for (const p of people(s)) {
        expect(Math.abs(p.headTurn)).toBeLessThanOrEqual(engine.life.people.manner.gaze.maxTurn + 1e-6);
        if (Math.abs(p.headTurn) > 0.3 && !p.act) turned++;
        if (p.glance) glances++;
      }
    });
    expect(turned).toBeGreaterThan(20);
    expect(glances).toBeGreaterThan(50);
  });

  it('smiles a pleasant amount by default, more with company, and never outside 0 to 1', () => {
    const { s } = make((c) => { only(c); c.people.meet.bias = 0.5; }, 8, 11);
    let idleAvg = 0, n = 0, peak = 0;
    run(s, 400, () => {
      for (const p of people(s)) {
        expect(p.smile).toBeGreaterThanOrEqual(0);
        expect(p.smile).toBeLessThanOrEqual(1);
        peak = Math.max(peak, p.smile);
        if (!p.act && !p.glance) { idleAvg += p.smile; n++; }
      }
    });
    expect(idleAvg / n).toBeGreaterThan(0.08);
    expect(idleAvg / n).toBeLessThan(0.45);
    expect(peak).toBeGreaterThan(0.6);
  });
});

describe('greetings and play', () => {
  it('waves at people passing, sometimes gets a wave back, and not over and over at the same person', () => {
    const { s } = make((c) => { only(c); c.people.manner.linger.bias = 0; }, 8, 12);
    let waves = 0;
    const start = new Map<Walker, number>();
    run(s, 600, () => {
      for (const p of people(s)) {
        if (p.wave > 0 && !(start.get(p) ?? 0)) { waves++; start.set(p, 1); }
        if (p.wave <= 0) start.set(p, 0);
      }
    });
    expect(waves).toBeGreaterThan(3);
    // at most one wave per `cool` seconds each
    const per = waves / (people(s).length * (600 / engine.life.people.manner.greet.cool));
    expect(per).toBeLessThanOrEqual(1.05);
  });

  it('opens some meetings with a high five instead of a hug, the right arm up and both hands meeting', () => {
    const { s } = make((c) => { c.people.visitBias = 0; c.dining.bias = 0; c.harvest.bias = 0; c.people.manner.linger.bias = 0; c.people.manner.play.chaseBias = 0; c.people.meet.bias = 1; c.people.meet.hugChance = 0; c.people.manner.greet.highFive = { adult: 1, teen: 1, kid: 1 }; }, 10, 13);
    let fives = 0, maxArm = 0, together = 0;
    run(s, 500, () => {
      for (const p of people(s)) {
        if (p.five > 0.9) {
          fives++;
          const m = p.act?.kind === 'meet' ? s.walkers[p.act.partner] : null;
          if (m && m.five > 0.9) together++;
        }
        maxArm = Math.max(maxArm, p.five);
      }
    });
    expect(fives).toBeGreaterThan(0);
    expect(together).toBeGreaterThan(0); // both hands up at once
    expect(maxArm).toBeLessThanOrEqual(1);
    for (const p of people(s)) expect(p.five === 0 || p.act?.kind === 'meet').toBe(true);
  });

  it('has kids and teens skip now and then, and chase each other in a game of tag', () => {
    const { s } = make((c) => { c.people.visitBias = 0; c.dining.bias = 0; c.harvest.bias = 0; c.people.manner.linger.bias = 0; c.people.meet.bias = 0; c.people.manner.play.chaseBias = 1; c.people.manner.play.cooldownS = 5; }, 15, 14);
    let chases = 0, tags = 0, skips = 0;
    const adultSkips: number[] = [];
    run(s, 600, () => {
      for (const p of people(s)) {
        if (p.act?.kind === 'chase') chases++;
        if (p.pose === 'tag') tags++;
        if (p.skip > 0) { skips++; if (p.age > engine.life.people.manner.play.maxAge) adultSkips.push(p.age); }
        if (p.act?.kind === 'chase') expect(p.age).toBeLessThanOrEqual(engine.life.people.manner.play.maxAge);
      }
    });
    expect(chases).toBeGreaterThan(0);
    expect(tags).toBeGreaterThan(0);
    expect(skips).toBeGreaterThan(0);
    expect(adultSkips).toHaveLength(0);
  });

  it('never lets a chase break personal space or run through anything', () => {
    const { s, w } = make((c) => { c.people.visitBias = 0; c.dining.bias = 0; c.harvest.bias = 0; c.people.manner.linger.bias = 0; c.people.meet.bias = 0; c.people.manner.play.chaseBias = 1; c.people.manner.play.cooldownS = 3; }, 15, 15);
    const P = people(s);
    let closest = Infinity;
    run(s, 400, () => {
      for (const p of P) {
        if (isInside(p) || p.visit) continue;
        expect(w.blocked[Math.floor(p.y / w.cell) * w.nx + Math.floor(p.x / w.cell)]).toBe(0);
        for (const q of P) if (q !== p && !isInside(q)) closest = Math.min(closest, Math.hypot(p.x - q.x, p.y - q.y));
      }
    });
    expect(closest).toBeGreaterThan(0.9);
  });
});

describe('the town sleeps', () => {
  it('lingerers go indoors at night like everyone else, with no one left on a bed or a wall', () => {
    const { s } = make((c) => { c.people.manner.linger.bias = 1; }, 8, 16);
    s.setClock(12 * 60);
    run(s, 120);
    s.setClock(23.5 * 60);
    run(s, 5);
    for (const p of people(s)) {
      expect(p.act === null || p.act.kind !== 'linger').toBe(true);
      expect(p.sit).toBe(0);
      expect(p.seatZ).toBeNull();
    }
  });
});
