import { Fragment } from 'react';

/** Renders text with <mark> around the given [start, end) ranges. */
export function Marked({ text, marks }: { text: string; marks: [number, number][] }) {
  const sorted = [...marks].sort((a, b) => a[0] - b[0]); const out: JSX.Element[] = []; let pos = 0;
  sorted.forEach(([s, e], i) => {
    if (s < pos) return;
    out.push(<Fragment key={'t' + i}>{text.slice(pos, s)}</Fragment>, <mark key={'m' + i}>{text.slice(s, e)}</mark>); pos = e;
  });
  out.push(<Fragment key="end">{text.slice(pos)}</Fragment>);
  return <>{out}</>;
}
