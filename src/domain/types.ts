// Core data model shared by every industry edition.
// The same shapes are used by the demo store today and map 1:1 to the tenant tables in supabase/migrations.

/** Interface languages. English and Spanish are complete everywhere; Chinese is offered where a deployment lists it and falls back to English. */
export type Lang = 'en' | 'es' | 'zh';
/** Text an edition ships in several languages. English and Spanish are always present. Read it with `pick()` from '@/i18n'. */
export type L10n<T = string> = { en: T; es: T; zh?: T };
export type IndustryId = 'build' | 'clean' | 'landscape' | 'wash' | 'haul' | 'snow' | 'turnover' | 'events' | 'practice';
/** YYYY-MM-DD */
export type ISODate = string;
/** Full ISO timestamp */
export type ISODateTime = string;

/** Stage id. The list of stages comes from the edition blueprint and the company's own configuration (see domain/config.ts). */
export type LeadStage = string;
/** Source id, from the edition blueprint and the company's configuration. */
export type LeadSource = string;
export type JobStatus = 'estimate' | 'contract' | 'progress' | 'hold' | 'done';
export type TaskStatus = 'todo' | 'doing' | 'waiting' | 'review' | 'done';
export type Priority = 'high' | 'medium' | 'low';
export type PayMethod = 'cash' | 'check' | 'transfer' | 'zelle' | 'card';
export type PayType = 'project' | 'milestone' | 'daily' | 'weekly' | 'monthly' | 'hourly';
export type Repeat = 'once' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
export type AssignStatus = 'pending' | 'progress' | 'done';
export type NoteKind = 'call' | 'visit' | 'text' | 'email' | 'note';

/**
 * Office roles. The ids are the same in every edition; the label shown comes from the edition (a practice calls a manager
 * a senior associate). `readonly` can look and cannot change anything. Field workers use the worker portal instead.
 */
export type OfficeRole = 'owner' | 'manager' | 'staff' | 'readonly';
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
  legalName?: string;
  address?: string;
  website?: string;
  /** IANA time zone, e.g. America/New_York. */
  timezone?: string;
}

export interface TeamUser {
  id: string;
  name: string;
  role: OfficeRole;
  email: string;
  phone?: string;
  /** Job title shown on the profile, free text. */
  title?: string;
  bio?: string;
  /** Data URL (demo) or storage path (live). */
  photo?: string;
  languages?: Lang[];
  officeIds?: string[];
  /** False when the person no longer works here. They keep their history and cannot sign in. */
  active?: boolean;
  /** Takes part in automatic lead assignment. */
  inLeadPool?: boolean;
  /** Out of office: skipped by automatic assignment between these dates. */
  away?: { from: ISODate; to: ISODate; note?: string };
  /** Shown on the security screen. In live mode this comes from the sign-in system, never from this record. */
  mfa?: boolean;
  invitedAt?: ISODateTime;
  lastSeen?: ISODateTime;
}

export interface Note {
  id: string;
  at: ISODateTime;
  kind: NoteKind;
  text: string;
  pin?: boolean;
  by?: string;
  /** TeamUser ids mentioned in the note. */
  mentions?: string[];
}

