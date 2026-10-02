// Core data model shared by every industry edition.
// The same shapes are used by the demo store today and map 1:1 to the tenant tables in supabase/migrations.

export type Lang = 'en' | 'es';
export type IndustryId = 'build' | 'clean' | 'landscape' | 'wash' | 'haul' | 'snow' | 'turnover' | 'events';
/** YYYY-MM-DD */
export type ISODate = string;
/** Full ISO timestamp */
export type ISODateTime = string;

export type LeadStage = 'new' | 'contacted' | 'scheduled' | 'sent' | 'won' | 'lost';
export type LeadSource = 'website' | 'phone' | 'referral' | 'facebook' | 'instagram' | 'google' | 'other';
export type JobStatus = 'estimate' | 'contract' | 'progress' | 'hold' | 'done';
export type TaskStatus = 'todo' | 'doing' | 'waiting' | 'review' | 'done';
export type Priority = 'high' | 'medium' | 'low';
export type PayMethod = 'cash' | 'check' | 'transfer' | 'zelle' | 'card';
export type PayType = 'project' | 'milestone' | 'daily' | 'weekly' | 'monthly' | 'hourly';
export type Repeat = 'once' | 'weekly' | 'biweekly' | 'monthly';
export type AssignStatus = 'pending' | 'progress' | 'done';
export type NoteKind = 'call' | 'visit' | 'text' | 'email' | 'note';

/** Office roles. Field workers use the worker portal and are identified by their worker id. */
export type OfficeRole = 'owner' | 'manager' | 'staff';
/** Who the demo is being viewed as: an office role, or `worker:<id>` for the worker portal. */
export type ViewAs = OfficeRole | `worker:${string}`;

export interface Company {
  name: string;
  initials: string;
  /** Licence or insurance line shown on documents, plain text. */
  license: string;
  phone: string;
  email: string;
  /** Data URL of an uploaded logo (demo personalization only). */
  logo?: string;
  /** Accent colour override (demo personalization only). */
  accent?: string;
}

export interface TeamUser {
  id: string;
  name: string;
  role: OfficeRole;
  email: string;
  phone?: string;
}

export interface Note {
  id: string;
  at: ISODateTime;
  kind: NoteKind;
  text: string;
  pin?: boolean;
  by?: string;
}

export interface Lead {
  id: string;
  ticket: string;
  name: string;
  company?: string;
  phone: string;
  email: string;
  address: string;
  /** Service type id from the industry pack. */
  type: string;
  source: LeadSource;
  status: LeadStage;
  pri: Priority;
  /** TeamUser id. */
  ownerId: string;
  value: number | null;
  apptDate?: ISODate;
  apptTime?: string;
  followUp?: ISODate;
  created: ISODate;
  notes: Note[];
  /** Set when the lead is won and converted. */
  clientId?: string;
  jobId?: string;
  lostReason?: string;
}

export interface Client {
  id: string;
  name: string;
  company?: string;
  phone: string;
  email: string;
  addresses: string[];
  since: ISODate;
  notes: Note[];
  /** Client asked not to receive automatic service emails. */
  emailOptOut?: boolean;
}

export interface Assignment {
  id: string;
  workerId: string;
  scope: string;
  /** Agreed total for this part of the work. */
  price: number;
  payType?: PayType;
  rate?: number;
  qty?: number;
  status: AssignStatus;
}

export interface Expense {
  id: string;
  date: ISODate;
  vendor: string;
  desc: string;
  amount: number;
}

export interface Payment {
  id: string;
  date: ISODate;
  method: PayMethod;
  ref: string;
  amount: number;
}

export interface WorkLog {
  id: string;
  date: ISODate;
  workerId: string;
  text: string;
}

export interface Job {
  id: string;
  /** Human-friendly number, e.g. VB-J-1004. */
  number: string;
  name: string;
  clientId: string;
  address: string;
  type: string;
  status: JobStatus;
  /** Agreed price / contract total. */
  price: number;
  start: ISODate | '';
  end: ISODate | '';
  repeat?: Repeat;
  scope: string;
  payTerms: string;
  /** TeamUser id responsible for the job. */
  managerId: string;
  assign: Assignment[];
  expenses: Expense[];
  received: Payment[];
  log: WorkLog[];
  notes: Note[];
  created: ISODate;
  leadId?: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  jobId?: string;
  leadId?: string;
  clientId?: string;
  /** `u:<TeamUser id>` or `w:<Worker id>`. */
  assignee: string;
  due?: ISODate;
  status: TaskStatus;
  pri: Priority;
  created: ISODate;
  doneAt?: ISODate;
  /** Id of the automation rule that created the task, if any. */
  auto?: string;
}

