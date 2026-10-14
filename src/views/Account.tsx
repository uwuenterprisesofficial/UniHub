import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authenticate, completePasswordReset, deleteAccount, discardLegacy, importLegacy, legacyCount, requestPasswordReset, serverConfig, signOut, syncNow, useSync } from '../lib/sync';
import { Card, Field, Modal, closeDialog, openDialog, toast } from '../components/ui';

export function SyncBadge() {
  const { token, status, live, pending, lastSync, error } = useSync();
  if (!token) return <small>Signed out</small>;
  const [icon, label] = status === 'offline' ? ['🟠', pending ? 'Offline — changes not saved yet' : 'Offline'] : status === 'error' ? ['🔴', 'Sync problem']
    : pending > 0 || status === 'syncing' ? ['🔄', 'Saving…'] : live ? ['🟢', 'Live — saved'] : ['🟡', 'Saved ' + new Date(lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })];
  return <small title={error}>{icon} {label}</small>;
}

function ConfirmDelete() {
  const [pw, setPw] = useState('');
  return <Modal title="Delete account" buttons={[{ label: 'Cancel' }, { label: 'Delete account and cloud data', cls: 'danger', keepOpen: true, onClick: async () => {
    try { await deleteAccount(pw); closeDialog(); toast('Account deleted.'); } catch (e) { toast((e as Error).message); }
  } }]}>
    <p>This permanently deletes your account, synced data and uploaded files from the server. </p>
    <Field label="Confirm your password"><input type="password" value={pw} onChange={e => setPw(e.target.value)} autoFocus /></Field>
  </Modal>;
}

/** Older versions kept the workspace in this browser. Offer to move it into the account once. */
export function LegacyImport() {
  const n = legacyCount(), email = useSync.getState().user?.email ?? 'your account';
  return <Modal title="Data from an earlier version" buttons={[
    { label: 'Discard it', onClick: () => discardLegacy() },
    { label: 'Import into my account', cls: 'primary', onClick: () => { toast(`Imported ${importLegacy()} items`); } }]}>
    <p>UniHub now saves everything on the server and shows changes on all your devices instantly. This browser still holds <b>{n}</b> items from the earlier version that are not in <b>{email}</b>. Import them?</p>
  </Modal>;
}

/** The sign-in / registration form (shown full-screen until you are signed in). */
export function AuthForm() {
  const s = useSync();
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [sent, setSent] = useState(false); const [byMail, setByMail] = useState(true);
  useEffect(() => { if (mode === 'forgot') serverConfig().then(c => setByMail(c.passwordResetByEmail)).catch(() => { }); }, [mode]);
  const [email, setEmail] = useState(''), [pw, setPw] = useState(''), [name, setName] = useState(''), [busy, setBusy] = useState(false), [adv, setAdv] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await authenticate(mode === 'register' ? 'register' : 'login', email, pw, name);
      setPw('');
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };

  return <div>
    <p className="small muted">Your workspace lives in your account and is saved on the server as you type. Sign in on any device to see the same data, updated live.</p>
    {mode === 'forgot' ? <form onSubmit={async e => {
      e.preventDefault(); setBusy(true);
      try { await requestPasswordReset(email); setSent(true); } catch (err) { toast((err as Error).message); }
      setBusy(false);
    }}>
      <h3 style={{ margin: '0 0 8px' }}>Reset your password</h3>
      {sent ? <p className="small">If an account exists for <b>{email}</b>, a reset link is on its way{byMail ? ' (check your spam folder too)' : ' — this server has no email set up, so the link was written to the server log; ask whoever runs the server'}. The link works once and expires after an hour.</p>
        : <><Field label="Email of your account"><input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required /></Field>
          <button className="btn primary" disabled={busy}>{busy ? 'Please wait…' : 'Send reset link'}</button></>}
      <p className="small"><a href="#/settings" onClick={e => { e.preventDefault(); setMode('login'); setSent(false); }}>← Back to sign in</a></p>
    </form> : <>
    <div className="seg" style={{ marginBottom: 12 }}><button className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Sign in</button><button className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>Create account</button></div>
    <form onSubmit={e => { e.preventDefault(); submit(); }}>
      {mode === 'register' && <Field label="Name (optional)"><input type="text" value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></Field>}
      <Field label="Email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required /></Field>
      <Field label={mode === 'register' ? 'Password (min. 8 characters)' : 'Password'}><input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={8} required /></Field>
      <button className="btn primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      {mode === 'login' && <> <a className="small" href="#/settings" style={{ marginLeft: 12 }} onClick={e => { e.preventDefault(); setMode('forgot'); }}>Forgot password?</a></>}
    </form></>}
    <p className="small"><a href="#/settings" onClick={e => { e.preventDefault(); setAdv(!adv); }}>Server settings</a></p>
    {adv && <Field label="Server URL (leave empty for this site)"><input type="url" placeholder="https://unihub.example.com" value={s.url} onChange={e => useSync.setState({ url: e.target.value })} /></Field>}
    {s.error && <p className="small overdue">{s.error}</p>}
  </div>;
}

export function AccountCard() {
  const s = useSync();
  return <Card title="☁ Account">
    <p style={{ margin: '0 0 4px' }}><b>{s.user?.name || s.user?.email}</b></p><p className="small muted" style={{ marginTop: 0 }}>{s.user?.email}</p>
    <p className="small"><SyncBadge />{s.error && <span className="overdue"> · {s.error}</span>}</p>
    <div className="row">
      <button className="btn" onClick={() => syncNow().then(() => toast('Up to date'))}>Refresh now</button>
      <button className="btn" onClick={() => signOut()}>Sign out</button>
      <button className="btn danger" onClick={() => openDialog(<ConfirmDelete />)}>Delete account…</button></div>
    <p className="small muted">Everything you change is sent to the server immediately and appears on your other devices within a second. If two devices edit the same item, the later edit wins. Signing out removes the workspace from this device.</p>
  </Card>;
}

/** Opened from the emailed link: #/reset?token=… */
export function ResetPassword() {
  const [sp] = useSearchParams(); const nav = useNavigate(); const token = sp.get('token') ?? '';
  const [pw, setPw] = useState(''), [pw2, setPw2] = useState(''), [busy, setBusy] = useState(false), [done, setDone] = useState(false), [err, setErr] = useState('');
  const submit = async () => {
    if (pw !== pw2) { setErr('The two passwords are not the same.'); return; }
    setBusy(true); setErr('');
    try { await completePasswordReset(token, pw); setDone(true); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return <div style={{ maxWidth: 440, margin: '40px auto' }}>
    <Card title="🔑 Choose a new password">
      {!token ? <p>This page needs the link from the reset email. <a href="#/settings">Request a new one</a>.</p>
        : done ? <><p>Your password was changed and you were signed out everywhere. Sign in with the new password.</p><button className="btn primary" onClick={() => nav('/settings')}>Go to sign in</button></>
          : <form onSubmit={e => { e.preventDefault(); void submit(); }}>
            <Field label="New password (min. 8 characters)"><input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" minLength={8} required autoFocus /></Field>
            <Field label="Repeat the new password"><input type="password" value={pw2} onChange={e => setPw2(e.target.value)} autoComplete="new-password" minLength={8} required /></Field>
            {err && <p className="small overdue">{err} {/invalid or has expired/.test(err) && <a href="#/settings">Request a new link</a>}</p>}
            <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button></form>}
    </Card>
  </div>;
}