/** A lead changing hands. Kept on the lead so the history is never lost. */
export interface Handoff { id: string; at: ISODateTime; from: string; to: string; by: string; reason?: string; how: 'manual' | 'round_robin' | 'rule' }

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
  lostAt?: ISODate;
  /** Free text next to the source: the campaign, the person who referred them. */
  sourceDetail?: string;
  /** What happens next and when. A lead without one shows up as needing attention. */
  nextAction?: { text: string; due?: ISODate };
  lastContact?: ISODateTime;
  /** First owner, kept when the lead is handed to someone else. */
  originalOwnerId?: string;
  handoffs?: Handoff[];
  /** Catalog services the person asked about. */
  serviceIds?: string[];
  lang?: Lang;
  kind?: 'individual' | 'business';
  smsOptIn?: boolean;
  officeId?: string;
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
  kind?: 'individual' | 'business';
  /** Client type id from the edition blueprint or the company's configuration. */
  clientType?: string;
  /** Owners or officers of a business client. */
  owners?: ClientPerson[];
  /** Other people to contact at this client. */
  contacts?: ClientPerson[];
  birthday?: ISODate;
  lang?: Lang;
  /** What kind of tax ID is on file. The number itself is never in this record: see RevealRequest. */
  taxIdType?: 'ssn' | 'ein' | 'itin';
  /** Last four digits only, for recognition. */
  taxIdLast4?: string;
  smsOptIn?: boolean;
  whatsappOptIn?: boolean;
  whatsapp?: string;
  social?: { facebook?: string; instagram?: string };
  officeId?: string;
  /** TeamUser id responsible for the relationship. */
  assignedTo?: string;
  lifecycle?: 'active' | 'inactive' | 'former';
  tags?: string[];
  referredBy?: string;
  /** Ids of this client in connected systems, e.g. { square: '...', quickbooks: '...' }. */
  externalIds?: Record<string, string>;
}
export interface ClientPerson { id: string; name: string; title?: string; phone?: string; email?: string; /** Ownership percentage, when known. */ pct?: number; primary?: boolean }

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
  /** Catalog service and price tier this work was created from. */
  serviceId?: string;
  tierId?: string;
  /** Period the work covers, as the business writes it: "2025", "Q3 2026", "October 2026". */
  period?: string;
  /** For repeating work: the earlier job this one follows. */
  parentId?: string;
  officeId?: string;
}

export interface TaskComment { id: string; at: ISODateTime; by: string; text: string; mentions?: string[] }

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
  /** Task type id from the edition blueprint, e.g. `todo`, `client_request`, `call`. */
  type?: string;
  /** For a client request: who asked and how it arrived. */
  requestedBy?: string;
  channel?: MessageChannel;
  apptId?: string;
  comments?: TaskComment[];
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

export type DocKind = 'contract' | 'invoice' | 'estimate' | 'engagement_letter' | 'service_order' | 'service_agreement' | 'consent_7216' | 'poa_2848' | 'upload' | 'custom';
/** A stored file. Demo: a small data URL kept in the browser. Live: a path in private storage, read through a short-lived signed address. */
export interface FileRef { name: string; size: number; mime: string; dataUrl?: string; path?: string }
export interface DocVersion { v: number; at: ISODateTime; by: string; note?: string; file?: FileRef }
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
  /** Template the document was made from (DocTemplate id). */
  templateId?: string;
  /** Uploaded file, for kind `upload`, or the signed copy. */
  file?: FileRef;
  versions?: DocVersion[];
  folder?: string;
  /** Signature request for this document, when one exists (Envelope id). */
  envelopeId?: string;
  leadId?: string;
}

/** A reusable document: headings, paragraphs with {{merge.fields}} and signature lines. `approved` is false until the business has reviewed the wording. */
export interface DocTemplate {
  id: string;
  kind: DocKind;
  name: string;
  lang: Lang;
  blocks: { id: string; type: 'h' | 'p' | 'list' | 'sign'; text: string }[];
  /** Where the wording came from. `starter` wording is a structure to edit, not legal text. */
  source: 'supplied' | 'company' | 'starter';
  approved: boolean;
  approvedBy?: string;
  approvedAt?: ISODateTime;
  active: boolean;
}

export type RefType = 'lead' | 'client' | 'job' | 'task' | 'worker' | 'doc' | 'payment' | 'appointment' | 'service' | 'opportunity' | 'envelope' | 'review' | 'post' | 'cash' | 'compliance' | 'user';
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

export type MessageChannel = 'email' | 'text' | 'whatsapp' | 'facebook' | 'instagram' | 'call' | 'system';
export interface Message {
  id: string;
  at: ISODateTime;
  channel: MessageChannel;
  to: string;
  subject: string;
  body: string;
  /**
   * `draft` = prepared for review. `demo` = shown as sent in the demo; nothing actually leaves the browser.
   * The others are real delivery states and are only ever set by the server in live mode.
   */
  status: 'draft' | 'demo' | 'queued' | 'sent' | 'delivered' | 'failed' | 'received';
  ref: Ref;
  auto?: string;
  /** `in` for something the client sent us. Missing means outgoing. */
  dir?: 'out' | 'in';
  from?: string;
  /** Messages with the same thread id are shown as one conversation. */
  threadId?: string;
  clientId?: string;
  /** TeamUser id of the sender, for outgoing messages written by a person. */
  by?: string;
  /** False for an incoming message nobody has opened yet. */
  read?: boolean;
  provider?: ProviderId;
  externalId?: string;
  error?: string;
  /** Calls: length in seconds. */
  seconds?: number;
  attachments?: FileRef[];
}

