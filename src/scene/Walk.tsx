import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useApp } from '../store/store';
import { activeStructures } from '../engine/site';
import { placedPlants } from '../engine/growth';
import { buildPlayerWorld, createPlayer, headingToward, look, playerFits, stepPlayer, type PlayerState } from '../engine/player';
import { readInput, takeLook } from './walkInput';

/** Where the player was when they left the Walk view, so coming back resumes there. */
let last: PlayerState | null = null;

/** The first-person camera and the player's movement, inside the Canvas. Mounted only in the Walk view. */
export function WalkRig({ viewId }: { viewId: string }) {
  const site = useApp((s) => s.site);
  const engine = useApp((s) => s.engine);
  const aduEnabled = useApp((s) => s.aduEnabled);
  const hardscape = useApp((s) => s.hardscape);
  const materials = useApp((s) => s.materials);
  const instances = useApp((s) => s.instances);
  const palette = useApp((s) => s.palette);
  const library = useApp((s) => s.library);
  const month = useApp((s) => s.timelineMonth);
  const hive = useApp((s) => s.hive);
  const camera = useThree((t) => t.camera);
  const cfg = engine.player;

  const plants = useMemo(() => placedPlants(instances, palette, library.species, month, engine.growth), [instances, palette, library, month, engine]);
  const world = useMemo(
    () => buildPlayerWorld({ site, structures: activeStructures(site, { aduEnabled }), hardscape, materials, plants, hive: hive ? { x: hive[0], y: hive[1] } : null, engine }),
    [site, aduEnabled, hardscape, materials, plants, hive, engine],
  );
  const worldRef = useRef(world);
  worldRef.current = world;

  const start = useMemo(() => {
    const v = site.views.find((x) => x.id === viewId);
    const p = v?.position ?? [site.lot.width / 2, 14, 0];
    const t = v?.target ?? [p[0], p[1] + 10, 0];
    return createPlayer(p[0], p[1], headingToward([p[0], p[1]], [t[0], t[1]]));
  }, [site, viewId]);

  const state = useRef<PlayerState>(start);
  useEffect(() => {
    // Resume where the player left off, unless a change to the plan put them inside something.
    const resume = last && playerFits(worldRef.current, last.x, last.y, last.z, last.onGround, cfg) ? last : start;
    state.current = { ...resume, vx: 0, vy: 0, vz: 0 };
    return () => { last = state.current; };
  }, [start, cfg]);

  const dir = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const { dx, dy } = takeLook();
    let s = state.current;
    if (dx || dy) s = look(s, dx, dy, cfg);
    s = stepPlayer(s, readInput(), dt, worldRef.current, cfg);
    state.current = s;
    // Site (x, y, z) is three.js (x, z, -y). The eyes are above the feet; the view faces along the heading and pitch.
    camera.position.set(s.x, s.z + cfg.eyeHeightFt, -s.y);
    const cp = Math.cos(s.pitch);
    dir.set(Math.sin(s.heading) * cp, Math.sin(s.pitch), -Math.cos(s.heading) * cp);
    camera.lookAt(camera.position.x + dir.x, camera.position.y + dir.y, camera.position.z + dir.z);
  });
  return null;
}
