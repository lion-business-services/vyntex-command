// An industry pack is configuration, not code. The app core reads a pack and adapts:
// product name, wording, service types, documents, task templates, KPIs and the sample business.
import type { AppointmentType, Company, DocKind, IndustryId, JobStatus, L10n, Lang, ModuleId, OfficeRole, OptionDef, RuleDef, SeedData, StageDef } from '@/domain/types';
import type { Permission } from '@/domain/permissions';

export type TermDict = Record<string, string>;

export interface ServiceType { id: string; en: string; es: string; zh?: string }

/** Wording of the customer agreement for this industry (headings and standard clauses). */
export interface AgreementTemplate {
  title: string; intro: string;
  s1: string; s2: string; total: string; s3: string; sched: string;
  s4: string; chg: string; s5: string; ins: string; s6: string; cxl: string; s7: string; esig: string;
  draft: string;
}

export interface TaskTemplate { en: string; es: string; zh?: string; /** Days after the trigger date. */ dueIn: number; /** `owner` or `worker` (first assigned worker). */ for: 'owner' | 'worker'; pri?: 'high' | 'medium' | 'low' }

/** Dashboard tiles. Each one maps to a selector in domain/kpis.ts and drills into a list. */
export type KpiId = 'activeJobs' | 'activeValue' | 'expectedProfit' | 'clientsOwe' | 'oweWorkers' | 'newLeads' | 'pipelineValue' | 'visitsThisWeek' | 'overdueTasks' | 'recurringClients' | 'collectedMonth';

export interface IndustryPack {
  id: IndustryId;
  /** Product name of this edition, as sold (matches the pricing file). */
  product: string;
  label: L10n;
  /** One-line description used on the sales pages and the industry picker. */
  blurb: L10n;
  /** Prefix for lead tickets and job numbers. */
  ticketPrefix: string;
  /** Whether jobs normally repeat (weekly, every 2 weeks, monthly). */
  recurring: boolean;
  /** The fictional company shown in demo mode. */
  sampleCompany: Company;
  serviceTypes: ServiceType[];
  /** Wording overrides on top of the shared dictionary, per language. */
  terms: L10n<TermDict>;
  /** Job statuses used by this industry, in order. All packs share the same five ids; labels come from `terms`. */
  jobStatuses: JobStatus[];
  kpis: KpiId[];
  agreement: L10n<AgreementTemplate>;
  /** Tasks created automatically when a lead is won and the job is created. */
  kickoffTasks: TaskTemplate[];
  /** Tasks created automatically when a job is marked complete. */
  closeoutTasks: TaskTemplate[];
  /** Whether worker compliance (W-9, insurance certificate) and the 1099 report apply. */
  compliance: boolean;

  // ---- the edition blueprint (docs/MASTER-BUILD-SPEC.md, section 2). Field editions take these from fieldDefaults() in blueprint.ts.
  /** `field`: crews doing work on site. `practice`: an office serving clients through engagements and appointments. */
  family: 'field' | 'practice';
  /** False when the edition is not in the pricing file: no plan, no price, quoted on request. */
  priced: boolean;
  /** Which screens exist in this edition. The menu order comes from the module registry (src/app/modules.ts). */
  modules: ModuleId[];
  /** Pipeline stages as the edition ships them. A company can replace the list (see domain/config.ts). */
  leadStages: StageDef[];
  leadSources: OptionDef[];
  lostReasons: OptionDef[];
  /** Always includes `todo`. */
  taskTypes: OptionDef[];
  clientTypes: OptionDef[];
  roleLabels: Record<OfficeRole, L10n>;
  rolePermissions: Record<OfficeRole, Permission[]>;
  docKinds: DocKind[];
  /** Starter set copied into a new company. */
  appointmentTypes: Omit<AppointmentType, 'id'>[];
  /** Automations shipped with the edition. */
  rules: RuleDef[];
  /** False for an edition without field workers: no worker screens, no worker portal, no payments to workers. */
  usesWorkers: boolean;
  /** Grammar hints for sentence building. Spanish: set `job: 'f'` when the word for a job is feminine ("unidad"). */
  grammar?: { es?: { job?: 'm' | 'f' } };
}
/** Builds the sample business of an edition. Dates are relative to today so the demo always looks current. Loaded on demand: see seeds.ts. */
export type SeedFn = (lang: Lang) => SeedData;
