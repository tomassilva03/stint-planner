import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cloud,
  deleteCloudPlan,
  fetchPlans,
  isUuid,
  pickCopy,
  removeMember,
  savePlan,
  signOut as cloudSignOut,
  watchPlans,
  type CloudMeta,
} from './cloud';
import { normalize } from './engine';
import { migrate, type Plan } from './model';
import { samplePlan } from './sample';
import { nurburgringPlan } from './samples/nurburgring';

const KEY = 'enduro-planner.plans.v1';
const CURRENT = 'enduro-planner.current.v1';
const META = 'enduro-planner.cloud-meta.v1';
const DIRTY = 'enduro-planner.cloud-dirty.v1';

export type SyncState = 'local' | 'synced' | 'saving' | 'offline' | 'error';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch {
    /* private window or blocked storage: keep working in memory */
  }
}

function load(): Plan[] {
  const list = read<unknown[]>(KEY, []);
  if (Array.isArray(list) && list.length) return list.map(migrate).map(normalize);
  return [normalize(nurburgringPlan()), normalize(samplePlan())];
}

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-local`);

export function usePlans() {
  const [plans, setPlans] = useState<Plan[]>(load);
  const [currentId, setCurrentId] = useState<string>(() => {
    try {
      return localStorage.getItem(CURRENT) ?? '';
    } catch {
      return '';
    }
  });
  const [meta, setMeta] = useState<Record<string, CloudMeta>>(() => read(META, {}));
  const [dirty, setDirty] = useState<string[]>(() => read(DIRTY, []));
  const [session, setSession] = useState<Session | null>(null);
  const [sync, setSync] = useState<{ state: SyncState; message?: string }>({ state: 'local' });

  const plan = plans.find((p) => p.id === currentId) ?? plans[0];
  const role = meta[plan.id]?.role;
  const readOnly = role === 'viewer';

  // Refs so async callbacks see the latest state
  const plansRef = useRef(plans);
  const metaRef = useRef(meta);
  const dirtyRef = useRef(dirty);
  const sessionRef = useRef(session);
  plansRef.current = plans;
  metaRef.current = meta;
  dirtyRef.current = dirty;
  sessionRef.current = session;

  useEffect(() => {
    write(KEY, plans);
    write(CURRENT, plan.id);
  }, [plans, plan.id]);
  useEffect(() => write(META, meta), [meta]);
  useEffect(() => write(DIRTY, dirty), [dirty]);

  // ----- Sign-in state
  useEffect(() => {
    if (!cloud) return;
    cloud.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = cloud.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  // ----- Upload pending edits
  const flushTimer = useRef<number>();
  const flush = useCallback(async () => {
    if (!cloud || !sessionRef.current) return;
    const ids = [...dirtyRef.current];
    if (!ids.length) return setSync({ state: 'synced' });
    setSync({ state: 'saving' });
    for (const id of ids) {
      const p = plansRef.current.find((x) => x.id === id);
      const m = metaRef.current[id];
      if (!p || !m || m.role === 'viewer') {
        setDirty((d) => d.filter((x) => x !== id));
        continue;
      }
      try {
        const row = await savePlan(p, false);
        setMeta((all) => ({ ...all, [id]: { ...all[id], updatedAt: row.updated_at } }));
        // Only clear if nothing changed while the save was in flight
        if (plansRef.current.find((x) => x.id === id) === p) setDirty((d) => d.filter((x) => x !== id));
      } catch (e: any) {
        const offline = typeof navigator !== 'undefined' && !navigator.onLine;
        setSync({ state: offline ? 'offline' : 'error', message: e?.message });
        return;
      }
    }
    setSync({ state: dirtyRef.current.length ? 'saving' : 'synced' });
  }, []);

  const scheduleFlush = useCallback(() => {
    window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(flush, 1000);
  }, [flush]);

  useEffect(() => {
    const retry = () => scheduleFlush();
    window.addEventListener('online', retry);
    const t = window.setInterval(() => dirtyRef.current.length && flush(), 30_000);
    return () => {
      window.removeEventListener('online', retry);
      window.clearInterval(t);
    };
  }, [flush, scheduleFlush]);

  // ----- Pull everything this account can see and merge it in
  const refresh = useCallback(async () => {
    const s = sessionRef.current;
    if (!cloud || !s) return;
    try {
      const { rows, roles } = await fetchPlans(s);
      const seen = new Set(rows.map((r) => r.id));
      setPlans((all) => {
        let next = [...all];
        for (const row of rows) {
          const local = next.find((p) => p.id === row.id);
          const winner = pickCopy(local, metaRef.current[row.id]?.updatedAt, dirtyRef.current.includes(row.id), row);
          if (winner === 'remote') {
            const fresh = normalize(migrate({ ...row.data, id: row.id }));
            next = local ? next.map((p) => (p.id === row.id ? fresh : p)) : [...next, fresh];
          }
        }
        // Drop cached cloud plans that were deleted or unshared
        next = next.filter((p) => !metaRef.current[p.id] || seen.has(p.id) || dirtyRef.current.includes(p.id));
        return next.length ? next : [normalize(samplePlan())];
      });
      setMeta((all) => {
        const next: Record<string, CloudMeta> = {};
        for (const row of rows) {
          const prev = all[row.id];
          next[row.id] = { role: roles[row.id], ownerEmail: row.owner_email, updatedAt: dirtyRef.current.includes(row.id) && prev ? prev.updatedAt : row.updated_at };
        }
        return next;
      });
      setSync({ state: 'synced' });
      scheduleFlush();
    } catch (e: any) {
      setSync({ state: navigator.onLine ? 'error' : 'offline', message: e?.message });
    }
  }, [scheduleFlush]);

  useEffect(() => {
    if (!session) {
      setSync({ state: 'local' });
      return;
    }
    refresh();
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    const stop = watchPlans((row, deletedId) => {
      if (deletedId) {
        if (metaRef.current[deletedId]) {
          setPlans((all) => {
            const rest = all.filter((p) => p.id !== deletedId);
            return rest.length ? rest : [normalize(samplePlan())];
          });
          setMeta(({ [deletedId]: _, ...rest }) => rest);
        }
        return;
      }
      if (!row) return;
      const m = metaRef.current[row.id];
      if (!m) return void refresh(); // newly shared with me
      if (dirtyRef.current.includes(row.id)) return; // my unsynced edits win; they upload next
      if (Date.parse(row.updated_at) <= Date.parse(m.updatedAt)) return; // my own save echoing back
      const fresh = normalize(migrate({ ...row.data, id: row.id }));
      setPlans((all) => all.map((p) => (p.id === row.id ? fresh : p)));
      setMeta((all) => ({ ...all, [row.id]: { ...all[row.id], updatedAt: row.updated_at } }));
    });
    return () => {
      window.removeEventListener('focus', onFocus);
      stop();
    };
  }, [session, refresh]);

  // ----- Editing
  const update = useCallback(
    (fn: (p: Plan) => Plan) => {
      const id = plan.id;
      const m = metaRef.current[id];
      if (m?.role === 'viewer') return;
      setPlans((all) => all.map((p) => (p.id === id ? normalize(fn(p)) : p)));
      if (m) {
        setDirty((d) => (d.includes(id) ? d : [...d, id]));
        scheduleFlush();
      }
    },
    [plan.id, scheduleFlush],
  );

  const add = useCallback((p: Plan) => {
    const n = normalize(migrate(p));
    setPlans((all) => [...all.filter((x) => x.id !== n.id), n]);
    setCurrentId(n.id);
  }, []);

  const remove = useCallback(
    async (id: string) => {
      const m = metaRef.current[id];
      const s = sessionRef.current;
      if (m && s) {
        try {
          if (m.role === 'owner') await deleteCloudPlan(id);
          else await removeMember(id, s.user.email!.toLowerCase());
        } catch (e: any) {
          setSync({ state: 'error', message: e?.message });
          return;
        }
        setMeta(({ [id]: _, ...rest }) => rest);
        setDirty((d) => d.filter((x) => x !== id));
      }
      setPlans((all) => {
        const rest = all.filter((p) => p.id !== id);
        return rest.length ? rest : [normalize(samplePlan())];
      });
    },
    [],
  );

  /** Move a plan that only lives on this device into the signed-in account. */
  const upload = useCallback(async (id: string) => {
    const s = sessionRef.current;
    const p = plansRef.current.find((x) => x.id === id);
    if (!cloud || !s || !p) return;
    const cloudId = isUuid(p.id) ? p.id : newId();
    const moved = { ...p, id: cloudId };
    setSync({ state: 'saving' });
    try {
      const row = await savePlan(moved, true);
      setPlans((all) => all.map((x) => (x.id === id ? moved : x)));
      setCurrentId(cloudId);
      setMeta((all) => ({ ...all, [cloudId]: { role: 'owner', ownerEmail: row.owner_email, updatedAt: row.updated_at } }));
      setSync({ state: 'synced' });
    } catch (e: any) {
      setSync({ state: 'error', message: e?.message });
    }
  }, []);

  /** Sign out after uploading pending edits; cloud plans leave this device. */
  const signOut = useCallback(async () => {
    await flush();
    if (dirtyRef.current.length) {
      setSync({ state: 'error', message: 'Some changes have not been saved to your account yet. Reconnect and try again.' });
      return;
    }
    await cloudSignOut();
    setPlans((all) => {
      const rest = all.filter((p) => !metaRef.current[p.id]);
      return rest.length ? rest : [normalize(samplePlan())];
    });
    setMeta({});
    setDirty([]);
  }, [flush]);

  return {
    plans,
    plan,
    update,
    add,
    remove,
    select: setCurrentId,
    cloud: { session, meta, role, readOnly, sync, dirty: dirty.includes(plan.id), upload, refresh, signOut },
  };
}
