import { describe, expect, it } from 'vitest';
import { isUuid, pickCopy, roleFor, type CloudRow } from './cloud';
import { newPlan } from './model';

const row = (updated_at: string): CloudRow => ({
  id: 'p1', owner_id: 'u-owner', owner_email: 'owner@x.com', name: 'x', data: newPlan(), updated_at, updated_by: null,
});

describe('sync conflict rules', () => {
  const local = newPlan();
  it('takes the cloud copy when there is no local one', () => {
    expect(pickCopy(undefined, undefined, false, row('2026-01-01T00:00:00Z'))).toBe('remote');
  });
  it('keeps unsaved local edits', () => {
    expect(pickCopy(local, '2026-01-01T00:00:00Z', true, row('2026-02-01T00:00:00Z'))).toBe('local');
  });
  it('takes a newer cloud copy', () => {
    expect(pickCopy(local, '2026-01-01T00:00:00Z', false, row('2026-02-01T00:00:00Z'))).toBe('remote');
  });
  it('keeps the local copy when it is already up to date', () => {
    expect(pickCopy(local, '2026-02-01T00:00:00Z', false, row('2026-02-01T00:00:00Z'))).toBe('local');
  });
});

describe('roles', () => {
  const session = (id: string, email: string) => ({ user: { id, email } }) as any;
  it('owner, editor, viewer', () => {
    const members = [{ plan_id: 'p1', email: 'ed@x.com', role: 'editor' as const }];
    expect(roleFor(row('2026-01-01T00:00:00Z'), session('u-owner', 'owner@x.com'), members)).toBe('owner');
    expect(roleFor(row('2026-01-01T00:00:00Z'), session('u2', 'Ed@x.com'), members)).toBe('editor');
    expect(roleFor(row('2026-01-01T00:00:00Z'), session('u3', 'v@x.com'), members)).toBe('viewer');
  });
  it('recognises cloud ids', () => {
    expect(isUuid('example-24h')).toBe(false);
    expect(isUuid('11111111-1111-1111-1111-111111111111')).toBe(true);
  });
});
