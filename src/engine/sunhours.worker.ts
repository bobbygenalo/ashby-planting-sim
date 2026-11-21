import { computeSunHours, type SunPeriod } from './sunhours';
import type { SunScene } from './site';
import type { EngineConfig } from './types';

export interface SunRequest {
  id: number;
  scene: SunScene;
  period: SunPeriod;
  year: number;
  config: EngineConfig['sun'];
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<SunRequest>) => void) | null;
  postMessage: (m: unknown, transfer?: Transferable[]) => void;
};

ctx.onmessage = (e) => {
  const { id, scene, period, year, config } = e.data;
  const result = computeSunHours(scene, { period, year, config });
  ctx.postMessage({ id, result }, [result.hours.buffer, result.mask.buffer, result.zone.buffer]);
};
