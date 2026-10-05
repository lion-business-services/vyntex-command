// The edition blueprint: what every field edition (crews working on site) shares, so each of the eight packs stays a small
// file and they all behave the same. An edition spreads `fieldDefaults()` and overrides only what is truly different.
// The practice edition writes its own values for the same fields (src/packs/practice/pack.ts).
import type { DocKind, L10n, ModuleId, OfficeRole, OptionDef, RuleDef, RuleEvent, StageDef } from '@/domain/types';
import type { Permission } from '@/domain/permissions';
import type { IndustryPack } from './types';

const l = (en: string, es: string, zh?: string): L10n => (zh ? { en, es, zh } : { en, es });

/** Every capability, in one list. The owner role always holds all of them. Same names as app.can() in the database. */
export const ALL_PERMISSIONS: Permission[] = [
  'leads', 'clients', 'jobs', 'tasks', 'calendar', 'team', 'documents', 'money', 'reports', 'automations', 'assistant', 'settings', 'compliance', 'profit', 'delete',
  'appointments', 'catalog', 'opportunities', 'reviews', 'integrations', 'social', 'comms', 'esign', 'cash', 'payroll', 'bookkeeping', 'licensing', 'deadlines',
  'users', 'audit', 'export', 'import', 'config', 'assignLeads', 'allClients', 'credits', 'secureView', 'secureReveal', 'secureApprove', 'write',
];

/** What an office person without special duties may look at. Read only is exactly this list; staff adds `write`. */
const FIELD_VIEW: Permission[] = ['leads', 'clients', 'jobs', 'tasks', 'calendar', 'documents', 'assistant', 'appointments', 'catalog', 'opportunities', 'reviews', 'comms', 'esign', 'deadlines', 'secureView'];

/** Role matrix of the field editions. Owner: everything. Manager: no settings and no profit figures. Office staff: no money, team, reports, automations or compliance. */
export const FIELD_ROLE_PERMISSIONS: Record<OfficeRole, Permission[]> = {
  owner: ALL_PERMISSIONS,
  manager: [
    'leads', 'clients', 'jobs', 'tasks', 'calendar', 'team', 'documents', 'money', 'reports', 'automations', 'assistant', 'compliance', 'delete',
    'appointments', 'catalog', 'opportunities', 'reviews', 'social', 'comms', 'esign', 'cash', 'deadlines', 'export', 'assignLeads', 'allClients', 'credits',
    'secureView', 'secureReveal', 'secureApprove', 'write',
  ],
  staff: [...FIELD_VIEW, 'write'],
  readonly: FIELD_VIEW,
};

export const FIELD_ROLE_LABELS: Record<OfficeRole, L10n> = {
  owner: l('Owner', 'Dueño', '所有者'), manager: l('Manager', 'Gerente', '经理'), staff: l('Office staff', 'Personal de oficina', '办公室员工'), readonly: l('Read only', 'Solo lectura', '只读'),
};

/** The six stages the field editions have always had. The ids never change, so saved demo data and the seeds stay valid. */
export const FIELD_STAGES: StageDef[] = [
  { id: 'new', label: l('New', 'Nuevo'), kind: 'open', role: 'new' },
  { id: 'contacted', label: l('Contacted', 'Contactado'), kind: 'open', role: 'contacted' },
  { id: 'scheduled', label: l('Visit scheduled', 'Visita programada'), kind: 'open', role: 'visit', hot: true },
  { id: 'sent', label: l('Estimate sent', 'Estimado enviado'), kind: 'open', role: 'proposal', hot: true },
  { id: 'won', label: l('Won', 'Ganado'), kind: 'won' },
  { id: 'lost', label: l('Lost', 'Perdido'), kind: 'lost' },
];

export const FIELD_SOURCES: OptionDef[] = [
  { id: 'website', label: l('Website', 'Sitio web') }, { id: 'phone', label: l('Phone call', 'Llamada') }, { id: 'referral', label: l('Referral', 'Referido') },
  { id: 'facebook', label: l('Facebook', 'Facebook') }, { id: 'instagram', label: l('Instagram', 'Instagram') }, { id: 'google', label: l('Google', 'Google') },
  { id: 'other', label: l('Other', 'Otro') },
];

