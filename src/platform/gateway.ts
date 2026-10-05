// The contract between the pages and wherever the records live. Two implementations sit behind it:
//
//   sample   /demo and /preview. The records are a sample business kept in the visitor's browser. Ordinary changes are the
//            functions in src/domain/actions run by `act()` (src/store/store.ts). The protected operations below have sample
//            versions in src/platform/sample.ts that say plainly they are samples. Nothing leaves the browser.
//   live     /<company-slug> or /app, after sign-in. The store starts from `load()`, and after every change sends the
//            difference to `apply()` (src/platform/diff.ts). The protected operations are separate server calls, because the
//            server must check them one by one: nothing protected travels as an ordinary change. The fetch code lives in
//            src/platform/live/.
//
// The browser only ever talks to this site's own /api addresses. It never talks to the database or to an outside service.
// Pages call `gateway()` and get whichever implementation fits the workspace on screen.

import type {
  AccessRequest, Appointment, CashClose, Client, Connection, Credit, DemoState, FileRef, IndustryId, ISODate, ISODateTime, Lang, OfficeRole, PayMethod, ProviderId,
  RevealRequest, TeamUser,
} from '@/domain/types';
import type { Ctx } from '@/domain/context';
import type { Permission } from '@/domain/permissions';
import type { WorkspaceMode } from './mode';
import type { CollectionId, Op } from './diff';
import { isLive } from './session';

type DomainActions = typeof import('@/domain/actions');

/** Exports of src/domain/actions that are helpers, not operations (the database assigns numbers itself). */
type NotAnOperation = 'nextTicket' | 'nextJobNumber';

/** Turns `(data, context, ...args) => result` into `(...args) => Promise<result>`: the caller no longer passes the data. */
type Remote<F> = F extends (d: DemoState, ctx: Ctx, ...args: infer A) => infer R ? (...args: A) => Promise<R> : never;

/**
 * One method per business action, with the same name and the same arguments as in src/domain/actions.
 * The list is derived from the actions, so an action added there appears here without editing this file.
 */
export type DataOperations = {
  [K in Exclude<keyof DomainActions, NotAnOperation>]: Remote<DomainActions[K]>;
};

/** Role of the signed-in person in the workspace. Field workers only ever get the worker portal. */
export type WorkspaceRole = OfficeRole | 'worker';

/** Who is looking, and at which company. In a sample workspace this comes from the "View as" control; in a live one from sign-in. */
export interface WorkspaceSession {
  mode: WorkspaceMode;
  /** Company address (`/<slug>`). `demo` in the demo, `app` in a deployment that has one company. */
  slug: string;
  /** tenants.id in a live workspace. Null in a sample workspace: it has no company in the database. */
  tenantId: string | null;
  industry: IndustryId;
  /** Plan id from the pricing file, or '' for an edition without plans. Entitlements are worked out from it; prices are never stored. */
  planId: string;
  role: WorkspaceRole;
  /** Team user id (office roles) or worker id (workers) of the person acting. */
  actorId: string;
  /** Display name and sign-in email of the person. */
  name?: string;
  email?: string;
  /** What the person may do, as the server worked it out. The interface mirrors it; the server and the database enforce it. */
  permissions?: Permission[];
  /** Sign-in strength: `aal2` once a second factor was verified in this session. */
  aal?: 'aal1' | 'aal2';
  /** Sent back with every changing request (header `x-vx-csrf`). */
  csrf?: string;
  /** When the session ends if nothing happens. */
  idleUntil?: ISODateTime;
  lang?: Lang;
}

/**
 * The records the pages read. Same shapes as the sample store, minus the fields that only exist for the sample.
 * In a live workspace a list only holds what the person's role and office may see, and a tax ID is never part of it.
 */
export type WorkspaceData = Omit<DemoState, 'v' | 'seededOn' | 'seedLang' | 'touched'>;

/* ---------- ordinary changes ---------- */

