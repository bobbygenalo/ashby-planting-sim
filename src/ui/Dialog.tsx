import { useEffect, useRef, type ReactNode } from 'react';

/** A modal over the whole app. Esc and a click on the backdrop close it; focus moves inside while it is open. */
export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // Whoever opened the dialog may pass a new onClose on every render; the latest is kept in a ref so the effect below
  // runs once, when the dialog opens. Re-running it would move focus back to the dialog and close any open dropdown in it.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closeRef.current(); }}>
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="icon" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}
