// What the Race engineer tab shows, and how it reaches teammates who aren't driving.
// The page on the PC running the helper turns the helper's data into a small feed and
// shares it on the private Realtime channel "live:<plan id>" (see supabase/schema.sql);
// every page open on the same cloud plan listens there. The local helper always wins.
import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { cloud } from '../cloud';
import type { FieldSnapshot } from '../live/field';
import type { LiveEvent, LiveState } from '../live/protocol';
import type { Live } from '../live/useLive';

export interface LapRecord {
  lap: number;
  time: number | null;
  fuel: number | null;
  green: boolean;
}

/** Our car's race so far, worked out from the helper's events */
export interface TeamSummary {
  /** Stops in the box (drive-throughs not counted) */
  stops: number;
  /** Laps completed when the car last left the pits */
  lastStopLap: number | null;
  /** Seconds from pit entry to pit exit, last stop */
  lastStopSec: number | null;
  /** Latest laps, newest last */
  laps: LapRecord[];
}

export interface EngineerFeed {
  v: 1;
  /** Which page sent it, so two PCs sharing at once don't flicker */
  from: string;
  /** Wall clock when it was sent, ms */
  sentAt: number;
  source: 'iracing' | 'demo' | null;
  state: LiveState | null;
  field: FieldSnapshot | null;
  team: TeamSummary;
  /** The track's shape: sent now and then rather than every second */
  outline?: { track: string; points: number[] };
}

const RECENT_LAPS = 8;
/** How often the feed is shared */
const SEND_MS = 1000;
/** The track shape rides along every this many feeds */
const OUTLINE_EVERY = 10;
/** A feed older than this is no longer live */
export const STALE_MS = 15_000;

export function summarise(events: LiveEvent[]): TeamSummary {
  const stops = events.filter((e) => e.kind === 'pitExit' && e.stopped);
  const last = stops[stops.length - 1];
  const laps: LapRecord[] = [];
  for (const e of events)
    if (e.kind === 'lap') laps.push({ lap: e.lapsCompleted, time: e.lapTime, fuel: e.fuelUsed, green: e.green });
  return {
    stops: stops.length,
    lastStopLap: last?.lapsCompleted ?? null,
    lastStopSec: last?.kind === 'pitExit' ? last.stopSec : null,
    laps: laps.slice(-RECENT_LAPS),
  };
}

export const feedFromLive = (live: Live, from: string, now: number): EngineerFeed => ({
  v: 1,
  from,
  sentAt: now,
  source: live.source,
  state: live.state,
  field: live.field,
  team: summarise(live.events),
  outline: live.outline ?? undefined,
});

/** Of the feeds heard recently, the one to show: the driving PC's (it knows the fuel), else the newest */
export function pickFeed(feeds: EngineerFeed[], now: number): EngineerFeed | null {
  const fresh = feeds.filter((f) => now - f.sentAt < STALE_MS);
  if (!fresh.length) return null;
  const score = (f: EngineerFeed) => (f.state?.fuelLevel != null ? 1 : 0) * 1e15 + f.sentAt;
  return fresh.reduce((a, b) => (score(b) > score(a) ? b : a));
}

export type ShareStatus =
  /** Accounts aren't set up on this site, or nobody is signed in */
  | 'signed-out'
  /** This plan only lives in this browser */
  | 'local-plan'
  | 'connecting'
  | 'on'
  /** The channel was refused (schema not applied, or no access) */
  | 'error';

export interface Engineer {
  feed: EngineerFeed | null;
  /** Where the feed comes from: the helper on this PC, or a teammate's PC */
  origin: 'local' | 'remote' | null;
  share: ShareStatus;
  /** Sharing this PC's helper data with the team right now */
  sending: boolean;
  /** The last track shape seen for the feed's track */
  outline: { track: string; points: number[] } | null;
}

const pageId = Math.random().toString(36).slice(2, 10);
const OUTLINES = 'nightstint.track-outlines';

