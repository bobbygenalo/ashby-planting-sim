import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useApp } from '../store/store';
import { activeStructures } from '../engine/site';
import { placedPlants } from '../engine/growth';
import { buildPlayerWorld, createPlayer, dropIn, dropSpot, eyeZ, headingToward, look, stepPlayer, type PlayerState } from '../engine/player';
import { readInput, takeLook } from './walkInput';
import { viewPose } from './viewPose';

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

  // Entering from another view: drop in where that view was looking, facing the way it faced, falling from a little above the
  // ground onto the nearest open spot. With no view before it (a page opened straight into Walk), start at the street. This
  // rig is made afresh each time the Walk view opens, so it is worked out once, here.
  const state = useRef<PlayerState | null>(null);
  if (state.current === null) {
    const spot = viewPose.valid ? dropSpot(worldRef.current, viewPose.x, viewPose.y, cfg) : null;
    state.current = spot ? dropIn(spot[0], spot[1], viewPose.heading, cfg) : start;
  }

  const dir = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const { dx, dy } = takeLook();
    let s = state.current!;
    if (dx || dy) s = look(s, dx, dy, cfg);
    s = stepPlayer(s, readInput(), dt, worldRef.current, cfg);
    state.current = s;
    if (import.meta.env.DEV) (window as unknown as { __walk?: PlayerState }).__walk = s; // for inspecting the player from the console
    // Site (x, y, z) is three.js (x, z, -y). The eyes are above the feet; the view faces along the heading and pitch.
    camera.position.set(s.x, eyeZ(s, cfg), -s.y);
    const cp = Math.cos(s.pitch);
    dir.set(Math.sin(s.heading) * cp, Math.sin(s.pitch), -Math.cos(s.heading) * cp);
    camera.lookAt(camera.position.x + dir.x, camera.position.y + dir.y, camera.position.z + dir.z);
  });
  return null;
}