/** What the server answers to a batch of operations. */
export interface ApplyResult {
  ok: boolean;
  /** How many operations were written. */
  applied: number;
  /**
   * Operations the server refused, each with a short reason code: `forbidden`, `read_only`, `not_ready`, `unknown_collection`,
   * `wrong_tenant`, `invalid`, `stale`, `missing_reference`, `in_use`, `duplicate`, `append_only`, `rolled_back`
   * (docs/DATABASE.md, section 7). `detail` names the part that was wrong, for the log, never for the screen.
   */
  rejected: { id: string; c: string; reason: string; detail?: string }[];
  /** Rows the server changed itself while applying (numbers it assigned, rows written by database rules), to merge back in. */
  server?: ServerPatch;
  /** The new version of every row that was written, by collection and id. It goes back as `row.updatedAt` with the next change. */
  versions?: Record<string, Record<string, string>>;
  /** True when this exact request had been applied before and the stored answer came back: nothing was applied twice. */
  replayed?: boolean;
}
/** Rows to merge into the workspace by id, and single-row parts to replace. */
export type ServerPatch = Partial<Record<CollectionId, { id: string }[]>> & Partial<Pick<WorkspaceData, 'company' | 'config' | 'settings' | 'automation' | 'readNotifications'>>;
/** Sends operations to the server. The store calls this after a change, debounced. */
export type SyncFn = (ops: Op[]) => Promise<ApplyResult>;

/**
 * How the last change stands, for the small indicator in the workspace frame (`useSyncStatus()` in src/platform/live/status.ts):
 *   saved     everything on screen is in the database       saving    a change is on its way
 *   offline   the server cannot be reached; changes wait and are sent again by themselves
 *   problem   something a retry will not fix (the session ended, the server refused the request)
 */
export type SyncState = 'saved' | 'saving' | 'offline' | 'problem';

/* ---------- protected operations ---------- */

/**
 * The answer of a protected operation. `sample` is true when nothing real happened: the record was written to the sample
 * workspace in this browser only. Screens show that next to the result. `reason` is a short code the screen words
 * (`not_allowed`, `not_found`, `needs_other_person`, `expired`, `locked`, `not_available`).
 */
export type Outcome<T> = { ok: true; data: T; sample: boolean } | { ok: false; reason: string; sample: boolean };

export interface RevealedValue {
  /** The protected value, shown once. Always null in a sample workspace: there is no real value to show. */
  value: string | null;
  /** Hide it again at this moment. */
  hideAt: ISODateTime;
  last4?: string;
}
export interface ExportFile { fileName: string; mime: string; content: string }
export type ExportKind = 'clients' | 'leads' | 'jobs' | 'tasks' | 'payments' | 'appointments' | 'audit';

/**
 * Things the server checks one by one, each with its own capability and its own entry in the audit trail.
 * They never travel through `apply()`. Names match the database functions of docs/MASTER-BUILD-SPEC.md, section 7.
 */
export interface ProtectedOperations {
  /** Stores a client's tax ID encrypted. Only the type and the last four digits come back. Needs `secureReveal`. */
  vaultSet(clientId: string, type: NonNullable<Client['taxIdType']>, value: string): Promise<Outcome<{ taxIdType: NonNullable<Client['taxIdType']>; taxIdLast4: string }>>;
  /** Asks to see a client's tax ID, with the business reason. Needs `secureView` and `write`. */
  vaultRequest(clientId: string, reason: string): Promise<Outcome<RevealRequest>>;
  /** Approves or denies someone's request. Needs `secureApprove`; under the two-person rule it cannot be the requester. */
  vaultDecide(requestId: string, approve: boolean): Promise<Outcome<RevealRequest>>;
  /** Shows the value once, for a short time, and writes the viewing to the access log. */
  vaultReveal(requestId: string): Promise<Outcome<RevealedValue>>;

  /** Invites a person by email. There is no open sign-up: this is the only way an account comes to exist. Needs `users`. */
  memberInvite(input: { name: string; email: string; role: OfficeRole; officeIds?: string[]; title?: string }): Promise<Outcome<TeamUser>>;
  memberSetRole(userId: string, role: OfficeRole): Promise<Outcome<TeamUser>>;
  /** Switches a person off. They keep their history and cannot sign in. */
  memberDisable(userId: string): Promise<Outcome<TeamUser>>;
  /** Approves or denies a request to see a client of another office. Approving creates the grant. Needs `allClients`. */
  grantDecide(requestId: string, approve: boolean): Promise<Outcome<AccessRequest>>;