export interface AutomationRun {
  id: string;
  at: ISODateTime;
  ruleId: string;
  /** i18n key + params describing what happened. */
  steps: { key: string; params?: Record<string, string | number> }[];
  ref?: Ref;
  /** Missing means it ran fine. */
  status?: 'ok' | 'failed' | 'skipped';
  error?: string;
  /** The same rule never runs twice for the same key (rule + record + occasion). */
  dedupe?: string;
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

  // ---- collections added with the edition blueprint. Every edition has them; an edition that does not use a module leaves its list empty.
  config: CompanyConfig;
  offices: Office[];
  grants: AccessGrant[];
  accessRequests: AccessRequest[];
  catalog: CatalogService[];
  playbooks: Playbook[];
  apptTypes: AppointmentType[];
  appointments: Appointment[];
  credits: Credit[];
  crossSell: CrossSellRule[];
  opportunities: Opportunity[];
  reviews: ReviewRequest[];
  templates: DocTemplate[];
  envelopes: Envelope[];
  connections: Connection[];
  posts: SocialPost[];
  cash: CashEntry[];
  cashCloses: CashClose[];
  complianceItems: ComplianceItem[];
  rules: RuleDef[];
  reveals: RevealRequest[];
  secureLog: SecureAccessLog[];
  audit: AuditEntry[];
}

/** What a pack's seed returns: the sample business for that industry. The store fills in the rest. */
export type SeedData = Pick<DemoState, 'users' | 'leads' | 'clients' | 'jobs' | 'tasks' | 'workers' | 'workerPays' | 'docs' | 'activity' | 'messages'>
  & Partial<Pick<DemoState, ModuleCollection | 'config'>>;
/** The collections a seed may leave out; the store starts them empty. */
export type ModuleCollection = 'offices' | 'grants' | 'accessRequests' | 'catalog' | 'playbooks' | 'apptTypes' | 'appointments' | 'credits' | 'crossSell'
  | 'opportunities' | 'reviews' | 'templates' | 'envelopes' | 'connections' | 'posts' | 'cash' | 'cashCloses' | 'complianceItems' | 'rules' | 'reveals' | 'secureLog' | 'audit';

// =====================================================================================================================
// Edition blueprint data: configuration, offices, catalog, appointments, signatures, connections and the rest.
// Same rule as above: these shapes are what the demo keeps in the browser and what the live gateway returns.
// =====================================================================================================================

export type ModuleId =
  | 'leads' | 'clients' | 'jobs' | 'calendar' | 'appointments' | 'tasks' | 'team' | 'documents' | 'esign' | 'messages' | 'payments'
  | 'reports' | 'compliance' | 'automations' | 'assistant' | 'settings' | 'catalog' | 'opportunities' | 'reviews' | 'integrations'
  | 'social' | 'cash' | 'payroll' | 'bookkeeping' | 'licensing' | 'deadlines' | 'security' | 'audit';

/** A pipeline stage. `kind` is what the rest of the app reasons about; the id and label are free. */
export interface StageDef {
  id: string;
  label: L10n;
  kind: 'open' | 'won' | 'lost';
  /** What the stage means to the automations: a visit or appointment is set, a proposal or estimate is out. */
  role?: 'new' | 'contacted' | 'visit' | 'proposal' | 'negotiation';
  /** Counted as "hot" on the dashboard. */
  hot?: boolean;
}
export interface OptionDef { id: string; label: L10n }

/** Automatic lead assignment. */
export interface LeadRouting {
  mode: 'manual' | 'round_robin';
  /** TeamUser ids in turn order. */
  pool: string[];
  /** Index in `pool` of the person who gets the next lead. */
  cursor: number;
  /** People left out without removing them from the pool. */
  exclude: string[];
  /** Skip people who are marked away. */
  skipAway: boolean;
  /** Who gets the lead when nobody in the pool is available. */
  fallbackId?: string;
}

