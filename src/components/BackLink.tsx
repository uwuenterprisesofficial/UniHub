import { useLocation, useNavigate } from 'react-router-dom';
import { canGoBack, describePath, previousPath } from '../lib/nav';

/** "← Back to …": returns to the page you actually came from (with its tab, lecture and scroll position).
    When there is no history (a bookmark, a reload in a new tab) it goes to `fallback`. */
export function BackLink({ fallback, label }: { fallback: string; label: string }) {
  const nav = useNavigate(); useLocation(); // re-render when the location changes
  const prev = previousPath(), back = canGoBack();
  return <a className="small" href={'#' + (prev ?? fallback)} onClick={e => { e.preventDefault(); if (back) nav(-1); else nav(fallback); }}>
    ← {back ? (prev ? `Back to ${describePath(prev)}` : 'Back') : label}</a>;
}