export interface Worker {
  id: string;
  name: string;
  /** Trade or role. */
  trade: string;
  phone: string;
  email: string;
  payType?: PayType;
  rate?: number;
  w9: boolean;
  w9Date?: ISODate;
  /** Insurance certificate expiry. */
  coiExp?: ISODate;
  insurer?: string;
  active?: boolean;
}

export interface WorkerPayment extends Payment {
  workerId: string;
  /** Empty when the payment is not tied to a job. */
  jobId: string;
  payType?: PayType;
  from?: ISODate;
  to?: ISODate;
}

export type DocKind = 'contract' | 'invoice' | 'estimate';
export type DocStatus = 'draft' | 'sent' | 'viewed' | 'signed' | 'paid' | 'void';

/** A demo e-signature request. Nothing is legally executed in demo mode; `demo` is always true here. */
export interface ESign {
  demo: true;
  signerName: string;
  signerEmail: string;
  status: 'sent' | 'viewed' | 'signed' | 'declined';
  sentAt: ISODateTime;
  viewedAt?: ISODateTime;
  signedAt?: ISODateTime;
  /** Demo signing page: the typed name, the drawn signature (image data URL) and the consent tick. */
  typedName?: string;
  signature?: string;
  consent?: boolean;
}

export interface DocRecord {
  id: string;
  kind: DocKind;
  number: string;
  title: string;
  jobId: string;
  clientId: string;
  status: DocStatus;
  created: ISODate;
  updated: ISODate;
  /** Saved edits: block path -> text. Empty when the document is generated from the job as-is. */
  edits?: Record<string, string>;
  esign?: ESign;
}

export type RefType = 'lead' | 'client' | 'job' | 'task' | 'worker' | 'doc' | 'payment';
export interface Ref { type: RefType; id: string }

/** Activity is stored as a kind plus parameters and rendered in the viewer's language. */
export interface Activity {
  id: string;
  at: ISODateTime;
  /** i18n key suffix: `act.<kind>` */
  kind: string;
  params?: Record<string, string | number>;
  ref: Ref;
  /** Extra records this entry should appear under (e.g. the client of a job). */
  also?: Ref[];
  /** TeamUser id, worker id, `system` or `automation`. */
  by: string;
}

export interface Message {
  id: string;
  at: ISODateTime;
  channel: 'email' | 'text';
  to: string;
  subject: string;
  body: string;
  /** `draft` = prepared for review. `demo` = shown as sent in the demo; nothing actually leaves the browser. */
  status: 'draft' | 'demo';
  ref: Ref;
  auto?: string;
}

export interface AutomationRun {
  id: string;
  at: ISODateTime;
  ruleId: string;
  /** i18n key + params describing what happened. */
  steps: { key: string; params?: Record<string, string | number> }[];
  ref?: Ref;
}

/** Workspace-level choices. Modules may keep their own small settings here under a key named after the module. */
export interface WorkspaceSettings {
  /** Written consent to share worker payment data for 1099 preparation (see the pricing rules). */
  consent1099?: { name: string; at: ISODateTime };
  [key: string]: unknown;
}

export interface DemoState {
  /** Schema version of the saved demo data. */
  v: number;
  pack: IndustryId;
  seededOn: ISODate;
  /** Language the sample business was written in. */
  seedLang: Lang;
  /** True once the visitor has changed anything; an untouched demo follows the language switch. */
  touched: boolean;
  company: Company;
  users: TeamUser[];
  leads: Lead[];
  clients: Client[];
  jobs: Job[];
  tasks: Task[];
  workers: Worker[];
  workerPays: WorkerPayment[];
  docs: DocRecord[];
  activity: Activity[];
  messages: Message[];
  automation: { enabled: Record<string, boolean>; runs: AutomationRun[] };
  /** Notification ids the viewer has dismissed or read. */
  readNotifications: string[];
  settings: WorkspaceSettings;
}

/** What a pack's seed returns: the sample business for that industry. The store fills in the rest. */
export type SeedData = Pick<DemoState, 'users' | 'leads' | 'clients' | 'jobs' | 'tasks' | 'workers' | 'workerPays' | 'docs' | 'activity' | 'messages'>;
