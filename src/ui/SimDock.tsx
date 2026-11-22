import { useEffect, useRef, useState } from 'react';
import { solarPosition } from '../engine/solar';
import { doyToMonthDay, localToUtc, monthDayToDoy, monthName, tzAbbrev } from '../engine/time';
import { useApp } from '../store/store';

export function fmtTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

/**
 * One slim dock for both simulations: plant growth over the years, and the sun over a day and a season.
 * Each half has a play button, a slider and a one-line readout; presets live in menus.
 */
export function SimDock() {
  const s = useApp((x) => x);
  const [open, setOpen] = useState(true);
  const dayAcc = useRef(s.doy);
  const maxM = s.engine.timeline.maxYears * 12;
  const years = s.timelineMonth / 12;
  const [month, day] = doyToMonthDay(s.doy);
  const utc = localToUtc(s.site.timeZone, s.engine.referenceYear, month, day, 0, s.minutes);
  const sun = solarPosition(utc, s.site.latitude, s.site.longitude, s.engine.sun.refraction);
  const growthLabel = years === 0 ? 'Today' : `Year ${Number.isInteger(years) ? years : years.toFixed(1)}`;
  const sunLabel = `${monthName(month)} ${day}, ${fmtTime(s.minutes)}`;

  useEffect(() => {
    if (!s.timelinePlaying) return;
    const id = setInterval(() => {
      // At the end of the timeline, play wraps back to the start and keeps going; the calendar carries on unbroken.
      const next = s.timelineMonth + 1 > maxM ? 0 : s.timelineMonth + 1;
      s.setTimelineMonth(next);
      // The calendar turns with the growth, so the seasons change in the yard: leaves, fruit and the raised beds.
      if (Math.round(dayAcc.current) !== s.doy) dayAcc.current = s.doy; // the date was moved by hand
      dayAcc.current = ((dayAcc.current - 1 + s.engine.timeline.daysPerStep) % 365) + 1;
      s.setDoy(Math.round(dayAcc.current));
    }, 90);
    return () => clearInterval(id);
  });
  useEffect(() => {
    if (!s.playing) return;
    const id = setInterval(() => {
      const m = s.minutes + 6;
      s.setMinutes(m > 1320 ? 240 : m);
    }, 50);
    return () => clearInterval(id);
  });

  if (!open) {
    return (
      <div className="simdock collapsed">
        <button onClick={() => setOpen(true)} aria-label="Show growth and sun controls">▴ {growthLabel} · {sunLabel}</button>
      </div>
    );
  }
  const presetDoy = s.engine.sun.presets.find((p) => monthDayToDoy(p.month, p.day) === s.doy);
  return (
    <div className="simdock">
      <div className="sim-half">
        <button className="icon" aria-label={s.timelinePlaying ? 'Stop growth' : 'Play growth'} title="Grow the plants; the calendar moves with them, so the seasons change" onClick={() => s.setTimelinePlaying(!s.timelinePlaying)}>{s.timelinePlaying ? '■' : '▶'}</button>
        <span className="sim-title">Growth</span>
        <output className="readout" title="Plants shown at this point in the timeline">{growthLabel}</output>
        <input type="range" aria-label="Years from today" min={0} max={maxM} value={s.timelineMonth} onChange={(e) => s.setTimelineMonth(Number(e.target.value))} />
        <select aria-label="Jump to a year" value="" onChange={(e) => e.target.value !== '' && s.setTimelineMonth(Number(e.target.value) * 12)}>
          <option value="">Jump…</option>
          <option value={0}>Today</option>
          {s.engine.timeline.presets.map((y) => <option key={y} value={y}>Year {y}</option>)}
        </select>
      </div>
      <div className="sim-half">
        <button className="icon" aria-label={s.playing ? 'Stop the day' : 'Play the day'} title="Play the day" onClick={() => s.setPlaying(!s.playing)}>{s.playing ? '■' : '▶'}</button>
        <span className="sim-title">Sun</span>
        <output className="readout" title={`Sun azimuth ${sun.azimuthDeg.toFixed(1)}°, elevation ${sun.elevationDeg.toFixed(1)}°${sun.elevationDeg <= 0 ? ' (below horizon)' : ''}. ${tzAbbrev(s.site.timeZone, utc)}`}>{sunLabel}</output>
        <input type="range" aria-label="Date" min={1} max={365} value={s.doy} onChange={(e) => s.setDoy(Number(e.target.value))} />
        <input type="range" aria-label="Time of day" min={0} max={1439} step={5} value={s.minutes} onChange={(e) => s.setMinutes(Number(e.target.value))} />
        <select aria-label="Jump to a date" value={presetDoy?.id ?? ''} onChange={(e) => { const p = s.engine.sun.presets.find((x) => x.id === e.target.value); if (p) s.setDoy(monthDayToDoy(p.month, p.day)); }}>
          <option value="" disabled>Season…</option>
          {s.engine.sun.presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
      <button className="icon" aria-label="Hide growth and sun controls" title="Hide" onClick={() => setOpen(false)}>▾</button>
    </div>
  );
}
