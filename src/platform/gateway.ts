// The data operations the app needs, described once, with two possible implementations behind them.
//
// TODAY (demo mode, /demo): the operations are the functions in src/domain/actions.ts, run by `act()` in
// src/store/store.ts against a copy of the sample business kept in the visitor's browser. Nothing leaves the browser.
//
// LATER (customer mode, /<company-slug>): a Supabase implementation plugs in behind this same interface. Each
// operation becomes one call to the company's rows in the database, where row level security decides what the
// signed-in person may read and change (supabase/migrations, docs/SECURITY.md). The pages do not change: they keep
// calling the same operation names with the same arguments.
//
// This file is types only. There is deliberately no implementation and no database client here: the Supabase
// package is not installed, and a fake implementation would misrepresent what works today.

import type { DemoState, IndustryId, OfficeRole } from '@/domain/types';
import type { Ctx } from '@/domain/context';
import type { WorkspaceMode } from './mode';

type DomainActions = typeof import('@/domain/actions');

/** Exports of src/domain/actions.ts that are helpers, not operations (the database assigns numbers itself). */
type NotAnOperation = 'nextTicket' | 'nextJobNumber';

/** Turns `(data, context, ...args) => result` into `(...args) => Promise<result>`: the caller no longer passes the data. */
type Remote<F> = F extends (d: DemoState, ctx: Ctx, ...args: infer A) => infer R ? (...args: A) => Promise<R> : never;

/**
 * One method per business action, with the same name and the same arguments as in src/domain/actions.ts:
 * createLead, updateLead, setLeadStage, deleteLead, convertLead, addNote, deleteNote, saveClient, createJob, updateJob,
 * setJobStatus, deleteJob, saveAssignment, removeFromJob, addExpense, addClientPayment, addWorkLog, saveWorker,
 * payWorker, deleteWorkerPay, createTask, updateTask, setTaskStatus, toggleTask, deleteTask, createDoc, saveDocEdits,
 * sendForSignature, advanceSignature, setDocStatus, runDaily.
 * The list is derived from the actions file, so an action added there appears here without editing this file.
 */
export type DataOperations = {
  [K in Exclude<keyof DomainActions, NotAnOperation>]: Remote<DomainActions[K]>;
};

/** Role of the signed-in person in the workspace. Field workers only ever get the worker portal. */
export type WorkspaceRole = OfficeRole | 'worker';

/** Who is looking, and at which company. In demo mode this comes from the demo bar; in customer mode from sign-in. */
export interface WorkspaceSession {
  mode: WorkspaceMode;
  /** Company address (`/<slug>`). `demo` in demo mode. */
  slug: string;
  /** tenants.id in customer mode. Null in demo mode: the demo has no company in the database. */
  tenantId: string | null;
  industry: IndustryId;
  /** Plan id from config/vyntex-build-pricing.json. Entitlements are worked out from it; prices are never stored. */
  planId: string;
  role: WorkspaceRole;
  /** Team user id (office roles) or worker id (workers) of the person acting. */
  actorId: string;
}

/**
 * The records the pages read. Same shapes as the demo store, minus the fields that only exist for the demo.
 * In customer mode a list only holds what the person's role may see: office staff get jobs without prices and no
 * payments, a worker gets only their own assignments, tasks and payments. Pages already hide those parts by role.
 */
export type WorkspaceData = Omit<DemoState, 'v' | 'seededOn' | 'seedLang' | 'touched'>;

/**
 * Compliance operations that exist only in customer mode, because they depend on the database
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

/** What a workspace implementation provides to the app. */
export interface WorkspaceGateway {
  readonly mode: WorkspaceMode;
  /** Who is signed in and which company they are in. */
  session(): Promise<WorkspaceSession>;
  /** Loads the records the person may see. */
  load(): Promise<WorkspaceData>;
  /** The business actions. */
  readonly actions: DataOperations;
  /** Null in demo mode. */
  readonly compliance: ComplianceOperations | null;
}
