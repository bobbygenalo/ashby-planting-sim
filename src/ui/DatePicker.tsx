import { useEffect, useRef, useState } from 'react';
import { monthDayToDoy, monthName } from '../engine/time';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DAYS_IN_MONTH = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The weekday (0 Sunday) a month starts on. */
export const firstWeekday = (year: number, month: number): number => new Date(Date.UTC(year, month - 1, 1)).getUTCDay();

/** The weeks of a month as rows of seven cells: a day number, or null before the first and after the last. */
export function monthGrid(year: number, month: number): (number | null)[][] {
  const lead = firstWeekday(year, month);
  const n = DAYS_IN_MONTH(year, month);
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, r) => cells.slice(r * 7, r * 7 + 7));
}

/** The month before or after, wrapping the year (December is followed by January): the simulation runs on one calendar year. */
export const stepMonth = (month: number, by: number): number => ((month - 1 + by + 12) % 12) + 1;

/**
 * A calendar that pops up over the date: step between months with the arrows or jump with the month menu, and click a
 * day to go to it. Days with a birthday carry a dot. Esc or a click elsewhere closes it.
 */
export function DatePicker({ month, day, year, birthdays, onPick, onClose }: {
  month: number;
  day: number;
  year: number;
  /** The days of the year that are someone's birthday, as "month-day" keys with the names to show. */
  birthdays: Map<string, string>;
  onPick: (month: number, day: number) => void;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(month);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', key, true);
    };
  }, [onClose]);
  const weeks = monthGrid(year, shown);
  return (
    <div className="datepicker" ref={box} role="dialog" aria-label="Choose a date">
      <div className="dp-head">
        <button className="icon" aria-label="Previous month" onClick={() => setShown(stepMonth(shown, -1))}>‹</button>
        <select aria-label="Month" value={shown} onChange={(e) => setShown(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{monthName(i + 1)}</option>)}
        </select>
        <button className="icon" aria-label="Next month" onClick={() => setShown(stepMonth(shown, 1))}>›</button>
      </div>
      <div className="dp-grid" role="grid">
        {WEEKDAYS.map((w) => <span key={w} className="dp-wd">{w}</span>)}
        {weeks.flat().map((d, i) => {
          if (d === null) return <span key={i} />;
          const names = birthdays.get(`${shown}-${d}`);
          const selected = shown === month && d === day;
          return (
            <button
              key={i} className={`dp-day ${selected ? 'on' : ''} ${names ? 'bday' : ''}`} aria-pressed={selected}
              title={names ? `Birthday: ${names}` : undefined} aria-label={`${monthName(shown)} ${d}${names ? `, birthday: ${names}` : ''}`}
              onClick={() => { onPick(shown, d); onClose(); }}
            >{d}</button>
          );
        })}
      </div>
      <div className="dp-foot muted small">Day {monthDayToDoy(shown, 1)} to {monthDayToDoy(shown, DAYS_IN_MONTH(year, shown))} of the year{[...birthdays.keys()].some((k) => k.startsWith(`${shown}-`)) ? ' · dots are birthdays' : ''}</div>
    </div>
  );
}
