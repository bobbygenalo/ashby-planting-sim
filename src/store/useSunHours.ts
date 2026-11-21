import { useEffect, useMemo, useRef, useState } from 'react';
import { placedPlants, plantSolid } from '../engine/growth';
import { buildSunScene, type SunScene } from '../engine/site';
import type { SunHoursResult, SunPeriod } from '../engine/sunhours';
import { doyToMonthDay } from '../engine/time';
import type { EngineConfig } from '../engine/types';
import { useApp } from './store';
import type { SunRequest } from '../engine/sunhours.worker';

interface Run {
  result: SunHoursResult | null;
  pending: boolean;
  computeMs: number | null;
}

/** One worker-backed sun-hours run that recomputes when the scene or period changes. */
function useSunRun(scene: SunScene, period: SunPeriod, year: number, config: EngineConfig["sun"]): Run {
  const [state, setState] = useState<Run>({ result: null, pending: true, computeMs: null });
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const started = useRef(0);

  useEffect(() => {
    const w = new Worker(new URL('../engine/sunhours.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (e: MessageEvent<{ id: number; result: SunHoursResult }>) => {
      if (e.data.id !== seq.current) return;
      setState({ result: e.data.result, pending: false, computeMs: performance.now() - started.current });
    };
    return () => w.terminate();
  }, []);

  useEffect(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, pending: true }));
    const t = setTimeout(() => {
      started.current = performance.now();
      const req: SunRequest = { id, scene, period, year, config };
      worker.current?.postMessage(req);
    }, 150);
    return () => clearTimeout(t);
  }, [scene, period, year, config]);

  return state;
}

/**
 * Sun hours for the displayed period, plus a growing-season run used to compare each plant's
 * light need with its location (SUN-6). Plants cast shadows at their size on the timeline (SUN-7).
 */
export function useSunHours() {
  const site = useApp((s) => s.site);
  const engine = useApp((s) => s.engine);
  const aduEnabled = useApp((s) => s.aduEnabled);
  const doy = useApp((s) => s.doy);
  const sunPeriod = useApp((s) => s.sunPeriod);
  const instances = useApp((s) => s.instances);
  const palette = useApp((s) => s.palette);
  const library = useApp((s) => s.library);
  const month = useApp((s) => s.timelineMonth);

  const scene = useMemo(() => {
    const solids = placedPlants(instances, palette, library.species, month, engine.growth).flatMap((p) => {
      const s = plantSolid(p.inst, p.species, p.size, engine.growth, engine.scene.treeCanopyRings);
      return s ? [s] : [];
    });
    return buildSunScene(site, { aduEnabled }, engine, solids);
  }, [site, aduEnabled, engine, instances, palette, library, month]);

  const period: SunPeriod = useMemo(() => {
    if (sunPeriod === 'day') {
      const [m, d] = doyToMonthDay(doy);
      return { kind: 'day', month: m, day: d };
    }
    const season = engine.sun.seasons.find((x) => x.id === sunPeriod) ?? engine.sun.seasons[0];
    return { kind: 'range', from: season.from, to: season.to };
  }, [sunPeriod, doy, engine]);

  const growingPeriod: SunPeriod = useMemo(() => {
    const g = engine.sun.seasons.find((x) => x.id === 'growing')!;
    return { kind: 'range', from: g.from, to: g.to };
  }, [engine]);

  // The fit check uses site shade only, so a plant is not judged by its own canopy shadow.
  const siteScene = useMemo(() => buildSunScene(site, { aduEnabled }, engine), [site, aduEnabled, engine]);
  const display = useSunRun(scene, period, engine.referenceYear, engine.sun);
  const growing = useSunRun(siteScene, growingPeriod, engine.referenceYear, engine.sun);

  return { result: display.result, pending: display.pending, computeMs: display.computeMs, growing: growing.result, scene };
}