  /** Records the payment of an appointment and confirms it. Needs `money`. */
  apptMarkPaid(apptId: string, payment: { method: PayMethod; ref: string; amount: number }): Promise<Outcome<Appointment>>;
  /** Cancels an appointment. When the staff cancels one that was already paid, the client gets a credit. */
  apptCancel(apptId: string, by: 'client' | 'staff', reason: string): Promise<Outcome<{ appointment: Appointment; credit?: Credit }>>;
  /** Pays an appointment with a credit the client holds. Needs `credits`. */
  creditApply(creditId: string, apptId: string): Promise<Outcome<{ credit: Credit; appointment: Appointment }>>;
  creditVoid(creditId: string, reason: string): Promise<Outcome<Credit>>;
  /** End-of-day count of the cash drawer. Locks the entries of that day. Needs `cash`. */
  cashClose(input: { date: ISODate; officeId?: string; counted: number; note?: string }): Promise<Outcome<CashClose>>;
  /** A file of records to download. Always written to the audit trail. Needs `export`. Tax IDs are never part of an export. */
  exportRequest(kind: ExportKind): Promise<Outcome<ExportFile>>;
  /** Takes the next turn of the automatic lead assignment. On the server this holds a lock so two leads never share a turn. */
  leadAssignNext(leadId: string): Promise<Outcome<{ userId: string | null }>>;
  /**
   * Whose turn it is, for a lead that does not exist yet (it is being typed in): takes the turn and returns the person.
   * The database function is `lead_assign_next(p_tenant)`; null when the company has nobody who can take a lead.
   */
  leadNextTurn(): Promise<Outcome<{ userId: string | null }>>;
  /**
   * Clients that are probably the person being entered, best match first (`client_find_duplicate`). A client of an office
   * the viewer does not belong to still comes back, with its name only and `restricted` set, so nobody is entered twice.
   */
  clientFindDuplicate(input: DuplicateProbe): Promise<Outcome<ClientDuplicate[]>>;
  /** Leads from the same person: the same email or the same phone (`lead_find_duplicate`). */
  leadFindDuplicate(input: Pick<DuplicateProbe, 'email' | 'phone'>): Promise<Outcome<LeadDuplicate[]>>;
}
/** What is known about the person being entered. Email and phone are compared in their normal forms, as the database does. */
export interface DuplicateProbe { email?: string; phone?: string; name?: string; address?: string }
/** `matched` says what matched (`email`, `contact_email`, `phone`, `name`, `address`); `score` uses the database's weights. */
export interface ClientDuplicate { clientId: string; name: string; company: string | null; matched: string[]; score: number; restricted: boolean }
export interface LeadDuplicate { leadId: string; ticket: string; name: string; status: string; matched: string[] }

/* ---------- sign-in ---------- */

export type SignInResult =
  | { ok: true; session: WorkspaceSession }
  /** The account needs its second factor before the workspace opens. */
  | { ok: false; step: 'mfa' }
  /** The role must set up a second factor first. */
  | { ok: false; step: 'enroll' }
  /** `retryAfterSeconds` comes with `locked` and `rate_limited`. `not_configured`: the deployment has no sign-in set up yet. */
  | { ok: false; step: 'error'; reason: 'invalid' | 'locked' | 'disabled' | 'rate_limited' | 'not_available' | 'not_configured' | 'offline'; retryAfterSeconds?: number };

/** /api/auth/*. There is no sign-up call: accounts come from invitations. */
export interface AuthOperations {
  signIn(email: string, password: string): Promise<SignInResult>;
  mfaVerify(code: string): Promise<SignInResult>;
  /** Starts setting up an authenticator app: the secret to type or scan. */
  mfaEnroll(): Promise<Outcome<{ factorId: string; secret: string; uri: string }>>;
  /** Finishes the setup with the first code. Returns the recovery codes, shown once. */
  mfaConfirm(factorId: string, code: string): Promise<Outcome<{ recoveryCodes: string[] }>>;
  mfaRecovery(code: string): Promise<SignInResult>;
  signOut(): Promise<void>;
  /** Ends every session of the person, on every device. */
  signOutAll(): Promise<void>;
  /** The current session, or null when nobody is signed in. */
  session(): Promise<WorkspaceSession | null>;
  /**
   * What an invitation link is for, before the person accepts it. `email` is a hint (`o***@example.com`): the server does
   * not show the full address or the role to someone who merely holds a link.
   */
  inviteInfo(token: string): Promise<Outcome<{ email: string; company: string; role?: OfficeRole; expiresAt?: ISODateTime }>>;
  inviteAccept(token: string, input: { name: string; password: string }): Promise<SignInResult>;
  /** Always answers the same way, whether or not the address has an account. */
  passwordReset(email: string): Promise<void>;
  passwordUpdate(input: { token?: string; current?: string; next: string }): Promise<Outcome<true>>;
  /** Confirms the person again before a sensitive action. Good for a few minutes. */
  stepUp(input: { password?: string; code?: string }): Promise<Outcome<{ until: ISODateTime }>>;
}