/**
 * What a company changed on top of its edition. Everything is optional: an empty object means "as the edition ships".
 * Read through domain/config.ts, never directly, so the fallbacks stay in one place.
 */
export interface CompanyConfig {
  leadStages?: StageDef[];
  leadSources?: OptionDef[];
  lostReasons?: OptionDef[];
  taskTypes?: OptionDef[];
  clientTypes?: OptionDef[];
  /** Role label overrides. */
  roleLabels?: Partial<Record<OfficeRole, L10n>>;
  /** Capability overrides per role (full list for that role). The owner role cannot be reduced. */
  roles?: Partial<Record<Exclude<OfficeRole, 'owner'>, string[]>>;
  /** Modules switched off (or on) for this company. Missing means the edition default. */
  modules?: Partial<Record<ModuleId, boolean>>;
  /** Wording overrides, on top of the edition's. */
  terms?: Partial<Record<Lang, Record<string, string>>>;
  routing?: LeadRouting;
  appointments?: { noDoubleBooking: boolean; /** Hours before the start by which a prepaid appointment must be paid. */ prepayHours: number; /** Days a credit stays usable; 0 = no expiry. */ creditDays: number };
  vault?: { /** `second_person`: another authorised person approves. `step_up`: the same person confirms their identity again. */ approval: 'second_person' | 'step_up'; /** How long a revealed value stays on screen. */ revealSeconds: number };
  security?: { /** Minutes without activity before the session ends. */ idleMinutes: number; mfaRoles: OfficeRole[] };
  hours?: { days: number[]; open: string; close: string };
  /** Links the team sends to clients often (shown on the home screen), e.g. bookkeeping and payroll portals. */
  quickLinks?: { id: string; label: L10n; url: string }[];
}

export interface Office { id: string; name: string; address: string; phone?: string; timezone?: string; main?: boolean }
/** One person allowed to see one client outside their office. */
export interface AccessGrant { id: string; userId: string; clientId: string; grantedBy: string; at: ISODateTime; expires?: ISODate; reason?: string }
export interface AccessRequest { id: string; userId: string; clientId: string; reason: string; at: ISODateTime; status: 'pending' | 'approved' | 'denied'; decidedBy?: string; decidedAt?: ISODateTime }

// ---- secure data (tax IDs)
/**
 * A request to see a protected value. The value itself is not part of the workspace data in any mode: live mode returns it
 * from a dedicated server call after approval; the demo has no real value to show and says so.
 */
export interface RevealRequest {
  id: string;
  clientId: string;
  field: 'tax_id';
  requestedBy: string;
  reason: string;
  at: ISODateTime;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'used';
  approverId?: string;
  decidedAt?: ISODateTime;
  /** An approval is good until this moment, for one viewing. */
  expiresAt?: ISODateTime;
}
export interface SecureAccessLog { id: string; at: ISODateTime; clientId: string; userId: string; action: 'set' | 'clear' | 'request' | 'approve' | 'deny' | 'reveal' | 'expire' | 'export'; reason?: string; requestId?: string }

/** Read-only trail of who did what. In live mode it comes from the database audit log and cannot be edited by anyone. */
export interface AuditEntry { id: string; at: ISODateTime; by: string; action: string; entity?: string; entityId?: string; summary?: string; ipHash?: string }

// ---- service catalog
export interface CatalogTier { id: string; name: string; price: number; unit: 'flat' | 'hour' | 'month' | 'quarter' | 'year'; note?: string; externalIds?: Record<string, string> }
export interface CatalogService {
  id: string;
  name: string;
  /** Names and descriptions in other languages, when the business wrote them. */
  i18n?: Partial<Record<Lang, { name?: string; description?: string }>>;
  category: string;
  description?: string;
  active: boolean;
  tiers: CatalogTier[];
  /** How often the work normally repeats. */
  repeat?: Repeat;
  playbookId?: string;
  /** Documents to prepare when this service is sold. */
  docKinds?: DocKind[];
  appointmentTypeId?: string;
  externalIds?: Record<string, string>;
}
export interface PlaybookStep { id: string; title: L10n; /** Days after the engagement starts. */ dueIn: number; for: 'owner' | 'manager' | 'assignee'; type?: string; pri?: Priority }
/** What happens automatically when an engagement for a service begins. */
export interface Playbook { id: string; name: string; steps: PlaybookStep[]; /** Message template sent as the welcome. */ welcome?: string; active: boolean }

