import { useEffect, useState } from 'react';
import { cloudConfigured, listMembers, removeMember, setMember, signInWithEmail, signInWithGoogle, type Member } from '../cloud';
import type { Plan } from '../model';
import type { usePlans } from '../store';
import { Pill, Select } from '../ui';

const ROLE_OPTIONS: { value: Member['role']; label: string }[] = [
  { value: 'editor', label: 'Can edit' },
  { value: 'viewer', label: 'Can view' },
];

type CloudApi = ReturnType<typeof usePlans>['cloud'];

export function AccountMenu({ cloud }: { cloud: CloudApi }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState('');
  const [error, setError] = useState('');
  const user = cloud.session?.user;

  return (
    <div className="account">
      <button className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        {user ? (user.email ?? 'Account') : 'Sign in'}
      </button>
      {open && (
        <div className="menu account-menu" role="dialog" aria-label="Account">
          {!cloudConfigured ? (
            <p className="hint">
              Sign-in isn't switched on for this copy of the app yet. Your plans are saved in this browser. See the README section "Accounts and sharing" to turn
              it on.
            </p>
          ) : user ? (
            <>
              <p>
                Signed in as <strong>{user.email}</strong>
              </p>
              <p className="hint">Plans saved to your account follow you to every device and can be shared with teammates.</p>
              <button onClick={() => cloud.refresh()}>Check for new shared plans</button>
              <button className="danger" onClick={() => (cloud.signOut(), setOpen(false))}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <button className="btn wide" onClick={() => signInWithGoogle()}>
                Continue with Google
              </button>
              <form
                className="email-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setError('');
                  try {
                    await signInWithEmail(email);
                    setSent(email);
                  } catch (err: any) {
                    setError(err?.message ?? 'Could not send the email. Check the address and try again.');
                  }
                }}
              >
                <label htmlFor="signin-email">Or get a sign-in link by email</label>
                <div className="with-unit">
                  <input id="signin-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                  <button className="btn" type="submit">
                    Send link
                  </button>
                </div>
              </form>
              {sent && <p className="hint">Check {sent} for a sign-in link. It opens this app signed in.</p>}
              {error && <p className="hint bad">{error}</p>}
              <button className="btn wide" disabled title="Needs iRacing to approve this app for their sign-in">
                Continue with iRacing <span className="soon">soon</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const SYNC_TEXT = {
  local: 'Only on this device',
  synced: 'Saved to your account',
  saving: 'Saving…',
  offline: 'Offline, will save when back online',
  error: 'Not saved',
} as const;

export function CloudBar({ plan, cloud }: { plan: Plan; cloud: CloudApi }) {
  const [sharing, setSharing] = useState(false);
  const m = cloud.meta[plan.id];
  if (!cloudConfigured) return null;
  if (!m) {
    return (
      <div className="cloud-bar">
        <Pill tone="unknown">Only on this device</Pill>
        {cloud.session ? (
          <button className="btn tiny" onClick={() => cloud.upload(plan.id)}>
            Save to my account
          </button>
        ) : (
          <span className="muted">Sign in to save it to your account and share it.</span>
        )}
      </div>
    );
  }
  const state = cloud.dirty && cloud.sync.state === 'synced' ? 'saving' : cloud.sync.state;
  return (
    <div className="cloud-bar">
      <Pill tone={state === 'synced' ? 'open' : state === 'saving' ? 'info' : 'blocked'} title={cloud.sync.message}>
        {SYNC_TEXT[state === 'local' ? 'synced' : state]}
      </Pill>
      {m.role !== 'owner' && (
        <span className="muted">
          Shared by {m.ownerEmail} · you can {m.role === 'editor' ? 'edit' : 'view'}
        </span>
      )}
      {m.role === 'owner' && (
        <button className="btn tiny" onClick={() => setSharing(!sharing)} aria-expanded={sharing}>
          Share
        </button>
      )}
      {sharing && <SharePanel planId={plan.id} onClose={() => setSharing(false)} />}
    </div>
  );
}

function SharePanel({ planId, onClose }: { planId: string; onClose: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Member['role']>('editor');
  const [error, setError] = useState('');
  const load = () => listMembers(planId).then(setMembers, (e) => setError(e.message));
  useEffect(() => {
    load();
  }, [planId]);

  return (
    <div className="menu share-panel" role="dialog" aria-label="Share this plan">
      <div className="panel-head">
        <strong>Share this plan</strong>
        <button className="icon-btn" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="hint">Teammates sign in with this email address (Google or email link) and the plan appears in their list.</p>
      <form
        className="share-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          try {
            await setMember(planId, email, role);
            setEmail('');
            load();
          } catch (err: any) {
            setError(err?.message ?? 'Could not add that person.');
          }
        }}
      >
        <input id="share-email" aria-label="Teammate's email" className="input" type="email" required placeholder="teammate@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Select<Member['role']> id="share-role" ariaLabel="Access" className="input" value={role} onChange={setRole} options={ROLE_OPTIONS} />
        <button className="btn primary" type="submit">
          Add
        </button>
      </form>
      {error && <p className="hint bad">{error}</p>}
      <ul className="members">
        {members.length === 0 && <li className="muted">Not shared with anyone yet.</li>}
        {members.map((m) => (
          <li key={m.email}>
            <span>{m.email}</span>
            <Select<Member['role']>
              id={`role-${m.email}`}
              ariaLabel={`Access for ${m.email}`}
              className="input"
              value={m.role}
              onChange={(v) => setMember(planId, m.email, v).then(load, (err) => setError(err.message))}
              options={ROLE_OPTIONS}
            />
            <button className="icon-btn" aria-label={`Remove ${m.email}`} onClick={() => removeMember(planId, m.email).then(load, (err) => setError(err.message))}>
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
