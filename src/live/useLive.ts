// Connects the planner to the iRacing helper running on this PC.
// Off until the user turns it on, so teammates who aren't driving never see a
// browser prompt about local network access.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Plan } from '../model';
import { applyEvent } from './apply';
import { LIVE_PORT, type HelperMessage, type LiveEvent, type LiveState } from './protocol';

const KEY = 'stint-planner.live';
const RETRY_MS = 3000;

export type LinkStatus = 'off' | 'connecting' | 'waiting' | 'live';

export interface Live {
  status: LinkStatus;
  source: 'iracing' | 'demo' | null;
  state: LiveState | null;
  /** Race events so far (up to the last 200), newest last */
  events: LiveEvent[];
  /** Stints filled in from the helper during this page visit */
  filled: number;
  enable: () => void;
  disable: () => void;
}

const readPref = () => {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return saved === 'on';
    // The desktop app opens the planner with ?live, so drivers are connected without a click
    if (new URLSearchParams(location.search).has('live')) {
      localStorage.setItem(KEY, 'on');
      return true;
    }
    return false;
  } catch {
    return false;
  }
};
const writePref = (on: boolean) => {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: just don't remember */
  }
};

export function useLive(plan: Plan, update: (fn: (p: Plan) => Plan) => void, readOnly: boolean): Live {
  const [on, setOn] = useState(readPref);
  const [status, setStatus] = useState<LinkStatus>('off');
  const [source, setSource] = useState<Live['source']>(null);
  const [state, setState] = useState<LiveState | null>(null);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [filled, setFilled] = useState(0);

  // Latest values for the socket callbacks, without reconnecting on every edit
  const planRef = useRef(plan);
  const updateRef = useRef(update);
  const readOnlyRef = useRef(readOnly);
  planRef.current = plan;
  updateRef.current = update;
  readOnlyRef.current = readOnly;

  const eventsRef = useRef<LiveEvent[]>([]);

  const fill = useCallback((list: LiveEvent[]) => {
    if (readOnlyRef.current) return;
    for (const ev of list) {
      const next = applyEvent(planRef.current, ev);
      if (!next) continue;
      updateRef.current((p) => applyEvent(p, ev) ?? p);
      if (ev.kind === 'pitExit') setFilled((n) => n + 1);
      planRef.current = next;
    }
  }, []);

  const take = useCallback(
    (list: LiveEvent[]) => {
      const seen = new Set(eventsRef.current.map((e) => e.id));
      eventsRef.current = [...eventsRef.current, ...list.filter((e) => !seen.has(e.id))].slice(-200);
      setEvents(eventsRef.current);
      fill(list);
    },
    [fill],
  );

  // Switching to another plan (say, the demo plan mid-demo) catches it up on stops already seen
  useEffect(() => fill(eventsRef.current), [plan.id, fill]);

  useEffect(() => {
    if (!on) {
      setStatus('off');
      return;
    }
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const connect = () => {
      setStatus('connecting');
      ws = new WebSocket(`ws://localhost:${LIVE_PORT}`);
      ws.onmessage = (e) => {
        let m: HelperMessage;
        try {
          m = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (m.type === 'hello') setSource(m.source);
        else if (m.type === 'waiting') setStatus('waiting');
        else if (m.type === 'state') {
          setState(m.state);
          if (m.state.connected) setStatus('live');
        } else if (m.type === 'history') take(m.events);
        else if (m.type === 'event') take([m.event]);
      };
      ws.onclose = () => {
        if (closed) return;
        setStatus('connecting');
        setState(null);
        timer = setTimeout(connect, RETRY_MS);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [on, take]);

  return {
    status,
    source,
    state,
    events,
    filled,
    enable: () => (writePref(true), setOn(true)),
    disable: () => (writePref(false), setOn(false), setState(null)),
  };
}