// ---- appointments
export type ApptStatus = 'requested' | 'scheduled' | 'awaiting_payment' | 'confirmed' | 'completed' | 'no_show' | 'cancelled_unpaid' | 'cancelled_client' | 'cancelled_staff';
export interface AppointmentType {
  id: string;
  name: L10n;
  minutes: number;
  /** 0 = free. */
  fee: number;
  /** The fee must be paid before the appointment is confirmed. */
  prepay: boolean;
  mode: 'office' | 'phone' | 'video';
  /** Minutes kept free after the appointment. */
  buffer?: number;
  active: boolean;
  serviceId?: string;
}
export interface Appointment {
  id: string;
  typeId: string;
  clientId?: string;
  leadId?: string;
  jobId?: string;
  /** TeamUser id. */
  staffId: string;
  officeId?: string;
  date: ISODate;
  /** HH:MM, 24 hour. */
  time: string;
  minutes: number;
  mode: 'office' | 'phone' | 'video';
  location?: string;
  /** Video link, only when a meeting provider is connected and created one. */
  meetUrl?: string;
  status: ApptStatus;
  fee: number;
  paid?: { at: ISODateTime; method: PayMethod | 'credit'; ref: string; amount: number };
  /** Prepaid appointments: pay by this moment or the slot is released. */
  payBy?: ISODateTime;
  creditId?: string;
  notes?: string;
  created: ISODateTime;
  createdBy: string;
  cancelReason?: string;
  rescheduledFrom?: string;
  externalIds?: Record<string, string>;
}
/** Money the business owes a client in service, e.g. a prepaid appointment the staff had to cancel. A ledger: entries are never edited. */
export interface Credit { id: string; clientId: string; amount: number; reason: 'cancel_staff' | 'reschedule' | 'goodwill' | 'overpayment'; fromApptId?: string; at: ISODateTime; by: string; used?: { apptId: string; at: ISODateTime }; expires?: ISODate; void?: { at: ISODateTime; by: string; reason: string } }

// ---- cross-sell and reviews
export interface CrossSellRule { id: string; name: string; /** Client has any of these services. */ whenServiceIds: string[]; suggestServiceId: string; /** Skip when the client already has any of these. */ unlessServiceIds?: string[]; clientKind?: 'individual' | 'business'; /** Wait this many days after the triggering engagement starts. */ delayDays?: number; note?: string; active: boolean }
export interface Opportunity { id: string; clientId: string; serviceId: string; ruleId?: string; status: 'open' | 'contacted' | 'won' | 'dismissed'; created: ISODate; by: string; note?: string; leadId?: string; value?: number; dismissedReason?: string }
export interface ReviewRequest { id: string; clientId: string; jobId?: string; at: ISODateTime; channel: MessageChannel; status: 'draft' | 'demo' | 'sent' | 'opened' | 'rated' | 'declined'; rating?: number; comment?: string; by: string }

// ---- e-signature
export interface Signer { id: string; name: string; email: string; role?: string; order: number; status: 'waiting' | 'sent' | 'viewed' | 'signed' | 'declined'; viewedAt?: ISODateTime; signedAt?: ISODateTime; typedName?: string; signature?: string; consent?: boolean }
/** A box placed on the document for a signer to fill in. Position and size are fractions of the page (0 to 1). */
export interface SignField { id: string; signerId: string; type: 'signature' | 'initials' | 'date' | 'text' | 'checkbox'; page: number; x: number; y: number; w: number; h: number; label?: string; required: boolean; value?: string }
export interface Envelope {
  id: string;
  docId: string;
  title: string;
  status: 'draft' | 'sent' | 'partly_signed' | 'completed' | 'declined' | 'expired' | 'void';
  /** Signers sign one after another, in `order`. */
  ordered: boolean;
  signers: Signer[];
  fields: SignField[];
  created: ISODateTime;
  createdBy: string;
  sentAt?: ISODateTime;
  expiresAt?: ISODateTime;
  completedAt?: ISODateTime;
  /** Remind unsigned signers every N days. */
  remindEvery?: number;
  lastReminder?: ISODateTime;
  events: { at: ISODateTime; kind: string; signerId?: string; note?: string }[];
  /** True in demo mode: nothing was sent and nothing is legally signed. */
  demo?: boolean;
  /** Signed copy with the completion certificate. */
  signedFile?: FileRef;
}

