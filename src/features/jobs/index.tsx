// Jobs: the generic work record ("project" in VYNTEX BUILD, "job", "unit" or "event" in other editions).
// /jobs is the list (table or board); /jobs/<id>/<tab> is one job.
import type { PageProps } from '@/app/routes';
import { JobList } from './list';
import { JobDetail } from './detail';
import '@/features/leads/work.css';
import '@/features/leads/board.css';
import './jobs.css';

export default function JobsPage({ id, sub }: PageProps) {
  return id ? <JobDetail id={id} sub={sub} /> : <JobList />;
}