/* ---------- files and connections ---------- */

export interface FileOperations {
  /** Stores a file privately and returns its reference. */
  upload(file: File, where: { clientId?: string; jobId?: string; docId?: string; folder?: string }): Promise<Outcome<FileRef>>;
  /** A short-lived address to read a stored file. */
  url(ref: FileRef): Promise<Outcome<string>>;
}

/** /api/integrations/*. In a sample workspace a connection is never `connected`. */
export interface IntegrationOperations {
  list(): Promise<Connection[]>;
  /** Where to send the person to give access (OAuth), or what to fill in (key based). */
  connect(provider: ProviderId): Promise<Outcome<{ redirect?: string }>>;
  disconnect(provider: ProviderId): Promise<Outcome<Connection>>;
  sync(provider: ProviderId, what?: string): Promise<Outcome<Connection>>;
  test(provider: ProviderId): Promise<Outcome<{ healthy: boolean; detail?: string }>>;
}

/* ---------- 1099 compliance (field editions) ---------- */

/**
 * Compliance operations that exist only in a live workspace, because they depend on the database
 * (supabase/migrations 0005 and 0006). The demo shows the screens with sample data and a "Demo simulation" tag.
 */
export interface ComplianceOperations {
  /** Records the owner's written consent to share worker payment data for 1099 preparation. Owner only. */
  grant1099Consent(input: { signerName: string; consentText: string; taxYear?: number }): Promise<void>;
  /** Withdraws a consent. The 1099 export stops working at once. */
  revokeConsent(consentId: string, reason: string): Promise<void>;
  /** Yearly totals paid to each worker. Refused by the database unless a 1099 consent is in force. */
  export1099(taxYear: number, includeTaxIds: boolean): Promise<Export1099Row[]>;
  /** Stores a worker's tax ID encrypted, or clears it with null. Owner and manager only. */
  setWorkerTaxId(workerId: string, taxId: string | null): Promise<void>;
  /** Reads a worker's tax ID. Owner and manager only. Every call is written to the audit log. */
  getWorkerTaxId(workerId: string): Promise<string | null>;
}

export interface Export1099Row {
  workerId: string;
  workerName: string;
  email: string;
  phone: string;
  w9OnFile: boolean;
  w9Date: string | null;
  hasTaxId: boolean;
  /** Present only when tax IDs were asked for. */
  taxId: string | null;
  paymentCount: number;
  paidTotal: number;
  paidByCard: number;
  paidOtherMethods: number;
}

/* ---------- the gateway ---------- */

/** What a workspace implementation provides to the app. */
export interface WorkspaceGateway {
  readonly mode: WorkspaceMode;
  /** True when nothing leaves the browser. */
  readonly sample: boolean;
  /** Loads the records the person may see: GET /api/ws/load. Not used in a sample workspace (the store builds the sample). */
  load(): Promise<WorkspaceData>;
  /** Writes a batch of ordinary changes: POST /api/ws/apply. `idem` makes a retry safe. */
  apply(ops: Op[], idem?: string): Promise<ApplyResult>;
  readonly protected: ProtectedOperations;
  readonly auth: AuthOperations;
  readonly files: FileOperations;
  readonly integrations: IntegrationOperations;
  /** Null in a sample workspace and in editions without 1099 screens. */
  readonly compliance: ComplianceOperations | null;
}

let sampleGateway: WorkspaceGateway | null = null;
let liveGateway: WorkspaceGateway | null = null;
/** Registered once by each implementation when its file is loaded (src/platform/sample.ts, src/platform/live/index.ts). */
export function registerGateway(kind: 'sample' | 'live', impl: WorkspaceGateway): void { if (kind === 'sample') sampleGateway = impl; else liveGateway = impl; }
/** The implementation for the workspace on screen: live after sign-in, sample otherwise. */
export function gateway(): WorkspaceGateway {
  const g = isLive() ? liveGateway : sampleGateway;
  if (!g) throw new Error(isLive() ? 'The live workspace is not available in this build.' : 'The sample workspace is not loaded.');
  return g;
}
/** Sign-in calls are needed before any workspace exists, so they are reachable on their own. */
export function authGateway(): AuthOperations {
  const g = liveGateway ?? sampleGateway;
  if (!g) throw new Error('Sign-in is not available in this build.');
  return g.auth;
}
