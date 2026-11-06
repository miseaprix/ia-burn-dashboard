import {apiFetch} from '../lib/api.js';
import { useState, useEffect, useRef, useCallback } from 'react';
import { refreshDelay, refreshOnReturn } from '../lib/refresh-policy.js';

export default function useDashboard({source, range, from, to}) {
  const selection = JSON.stringify([source, range, range === 'custom' ? from : null, range === 'custom' ? to : null]);
  const [state, setState] = useState({selection: null, data: null, error: null, loading: true});
  const refreshRef = useRef(null);
  useEffect(() => {
    let active = true, inFlight = false, timer, controller, latest;
    const schedule = (failed = false) => {
      clearTimeout(timer);
      if (!active || document.hidden) return;
      const delay = failed || !latest ? 60000 : refreshDelay(latest.refresh);
      if (Number.isFinite(delay)) timer = setTimeout(load, delay);
    };
    async function load() {
      if (!active || inFlight) return;
      inFlight = true;
      clearTimeout(timer);
      controller = new AbortController();
      setState(s => ({...s, selection, loading: true}));
      let failed = false;
      try {
        const query = new URLSearchParams({source, range});
        if (range === 'custom') {query.set('from', from); query.set('to', to);}
        const response = await apiFetch(`/api/dashboard?${query}`, {signal: controller.signal});
        const json = await response.json();
        if (!active) return;
        if (!response.ok || json.error) throw new Error(json.error?.message || 'Metrics are unavailable');
        latest = json;
        setState({selection, data:json, error:null, loading:false});
      } catch (error) {
        if (!active || error.name === 'AbortError') return;
        failed = true;
        setState(s => ({selection, data:s.selection === selection ? s.data : null,
          error:error.message || 'Network error', loading:false}));
      } finally {
        inFlight = false;
        if (active) schedule(failed);
      }
    }
    const visibility = () => {
      if (document.hidden) clearTimeout(timer);
      else if (refreshOnReturn(latest?.refresh)) load();
      else schedule();
    };
    // A new selection cannot show metrics from the prior source or dates.
    setState({selection, data:null, error:null, loading:true});
    refreshRef.current = load;
    document.addEventListener('visibilitychange', visibility);
    load();
    return () => {
      active = false;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [selection, source, range, from, to]);
  const refresh = useCallback(() => refreshRef.current?.(), []);
  return {...(state.selection === selection ? state : {data:null,error:null,loading:true}), refresh};
}
