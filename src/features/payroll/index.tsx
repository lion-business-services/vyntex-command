// Payroll: what this workspace knows about the firm's payroll work, and the way to the firm's own payroll application.
// A module shell (see src/features/bookkeeping/line.tsx): no pay is calculated here and no tax table exists in the product.
import type { PageProps } from '@/app/routes';
import { ServiceLine } from '@/features/bookkeeping/line';
import './payroll.css';

export default function PayrollPage(_props: PageProps) {
  return <ServiceLine line="payroll" clientLink="payroll" />;
}
