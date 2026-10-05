// Bookkeeping: what this workspace knows about the firm's bookkeeping work, and the way to the firm's own bookkeeping
// application. A module shell (see ./line.tsx): nothing is posted or reconciled here.
import type { PageProps } from '@/app/routes';
import { ServiceLine } from './line';

export default function BookkeepingPage(_props: PageProps) {
  return <ServiceLine line="bookkeeping" clientLink="bookkeeping" />;
}
