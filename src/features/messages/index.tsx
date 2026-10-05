// Messages. One screen, two shapes, decided by the company's communications settings (src/domain/actions/messages.ts):
//
//   inbox on    the communications center: one inbox across every channel the company uses (./Inbox.tsx). The
//               professional-services edition starts this way.
//   inbox off   the list of prepared emails to review and send (./Classic.tsx). The field editions start this way: for
//               them the two-way inbox is not part of any plan in the pricing file, so it is not shown as if it were.
//
// Same records, same actions and the same rules about what may be written to a client in both.
import { useApp } from '@/app/hooks';
import type { PageProps } from '@/app/routes';
import { commsSettings } from '@/domain/actions/messages';
import Classic from './Classic';
import Inbox from './Inbox';
import './messages.css';

export default function MessagesPage(props: PageProps) {
  const { data, pack } = useApp();
  return commsSettings(data, pack).inbox ? <Inbox {...props} /> : <Classic {...props} />;
}
