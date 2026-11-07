import React, { useState } from 'react';
import { hourMs, monitoringUrl } from '../lib/monitoring.js';

function localInput(timestamp) {
  const date = new Date(timestamp);
  return new Date(timestamp - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function MonitoringTimeFilter({ windowType, fromTime, toTime }) {
  const [selection, setSelection] = useState(windowType);
  const [error, setError] = useState('');
  const now = Date.now();

  function submit(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const start = new Date(values.get('from') ?? ''), end = new Date(values.get('to') ?? '');
    const custom = selection === 'custom';
    if (custom && (!Number.isFinite(+start) || !Number.isFinite(+end) || start > end)) {
      setError('Choisis une date et une heure de fin au moins égales au début.');
      return;
    }
    window.location.assign(monitoringUrl('monitoring', {
      monitorWindow: selection === 'hour' ? null : selection,
      monitorFrom: custom ? start.toISOString() : null,
      monitorTo: custom ? end.toISOString() : null,
      sessionsOffset: null,
      requestsOffset: null,
    }));
  }

  return (
    <section className="card">
      <h2>Période du Monitoring</h2>
      <form className="monitor-time-filter" onSubmit={submit}>
        <label>Période
          <select value={selection} onChange={event => { setSelection(event.target.value); setError(''); }}>
            <option value="hour">Dernière heure</option>
            <option value="custom">Plage personnalisée</option>
            <option value="all">Tout l’historique</option>
          </select>
        </label>
        {selection === 'custom' && <>
          <label>Du (heure locale)<input name="from" type="datetime-local" required defaultValue={localInput(fromTime ? Date.parse(fromTime) : now - hourMs)}/></label>
          <label>Au (heure locale)<input name="to" type="datetime-local" required defaultValue={localInput(toTime ? Date.parse(toTime) : now)}/></label>
        </>}
        <button className="help-back" type="submit">Appliquer</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
