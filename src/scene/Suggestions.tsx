import { useMemo } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { usePlaced } from '../store/derived';
import { useApp } from '../store/store';
import { useOverlayBase } from './overlay';

// One hue, light to dark: a higher score is a darker green. Excluded cells are gray.
const LOW: [number, number, number] = [232, 245, 224];
const HIGH: [number, number, number] = [11, 107, 46];

/** Heatmap of placement scores over the lot, the numbered top spots, and the focused spot's mature width. */
export function SuggestionLayer() {
  const suggestion = useApp((s) => s.suggestion);
  const show = useApp((s) => s.layers.suggestions);
  const focus = useApp((s) => s.suggestFocus);
  const setFocus = useApp((s) => s.setSuggestFocus);
  const library = useApp((s) => s.library);

  const texture = useMemo(() => {
    if (!suggestion) return null;
    const { nx, ny, total, excluded } = suggestion.result.grid;
    const data = new Uint8Array(nx * ny * 4);
    for (let k = 0; k < total.length; k++) {
      const v = total[k];
      if (Number.isNaN(v)) continue;
      if (excluded[k]) {
        data.set([120, 120, 120, 70], k * 4);
      } else {
        data.set([0, 1, 2].map((i) => Math.round(LOW[i] + (HIGH[i] - LOW[i]) * v)).concat(185), k * 4);
      }
    }
    const tex = new THREE.DataTexture(data, nx, ny, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  }, [suggestion]);

  const base = useOverlayBase();
  if (!suggestion || !show || !texture) return null;
  const { grid, top } = suggestion.result;
  const species = library.species.find((s) => s.id === suggestion.speciesId);
  const w = grid.nx * grid.cell, h = grid.ny * grid.cell;
  return (
    <group>
      <mesh position={[w / 2, h / 2, base + 0.02]} renderOrder={3}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={texture} transparent depthWrite={false} />
      </mesh>
      {top.map((c, i) => (
        <Html key={`${c.x},${c.y}`} position={[c.x, c.y, 0.8]} center zIndexRange={[20, 0]}>
          <button className={`spot ${focus === i ? 'on' : ''}`} onClick={() => setFocus(i)} aria-label={`Spot ${i + 1}, score ${Math.round(c.total * 100)}`}>
            {i + 1}
          </button>
        </Html>
      ))}
      {focus !== null && top[focus] && species && (
        <mesh position={[top[focus].x, top[focus].y, 0.2]} renderOrder={5}>
          <ringGeometry args={[Math.max(species.matureWidth / 2 - 0.15, 0.05), species.matureWidth / 2, 48]} />
          <meshBasicMaterial color="#0b6b2e" transparent opacity={0.9} depthTest={false} />
        </mesh>
      )}
    </group>
  );
}

/** Rings on plants that have a conflict: red when it exists at the timeline year, amber when it comes later. */
export function ConflictRings() {
  const conflicts = useApp((s) => s.conflicts);
  const show = useApp((s) => s.layers.conflicts);
  const month = useApp((s) => s.timelineMonth);
  const plants = usePlaced();
  if (!show || conflicts.length === 0) return null;
  const state = new Map<string, 'now' | 'later'>();
  for (const c of conflicts) {
    for (const id of c.instanceIds) {
      if (c.firstMonth <= month) state.set(id, 'now');
      else if (!state.has(id)) state.set(id, 'later');
    }
  }
  return (
    <group>
      {plants.map((p) => {
        const st = state.get(p.inst.id);
        if (!st) return null;
        const r = Math.max(p.size.width / 2, 0.8) + 0.7;
        return (
          <mesh key={p.inst.id} position={[p.inst.position[0], p.inst.position[1], 0.18]} renderOrder={4}>
            <ringGeometry args={[r - 0.6, r, 40]} />
            <meshBasicMaterial color={st === 'now' ? '#dc2626' : '#f59e0b'} transparent opacity={0.95} depthTest={false} />
          </mesh>
        );
      })}
    </group>
  );
}
