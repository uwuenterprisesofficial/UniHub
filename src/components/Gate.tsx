import { useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { AuthForm, ResetPassword } from '../views/Account';
import { clearDevice, initSync, syncNow, useSync } from '../lib/sync';
import { Card } from './ui';

/** Nothing is shown from a local copy: the app opens once the account's workspace has arrived from the server. */
export function Gate({ children }: { children: ReactNode }) {
  const { token, ready, status, error } = useSync(); const loc = useLocation();
  useEffect(() => { initSync(); }, []);
  const shell = (body: ReactNode) => <div style={{ maxWidth: 440, margin: '8vh auto', padding: '0 16px' }}>
    <div className="brand" style={{ justifyContent: 'center', marginBottom: 16 }}><span className="logo">U</span><span>UniHub</span></div>{body}</div>;
  if (loc.pathname === '/reset') return <ResetPassword />;
  if (!token) return shell(<Card title="Sign in to UniHub"><AuthForm /></Card>);
  if (!ready) return shell(<Card title={status === 'offline' || status === 'error' ? 'Cannot load your workspace' : 'Loading your workspace…'}>
    {status === 'offline' || status === 'error'
      ? <><p className="small overdue">{error || 'The server cannot be reached.'}</p>
        <p className="small muted">Your data is stored on the server, so UniHub needs a connection to open it. It keeps retrying automatically.</p>
        <div className="row"><button className="btn primary" onClick={() => void syncNow()}>Try again</button><button className="btn" onClick={() => void clearDevice()}>Sign out</button></div></>
      : <p className="small muted">Fetching your modules, notes and documents from the server.</p>}
  </Card>);
  return <>{children}</>;
}