export const FIELD_LOST_REASONS: OptionDef[] = [
  { id: 'price', label: l('Price', 'Precio') }, { id: 'timing', label: l('Timing', 'Tiempos') }, { id: 'competitor', label: l('Chose someone else', 'Eligió a otro') },
  { id: 'no_response', label: l('No response', 'Sin respuesta') }, { id: 'not_a_fit', label: l('Not a fit', 'No era para nosotros') }, { id: 'other', label: l('Other', 'Otro') },
];

/** The screens the field editions have today, as the menu shows them. */
export const FIELD_MODULES: ModuleId[] = ['leads', 'clients', 'jobs', 'calendar', 'tasks', 'team', 'documents', 'messages', 'payments', 'reports', 'compliance', 'automations', 'assistant', 'settings'];

const FIELD_DOC_KINDS: DocKind[] = ['estimate', 'contract', 'invoice'];

/**
 * The automations every field edition ships with. Each one runs the coded rule of the same id (src/domain/automations.ts), so
 * behaviour is exactly what it was; the rule builder can switch them off or add steps around them.
 */
const shipped = (id: string, event: RuleEvent, name: L10n): RuleDef => ({ id, name, active: true, when: { event }, if: [], then: [{ do: 'builtin', params: { rule: id } }], shipped: true });
export const FIELD_RULES: RuleDef[] = [
  shipped('lead-intake', 'lead.created', l('New lead intake', 'Entrada de prospectos')),
  shipped('visit-prep', 'lead.stage', l('Visit preparation', 'Preparación de la visita')),
  shipped('estimate-follow-up', 'lead.stage', l('Estimate follow-up', 'Seguimiento del presupuesto')),
  shipped('lead-won', 'lead.won', l('Won lead follow-through', 'Seguimiento de prospecto ganado')),
  shipped('job-started', 'job.status', l('Work started', 'Inicio del trabajo')),
  shipped('job-completed', 'job.status', l('Work completed', 'Cierre del trabajo')),
  shipped('payment-posted', 'payment.received', l('Payment posted', 'Pago registrado')),
  shipped('compliance-watch', 'daily', l('Compliance watch', 'Control de cumplimiento')),
];

type Blueprint = Pick<IndustryPack, 'family' | 'priced' | 'modules' | 'leadStages' | 'leadSources' | 'lostReasons' | 'taskTypes' | 'clientTypes' | 'roleLabels'
  | 'rolePermissions' | 'docKinds' | 'appointmentTypes' | 'rules' | 'usesWorkers'>;

/** Blueprint of a field edition. A function, so no two editions ever share (and accidentally change) the same lists. */
export function fieldDefaults(): Blueprint {
  return {
    family: 'field',
    priced: true,
    modules: [...FIELD_MODULES],
    leadStages: FIELD_STAGES.map((s) => ({ ...s })),
    leadSources: FIELD_SOURCES.map((s) => ({ ...s })),
    lostReasons: FIELD_LOST_REASONS.map((s) => ({ ...s })),
    taskTypes: [{ id: 'todo', label: l('To do', 'Por hacer') }],
    clientTypes: [],
    roleLabels: { ...FIELD_ROLE_LABELS },
    rolePermissions: { owner: [...FIELD_ROLE_PERMISSIONS.owner], manager: [...FIELD_ROLE_PERMISSIONS.manager], staff: [...FIELD_ROLE_PERMISSIONS.staff], readonly: [...FIELD_ROLE_PERMISSIONS.readonly] },
    docKinds: [...FIELD_DOC_KINDS],
    appointmentTypes: [],
    rules: FIELD_RULES.map((r) => ({ ...r })),
    usesWorkers: true,
  };
}

/**
 * Builds a field edition: the shared blueprint with the edition's own fields on top. Anything in `own` wins, so an edition
 * overrides a blueprint field only when it truly differs. Packs call it marked as free of side effects, which lets a
 * deployment that does not use an edition leave it out of its bundle.
 */
export function fieldPack(own: Omit<IndustryPack, keyof Blueprint> & Partial<Blueprint>): IndustryPack {
  return { ...fieldDefaults(), ...own };
}
