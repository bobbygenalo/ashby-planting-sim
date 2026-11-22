import type { LitterCfg, Species } from './types';

export interface LitterState {
  /** falling = leaves in the air and landing; lying = a bare tree on its litter; composting = the new leaves are out and the old ones rot into the soil. */
  phase: 'none' | 'falling' | 'lying' | 'composting';
  /** How much litter lies on the ground, 0 to 1. */
  amount: number;
  /** How far the litter has rotted, 0 (fresh) to 1 (soil). */
  decay: number;
}

const NONE: LitterState = { phase: 'none', amount: 0, decay: 0 };
const prev = (m: number) => ((m + 10) % 12) + 1;

/** Deciduous plants shed their leaves; evergreens and plants without a leaf-off season do not. */
export const sheds = (sp: Species) => !sp.evergreen && sp.leafOffMonths.length > 0;

/**
 * What lies under a deciduous plant in a calendar month: leaves coming down in the first leaf-off month or so, a
 * carpet of them while the tree is bare, and then, once the new leaves are out, litter that darkens, thins and rots
 * into the soil over the next few months.
 */
export function litterState(sp: Species, month: number, cfg: LitterCfg): LitterState {
  if (!sheds(sp)) return NONE;
  const off = new Set(sp.leafOffMonths);
  if (off.has(month)) {
    // Months since this stretch of leaf-off began.
    let k = 0;
    for (let m = month; off.has(prev(m)) && k < 12; m = prev(m)) k++;
    return k < cfg.fallMonths ? { phase: 'falling', amount: cfg.fallAmount, decay: 0 } : { phase: 'lying', amount: 1, decay: 0 };
  }
  // Months since the leaves came back: walk back to the nearest leaf-off month.
  let m = month;
  for (let since = 1; since <= cfg.decayMonths; since++) {
    m = prev(m);
    if (off.has(m)) {
      const decay = since / (cfg.decayMonths + 1);
      return { phase: 'composting', amount: 1 - decay, decay };
    }
  }
  return NONE;
}