function savedOutline(track: string): number[] | null {
  try {
    return (JSON.parse(localStorage.getItem(OUTLINES) ?? '{}') as Record<string, number[]>)[track] ?? null;
  } catch {
    return null;
  }
}
function saveOutline(track: string, points: number[]) {
  try {
    const all = JSON.parse(localStorage.getItem(OUTLINES) ?? '{}') as Record<string, number[]>;
    if (JSON.stringify(all[track]) === JSON.stringify(points)) return;
    all[track] = points;
    localStorage.setItem(OUTLINES, JSON.stringify(all));
  } catch {
    /* private mode: draw it again next time */
  }
}

/**
 * The Race engineer feed for a plan. `inCloud` is whether the plan is saved to the
 * signed-in account (owned or shared), which is what gives it a channel.
 */
export function useEngineer(planId: string, live: Live, session: Session | null, inCloud: boolean): Engineer {
  const [remote, setRemote] = useState<EngineerFeed[]>([]);
  const [share, setShare] = useState<ShareStatus>('signed-out');
  const [now, setNow] = useState(Date.now());
  const [outline, setOutline] = useState<Engineer['outline']>(null);
  const channelRef = useRef<ReturnType<NonNullable<typeof cloud>['channel']> | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;
  const localLive = live.status === 'live';

  // Join the plan's channel while signed in on a cloud plan
  useEffect(() => {
    setRemote([]);
    if (!cloud || !session) return setShare('signed-out');
    if (!inCloud) return setShare('local-plan');
    setShare('connecting');
    let gone = false;
    const client = cloud;
    const channel = client.channel(`live:${planId}`, { config: { private: true, broadcast: { self: false } } });
    channel.on('broadcast', { event: 'feed' }, ({ payload }) => {
      const f = payload as EngineerFeed;
      if (f?.v !== 1 || !f.from) return;
      // Clocks differ between PCs: time it by when it arrived here
      const got = { ...f, sentAt: Date.now() };
      setRemote((all) => [...all.filter((x) => x.from !== f.from && Date.now() - x.sentAt < STALE_MS), got]);
    });
    void client.realtime.setAuth().then(() => {
      if (gone) return;
      channel.subscribe((status) => {
        if (gone) return;
        if (status === 'SUBSCRIBED') setShare('on');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setShare('error');
      });
    });
    channelRef.current = channel;
    return () => {
      gone = true;
      channelRef.current = null;
      void client.removeChannel(channel);
    };
  }, [planId, session?.user.id, inCloud]);

  // Share this PC's helper data once a second
  useEffect(() => {
    if (!localLive || share !== 'on') return;
    let n = 0;
    const t = setInterval(() => {
      const l = liveRef.current;
      if (l.status !== 'live' || !channelRef.current) return;
      const f = feedFromLive(l, pageId, Date.now());
      if (n++ % OUTLINE_EVERY !== 0) delete f.outline;
      void channelRef.current.send({ type: 'broadcast', event: 'feed', payload: f });
    }, SEND_MS);
    return () => clearInterval(t);
  }, [localLive, share]);

  // Notice when a teammate's feed goes quiet
  useEffect(() => {
    if (!remote.length) return;
    const t = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(t);
  }, [remote.length]);

  const feed = localLive ? feedFromLive(live, pageId, Date.now()) : pickFeed(remote, now);
  const origin = localLive ? 'local' : feed ? 'remote' : null;

  // Remember track shapes, so a teammate who joins mid-race sees the map at once
  const track = feed?.field?.track ?? feed?.state?.track ?? '';
  const sent = feed?.outline;
  useEffect(() => {
    if (sent && sent.points.length) {
      saveOutline(sent.track, sent.points);
      setOutline(sent);
    } else if (track && outline?.track !== track) {
      const points = savedOutline(track);
      setOutline(points ? { track, points } : null);
    }
  }, [track, sent?.track, sent?.points]); // eslint-disable-line react-hooks/exhaustive-deps

  return { feed, origin, share, sending: localLive && share === 'on', outline: outline && outline.track === track ? outline : null };
}
