import type { EngineConfig, HardscapeType, Species } from './types';

/** One thing the quick-find box can put in the yard: a plant, or a kind of hardscape (a raised bed comes once per shape). */
export interface QuickItem {
  id: string;
  kind: 'plant' | 'hardscape';
  /** What the list shows, and what is searched. */
  label: string;
  /** A smaller line under it: the botanical name, or a word on what it is. */
  sub: string;
  speciesId?: string;
  hardscape?: { type: HardscapeType; shape?: string };
  /** More words that find it: type, light, water, "native". */
  keywords: string;
  starred?: boolean;
}

/** Every plant in the library and every drawable hardscape type, as one list. */
export function quickItems(species: Species[], palette: Record<string, boolean>, hs: EngineConfig['hardscape']): QuickItem[] {
  const out: QuickItem[] = [];
  const drawable = (Object.keys(hs.types) as HardscapeType[]).filter((t) => !hs.notDrawable?.includes(t));
  for (const t of drawable) {
    if (t === 'raisedBed') {
      for (const sh of hs.raisedBedModule.shapes) {
        out.push({ id: `hs:raisedBed:${sh.id}`, kind: 'hardscape', label: `Raised bed ${sh.label}`, sub: 'Hardscape', hardscape: { type: t, shape: sh.id }, keywords: 'raised bed planter box garden bed hardscape' });
      }
    } else {
      out.push({ id: `hs:${t}`, kind: 'hardscape', label: hs.types[t].label, sub: 'Hardscape', hardscape: { type: t }, keywords: `${t} hardscape` });
    }
  }
  for (const s of species) {
    out.push({
      id: `plant:${s.id}`, kind: 'plant', label: s.common, sub: s.botanical, speciesId: s.id, starred: !!palette[s.id],
      keywords: `${s.type} ${s.sun} sun ${s.wucols} water ${s.origin} ${s.evergreen ? 'evergreen' : 'deciduous'} plant`,
    });
  }
  return out;
}

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[×x]/g, (c) => (c === '×' ? 'x' : c));

/**
 * Rank items against a typed query. Every word must be found somewhere (name, botanical name or keywords); a name with the whole
 * word beats one that starts with it, which beats one where a word inside it starts with it, which beats a match further in. An empty query
 * lists the starred plants and the hardscape first. Stable, so the same query always gives the same order.
 */
export function searchQuick(items: QuickItem[], query: string, limit = 40): QuickItem[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    const first = items.filter((i) => i.kind === 'hardscape' || i.starred);
    return (first.length ? first : items).slice(0, limit);
  }
  const scored: { item: QuickItem; score: number; at: number }[] = [];
  items.forEach((item, at) => {
    const name = norm(item.label), botanical = norm(item.sub), extra = norm(item.keywords);
    let total = 0;
    for (const w of words) {
      let s = 0;
      const parts = name.split(/[\s\-()]+/);
      if (parts.includes(w)) s = 7; // the whole word: "rose" finds the roses before rosemary
      else if (name.startsWith(w)) s = 6;
      else if (parts.some((p) => p.startsWith(w))) s = 5;
      else if (name.includes(w)) s = 3;
      else if (botanical.split(/\s+/).some((p) => p.startsWith(w))) s = 2.5;
      else if (botanical.includes(w)) s = 1.5;
      else if (extra.split(/\s+/).some((p) => p.startsWith(w))) s = 1;
      else return;
      total += s;
    }
    scored.push({ item, score: total + (item.starred ? 0.4 : 0), at });
  });
  return scored.sort((a, b) => b.score - a.score || a.at - b.at).slice(0, limit).map((s) => s.item);
}
