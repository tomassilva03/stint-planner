// Connects the planner to the iRacing helper running on this PC.
// Off until the user turns it on, so teammates who aren't driving never see a
// browser prompt about local network access.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Plan } from '../model';
import { trackLineFuel, type LineFuel } from '../strategy/estimator';
import { applyEvent } from './apply';
import { playDemo } from './demoSession';
import type { FieldSnapshot } from './field';
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
  /** Every car in the session, for the Race engineer tab */
  field: FieldSnapshot | null;
  /** The track's shape, once the helper knows it */
  outline: { track: string; points: number[] } | null;
  /** Fuel at the start of the current lap, for the estimator */
  lineFuel: LineFuel | null;
  /** The demo race playing in this browser, at this many times real speed (no helper needed) */
  demoSpeed: number | null;
  enable: () => void;
  disable: () => void;
  /** Plays the demo race in the browser; the helper link pauses until it stops */
  startDemo: (speed: number) => void;
  stopDemo: () => void;
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
  const [field, setField] = useState<FieldSnapshot | null>(null);
  const [outline, setOutline] = useState<Live['outline']>(null);
  const [lineFuel, setLineFuel] = useState<LineFuel | null>(null);
  // A new object restarts the demo, even at the same speed
  const [demo, setDemo] = useState<{ speed: number } | null>(null);
  const demoSpeed = demo?.speed ?? null;

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
      if (ev.kind === 'pitExit' || ev.kind === 'finish') setFilled((n) => n + 1);
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

  /** One message from the helper, or from the demo playing in the browser */
  const handle = useCallback(
    (m: HelperMessage) => {
      if (m.type === 'hello') setSource(m.source);
      else if (m.type === 'waiting') setStatus('waiting');
      else if (m.type === 'state') {
        setState(m.state);
        setLineFuel((prev) => trackLineFuel(prev, m.state));
        if (m.state.connected) setStatus('live');
      } else if (m.type === 'history') take(m.events);
      else if (m.type === 'event') take([m.event]);
      else if (m.type === 'field') setField(m.field);
      else if (m.type === 'outline') setOutline({ track: m.track, points: m.points });
    },
    [take],
  );

  // Starting a new race (or going back to the helper) forgets the last one's events and readings
  const clear = () => {
    eventsRef.current = [];
    setEvents([]);
    setFilled(0);
    setState(null);
    setField(null);
    setOutline(null);
    setLineFuel(null);
  };

  useEffect(() => {
    if (!demo) return;
    setStatus('connecting');
    const session = playDemo(demo.speed, handle);
    return () => session.stop();
  }, [demo, handle]);

  useEffect(() => {
    if (demo) return;
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
        handle(m);
      };
      ws.onclose = () => {
        if (closed) return;
        setStatus('connecting');
        setState(null);
        setField(null);
        timer = setTimeout(connect, RETRY_MS);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [on, handle, demo]);

  return {
    status,
    source,
    state,
    events,
    filled,
    field,
    outline,
    lineFuel,
    demoSpeed,
    enable: () => (writePref(true), setOn(true)),
    disable: () => (writePref(false), setOn(false), setDemo(null), clear()),
    startDemo: (speed) => (clear(), setDemo({ speed })),
    stopDemo: () => (setDemo(null), clear()),
  };
}
