// Two small pieces every long list needs: a search that waits until the person stops typing, and pages.
// A list of a few hundred records is fast to filter and slow to draw, so a list shows one page of rows at a time.
import { useEffect, useState } from 'react';
import { LuChevronLeft, LuChevronRight } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import './data.css';

/** The value, a moment after it stopped changing. Typing in a search box then filters once, not on every letter. */
export function useDebounced<T>(value: T, ms = 160): T {
  const [late, setLate] = useState(value);
  useEffect(() => { const id = setTimeout(() => setLate(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return late;
}

export const PAGE_SIZE = 50;
/** One page of a list, and the page it ended up on (a filter can leave the list shorter than the page asked for). */
export function pageOf<T>(rows: T[], page: number, size = PAGE_SIZE): { rows: T[]; page: number; pages: number; from: number; to: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(Math.max(0, page), pages - 1);
  return { rows: rows.slice(at * size, at * size + size), page: at, pages, from: rows.length ? at * size + 1 : 0, to: Math.min(rows.length, at * size + size) };
}

/** "1 to 50 of 570" with previous and next. Draws nothing when everything fits on one page. */
export function Pager({ total, page, onPage, size = PAGE_SIZE, testId }: { total: number; page: number; onPage: (p: number) => void; size?: number; testId?: string }) {
  const { t } = useApp();
  const pages = Math.ceil(total / size);
  if (pages <= 1) return null;
  const from = page * size + 1; const to = Math.min(total, (page + 1) * size);
  return (
    <nav className="data-pager" aria-label={t('data.pager.label')} data-testid={testId}>
      <span className="small muted" aria-live="polite">{t('data.pager.range', { from, to, total })}</span>
      <span className="row tight">
        <button type="button" className="btn sm" disabled={page <= 0} onClick={() => onPage(page - 1)}><LuChevronLeft aria-hidden="true" />{t('data.pager.prev')}</button>
        <button type="button" className="btn sm" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>{t('data.pager.next')}<LuChevronRight aria-hidden="true" /></button>
      </span>
    </nav>
  );
}
