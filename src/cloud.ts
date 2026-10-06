// Accounts and shared plans, backed by Supabase. Everything here is optional:
// without VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY the app stays local-only.
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { Plan } from './model';

export type Role = 'owner' | 'editor' | 'viewer';

export interface CloudMeta {
  role: Role;
  ownerEmail: string;
  updatedAt: string;
}

export interface Member {
  email: string;
  role: 'editor' | 'viewer';
}

export interface CloudRow {
  id: string;
  owner_id: string;
  owner_email: string;
  name: string;
  data: Plan;
  updated_at: string;
  updated_by: string | null;
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const cloud: SupabaseClient | null = url && key ? createClient(url, key) : null;
export const cloudConfigured = !!cloud;

export const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export function roleFor(row: CloudRow, session: Session | null, members: { plan_id: string; email: string; role: Role }[]): Role {
  if (session && row.owner_id === session.user.id) return 'owner';
  const email = session?.user.email?.toLowerCase();
  return members.find((m) => m.plan_id === row.id && m.email === email)?.role ?? 'viewer';
}

export async function fetchPlans(session: Session): Promise<{ rows: CloudRow[]; roles: Record<string, Role> }> {
  if (!cloud) return { rows: [], roles: {} };
  const [{ data: rows, error }, { data: members }] = await Promise.all([
    cloud.from('plans').select('*'),
    cloud.from('plan_members').select('plan_id, email, role'),
  ]);
  if (error) throw error;
  const list = (rows ?? []) as CloudRow[];
  const roles: Record<string, Role> = {};
  for (const r of list) roles[r.id] = roleFor(r, session, (members ?? []) as any);
  return { rows: list, roles };
}

export async function savePlan(plan: Plan, isNew: boolean): Promise<CloudRow> {
  if (!cloud) throw new Error('Sign-in is not set up');
  const body = { id: plan.id, name: plan.name, data: plan };
  const q = isNew ? cloud.from('plans').insert(body) : cloud.from('plans').update(body).eq('id', plan.id);
  const { data, error } = await q.select().single();
  if (error) throw error;
  return data as CloudRow;
}

export async function deleteCloudPlan(id: string) {
  if (!cloud) return;
  const { error } = await cloud.from('plans').delete().eq('id', id);
  if (error) throw error;
}

export async function listMembers(planId: string): Promise<Member[]> {
  if (!cloud) return [];
  const { data, error } = await cloud.from('plan_members').select('email, role').eq('plan_id', planId).order('added_at');
  if (error) throw error;
  return (data ?? []) as Member[];
}

export async function setMember(planId: string, email: string, role: Member['role']) {
  if (!cloud) return;
  const { error } = await cloud.from('plan_members').upsert({ plan_id: planId, email: email.trim().toLowerCase(), role });
  if (error) throw error;
}

export async function removeMember(planId: string, email: string) {
  if (!cloud) return;
  const { error } = await cloud.from('plan_members').delete().eq('plan_id', planId).eq('email', email);
  if (error) throw error;
}

/** Calls back whenever a plan this user can see is changed by anyone. */
export function watchPlans(onChange: (row: CloudRow | null, deletedId?: string) => void) {
  if (!cloud) return () => {};
  const channel = cloud
    .channel('plans')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'plans' }, (msg) => {
      if (msg.eventType === 'DELETE') onChange(null, (msg.old as { id: string }).id);
      else onChange(msg.new as CloudRow);
    })
    .subscribe();
  return () => {
    cloud.removeChannel(channel);
  };
}

export async function signInWithGoogle() {
  await cloud?.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + window.location.pathname } });
}

export async function signInWithEmail(email: string) {
  if (!cloud) return;
  const { error } = await cloud.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + window.location.pathname } });
  if (error) throw error;
}

export async function signOut() {
  await cloud?.auth.signOut();
}

/**
 * Decide which copy of a plan wins when the same plan exists locally and in the
 * cloud. Unsynced local edits win (they get uploaded); otherwise the newer cloud copy wins.
 */
export function pickCopy(local: Plan | undefined, localSyncedAt: string | undefined, dirty: boolean, remote: CloudRow): 'local' | 'remote' {
  if (!local) return 'remote';
  if (dirty) return 'local';
  if (!localSyncedAt) return 'remote';
  return Date.parse(remote.updated_at) > Date.parse(localSyncedAt) ? 'remote' : 'local';
}
