// What each connection is for in this platform, which group it is listed under, and what the business has to obtain from
// the provider before it can be used. One entry per provider id (ProviderId in src/domain/types.ts): a new provider is one
// more entry here and its wording in ./i18n.ts, nothing in the screen itself.
// The requirements are things to confirm with the provider. Providers change them, and none of them is a promise about
// how long an approval takes.
import type { ComponentType } from 'react';
import { LuCalculator, LuCalendarDays, LuCreditCard, LuMail, LuMapPin, LuMessageCircle, LuMessageSquareText, LuPhone, LuSend, LuShare2, LuSparkles, LuStore, LuVideo } from 'react-icons/lu';
import type { Connection, ProviderId } from '@/domain/types';

export type GroupId = 'email' | 'calendar' | 'money' | 'messaging' | 'social' | 'ai';
export const GROUPS: GroupId[] = ['email', 'calendar', 'money', 'messaging', 'social', 'ai'];
type Icon = ComponentType<{ 'aria-hidden'?: boolean | 'true' | 'false' }>;

export interface ProviderInfo {
  id: ProviderId;
  /** The provider's own name: never translated. */
  name: string;
  /** Where the name is ours and not a brand (text messages, the assistant): the wording key to show instead. */
  nameKey?: string;
  group: GroupId;
  icon: Icon;
  /** How many requirement lines the wording has: integrations.need.<id>.1 .. n */
  needs: number;
  /** The provider has a test mode and a production mode, and it matters which one is in use (money, books). */
  modes?: boolean;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'gmail', name: 'Gmail', group: 'email', icon: LuMail, needs: 4 },
  { id: 'resend', name: 'Resend', group: 'email', icon: LuSend, needs: 3 },
  { id: 'gcal', name: 'Google Calendar', group: 'calendar', icon: LuCalendarDays, needs: 3 },
  { id: 'gmeet', name: 'Google Meet', group: 'calendar', icon: LuVideo, needs: 2 },
  { id: 'square', name: 'Square', group: 'money', icon: LuCreditCard, needs: 4, modes: true },
  { id: 'quickbooks', name: 'QuickBooks Online', group: 'money', icon: LuCalculator, needs: 4, modes: true },
  { id: 'whatsapp', name: 'WhatsApp Business', group: 'messaging', icon: LuMessageCircle, needs: 5 },
  { id: 'sms', name: 'SMS', nameKey: 'integrations.name.sms', group: 'messaging', icon: LuMessageSquareText, needs: 4 },
  { id: 'dialpad', name: 'Dialpad', group: 'messaging', icon: LuPhone, needs: 3 },
  { id: 'meta', name: 'Meta', nameKey: 'integrations.name.meta', group: 'social', icon: LuShare2, needs: 4 },
  { id: 'gbp', name: 'Google Business Profile', group: 'social', icon: LuStore, needs: 3 },
  { id: 'gmaps', name: 'Google Maps', group: 'social', icon: LuMapPin, needs: 2 },
  { id: 'ai', name: 'AI', nameKey: 'nav.assistant', group: 'ai', icon: LuSparkles, needs: 2 },
];

/**
 * What the server says about a connection (GET /api/integrations, docs/SERVER.md section 6). The gateway types the answer
 * as `Connection`; the server also sends why the state is what it is, which settings the deployment lacks, whether the
 * provider still has to approve the app, how the last check went, and (where the provider has one) which mode is in use.
 */
export type ConnectionInfo = Connection & {
  reason?: string;
  missing?: string[];
  approval?: { needed?: boolean; note?: string } | null;
  built?: boolean;
  kind?: 'oauth' | 'key' | 'platform';
  health?: string;
  mode?: 'sandbox' | 'production';
};
/** The mode a connection runs in, when the server says. It may also arrive among the connection's settings. */
export function modeOf(c: ConnectionInfo): 'sandbox' | 'production' | null {
  const v = c.mode ?? c.settings?.environment ?? c.settings?.mode;
  return v === 'sandbox' || v === 'production' ? v : null;
}
