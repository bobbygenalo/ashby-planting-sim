import { useEffect, useMemo, useRef, useState } from 'react';
import { buildSunScene } from '../engine/site';
import type { SunHoursResult, SunPeriod } from '../engine/sunhours';
import { doyToMonthDay } from '../engine/time';
import { useApp } from './store';
import type { SunRequest } from '../engine/sunhours.worker';

/** Runs the sun-hours computation in a web worker and returns the latest result. */
export function useSunHours() {
  const site = useApp((s) => s.site);
  const engine = useApp((s) => s.engine);
  const aduEnabled = useApp((s) => s.aduEnabled);
  const doy = useApp((s) => s.doy);
  const sunPeriod = useApp((s) => s.sunPeriod);
  const [result, setResult] = useState<SunHoursResult | null>(null);
  const [busyMs, setBusyMs] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const started = useRef(0);

  const scene = useMemo(() => buildSunScene(site, { aduEnabled }, engine), [site, aduEnabled, engine]);

  const period: SunPeriod = useMemo(() => {
    if (sunPeriod === 'day') {
      const [month, day] = doyToMonthDay(doy);
      return { kind: 'day', month, day };
    }
    const season = engine.sun.seasons.find((x) => x.id === sunPeriod) ?? engine.sun.seasons[0];
    return { kind: 'range', from: season.from, to: season.to };
  }, [sunPeriod, doy, engine]);

  useEffect(() => {
    const w = new Worker(new URL('../engine/sunhours.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (e: MessageEvent<{ id: number; result: SunHoursResult }>) => {
      if (e.data.id !== seq.current) return;
      setResult(e.data.result);
      setBusyMs(performance.now() - started.current);
      setPending(false);
    };
    return () => w.terminate();
  }, []);

  useEffect(() => {
    const id = ++seq.current;
    setPending(true);
    const t = setTimeout(() => {
      started.current = performance.now();
      const req: SunRequest = { id, scene, period, year: engine.referenceYear, config: engine.sun };
      worker.current?.postMessage(req);
    }, 120);
    return () => clearTimeout(t);
  }, [scene, period, engine]);

  return { result, pending, computeMs: busyMs, scene };
}
