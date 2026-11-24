import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store/store';
import { quickItems, searchQuick } from '../engine/quickfind';

/**
 * Quick find, at the top of the right panel: type to search plants and hardscape, Up and Down move through the results, Enter
 * puts the highlighted one in hand to place (a plant is clicked into the yard, hardscape is placed or drawn), and Escape
 * closes the box. Once something is in hand, Escape drops it.
 */
export function QuickFind() {
  const open = useApp((s) => s.quickFindOpen);
  const setOpen = useApp((s) => s.setQuickFind);
  const choose = useApp((s) => s.chooseQuick);
  const library = useApp((s) => s.library);
  const palette = useApp((s) => s.palette);
  const hs = useApp((s) => s.engine.hardscape);
  const placed = useApp((s) => s.instances);
  const items = useMemo(() => quickItems(library.species, palette, hs), [library, palette, hs]);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const results = useMemo(() => searchQuick(items, query), [items, query]);
  const list = useRef<HTMLUListElement>(null);
  const field = useRef<HTMLInputElement>(null);

  // Take the keyboard whenever the box opens, even if the page had not yet given focus to anything.
  useEffect(() => { if (open) { setQuery(''); setIndex(0); field.current?.focus(); } }, [open]);
  useEffect(() => { setIndex(0); }, [query]);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [index, results]);
  if (!open) return null;

  const count = (speciesId?: string) => (speciesId ? placed.filter((i) => i.speciesId === speciesId).length : 0);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => (results.length ? (i + 1) % results.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => (results.length ? (i + results.length - 1) % results.length : 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = results[index]; if (r) choose(r); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
  };
  return (
    <div className="quickfind" role="search" aria-label="Find something to place">
      <input
        ref={field} autoFocus value={query} placeholder="Find a plant or hardscape to place…" aria-label="Search plants and hardscape"
        role="combobox" aria-expanded="true" aria-controls="quickfind-list" aria-activedescendant={results[index] ? `qf-${results[index].id}` : undefined}
        onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown} onBlur={() => setOpen(false)}
      />
      <ul id="quickfind-list" role="listbox" ref={list} onMouseDown={(e) => e.preventDefault()}>
        {results.length === 0 && <li className="none">Nothing matches "{query}".</li>}
        {results.map((r, n) => (
          <li key={r.id} id={`qf-${r.id}`} role="option" aria-selected={n === index} className={n === index ? 'on' : ''} onMouseMove={() => n !== index && setIndex(n)} onClick={() => choose(r)}>
            <span className="qf-name">{r.starred && <span className="qf-star" aria-label="starred">★</span>}{r.label}</span>
            <span className="qf-sub">{r.sub}{count(r.speciesId) > 0 && ` · ${count(r.speciesId)} placed`}</span>
          </li>
        ))}
      </ul>
      <div className="qf-hint"><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Enter</kbd> place · <kbd>Esc</kbd> close (and drops what you are placing)</div>
    </div>
  );
}