// ---- connections to outside services
export type ProviderId = 'gmail' | 'resend' | 'gcal' | 'gmeet' | 'gbp' | 'gmaps' | 'square' | 'quickbooks' | 'whatsapp' | 'meta' | 'dialpad' | 'sms' | 'ai';
/** `connected` is only ever set by the server after a real, verified connection. The demo never shows it. */
export type ConnState = 'not_connected' | 'setup' | 'connected' | 'attention' | 'reauth' | 'error' | 'pending_approval';
export interface Connection { id: ProviderId; state: ConnState; account?: string; scopes?: string[]; connectedAt?: ISODateTime; lastSyncAt?: ISODateTime; lastError?: string; settings?: Record<string, string | number | boolean>; by?: string }

export interface SocialPost { id: string; text: string; media?: FileRef[]; channels: ('facebook' | 'instagram' | 'gbp')[]; status: 'draft' | 'needs_approval' | 'scheduled' | 'demo' | 'published' | 'failed'; scheduledFor?: ISODateTime; publishedAt?: ISODateTime; by: string; approvedBy?: string; error?: string; created: ISODateTime }

// ---- petty cash and deadlines
export interface CashEntry { id: string; date: ISODate; officeId?: string; dir: 'in' | 'out'; amount: number; category: string; memo: string; by: string; receipt?: FileRef; closeId?: string }
/** End-of-day count. Once closed, the entries of that day are locked. */
export interface CashClose { id: string; date: ISODate; officeId?: string; expected: number; counted: number; diff: number; by: string; at: ISODateTime; note?: string; approvedBy?: string }
export interface ComplianceItem { id: string; title: string; kind: 'filing' | 'license' | 'renewal' | 'deadline' | 'insurance' | 'other'; clientId?: string; jobId?: string; due: ISODate; repeat?: Repeat; status: 'open' | 'done' | 'waived'; assignee?: string; authority?: string; note?: string; doneAt?: ISODate; /** Days before the due date to remind. */ remind?: number[] }

// ---- rule engine: WHEN something happens, IF conditions hold, THEN do steps
export type RuleEvent =
  | 'lead.created' | 'lead.stage' | 'lead.won' | 'lead.lost' | 'lead.idle' | 'client.created' | 'job.created' | 'job.status' | 'job.completed'
  | 'payment.received' | 'appointment.booked' | 'appointment.paid' | 'appointment.unpaid' | 'appointment.completed' | 'appointment.no_show' | 'appointment.cancelled'
  | 'task.overdue' | 'doc.sent' | 'envelope.completed' | 'envelope.idle' | 'message.received' | 'review.due' | 'deadline.near' | 'client.birthday' | 'worker.document' | 'daily'
  | 'appointment.soon' | 'appointment.pay_soon' | 'opportunity.created' | 'credit.expiring';
export interface RuleCond { field: string; op: 'is' | 'is_not' | 'in' | 'gt' | 'lt' | 'has' | 'empty' | 'not_empty'; value?: string | number | boolean | string[] }
export interface RuleStep { do: 'task' | 'message' | 'notify' | 'assign' | 'stage' | 'document' | 'envelope' | 'appointment' | 'opportunity' | 'review' | 'tag' | 'playbook' | 'builtin'; params: Record<string, string | number | boolean | string[]> }
export interface RuleDef {
  id: string;
  name: L10n;
  about?: L10n;
  active: boolean;
  when: { event: RuleEvent; /** Days, for idle/near events. */ days?: number };
  if: RuleCond[];
  then: RuleStep[];
  /** Shipped with the edition. It can be switched off or edited, and reset to how it shipped. */
  shipped?: boolean;
}
