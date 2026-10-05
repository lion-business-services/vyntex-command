// The one place that answers "how is this company set up?": pipeline stages, sources, task and client types, which screens
// exist, what each role is called and may do, and how new leads are assigned. Every answer is the edition's blueprint
// (src/packs) with the company's own changes (data.config) on top. Nothing else reads data.config or compares a lead's stage
// to a fixed word, so a company can rename, add or remove stages without any screen breaking.
import type { CompanyConfig, DemoState, IndustryId, Lang, Lead, LeadRouting, ModuleId, OfficeRole, OptionDef, StageDef, ViewAs } from './types';
import type { Permission } from './permissions';
import { officeRole } from './permissions';
import type { IndustryPack } from '@/packs/types';
import { PACKS } from '@/packs';

/** Anything that carries a company's configuration: the workspace data, or a part of it in a test. */
type HasConfig = { config?: CompanyConfig };
const cfg = (d: HasConfig): CompanyConfig => d.config ?? {};
const some = <T>(own: T[] | undefined, edition: T[]): T[] => (own && own.length ? own : edition);

/** The edition a workspace runs on. */
export const packOf = (d: { pack: IndustryId }): IndustryPack => PACKS[d.pack];

/* ---------- pipeline stages ---------- */
export const stagesOf = (d: HasConfig, pack: IndustryPack): StageDef[] => some(cfg(d).leadStages, pack.leadStages);
export const stageOf = (d: HasConfig, pack: IndustryPack, id: string | undefined): StageDef | undefined => stagesOf(d, pack).find((s) => s.id === id);
export const isWon = (d: HasConfig, pack: IndustryPack, stageId: string | undefined): boolean => stageOf(d, pack, stageId)?.kind === 'won';
export const isLost = (d: HasConfig, pack: IndustryPack, stageId: string | undefined): boolean => stageOf(d, pack, stageId)?.kind === 'lost';
/** A stage the company no longer has counts as open, so the lead stays in view until someone files it. */
export const isOpen = (d: HasConfig, pack: IndustryPack, stageId: string | undefined): boolean => { const s = stageOf(d, pack, stageId); return !s || s.kind === 'open'; };
/** First stage that plays the given part: `new`, `contacted`, `visit` (a visit or appointment is set), `proposal`, `negotiation`. */
export const stageByRole = (d: HasConfig, pack: IndustryPack, role: NonNullable<StageDef['role']>): StageDef | undefined => stagesOf(d, pack).find((s) => s.kind === 'open' && s.role === role);
export const openStages = (d: HasConfig, pack: IndustryPack): StageDef[] => stagesOf(d, pack).filter((s) => s.kind === 'open');
/** Where a new lead starts: the stage that plays `new`, or the first open stage. */
export const firstStage = (d: HasConfig, pack: IndustryPack): StageDef => stageByRole(d, pack, 'new') ?? openStages(d, pack)[0] ?? stagesOf(d, pack)[0];
export const wonStage = (d: HasConfig, pack: IndustryPack): StageDef | undefined => stagesOf(d, pack).find((s) => s.kind === 'won');
export const lostStage = (d: HasConfig, pack: IndustryPack): StageDef | undefined => stagesOf(d, pack).find((s) => s.kind === 'lost');
/** The part a lead's current stage plays, when it plays one. */
export const stageRole = (d: HasConfig, pack: IndustryPack, stageId: string | undefined): StageDef['role'] => stageOf(d, pack, stageId)?.role;
export const isHot = (d: HasConfig, pack: IndustryPack, stageId: string | undefined): boolean => !!stageOf(d, pack, stageId)?.hot;

/* ---------- lists a company can edit ---------- */
export const sourcesOf = (d: HasConfig, pack: IndustryPack): OptionDef[] => some(cfg(d).leadSources, pack.leadSources);
export const lostReasonsOf = (d: HasConfig, pack: IndustryPack): OptionDef[] => some(cfg(d).lostReasons, pack.lostReasons);
export const taskTypesOf = (d: HasConfig, pack: IndustryPack): OptionDef[] => some(cfg(d).taskTypes, pack.taskTypes);
export const clientTypesOf = (d: HasConfig, pack: IndustryPack): OptionDef[] => some(cfg(d).clientTypes, pack.clientTypes);

/* ---------- screens ---------- */
/** Whether a screen exists for this company: the edition's list, unless the company switched it on or off. */
export function moduleOn(d: HasConfig, pack: IndustryPack, id: ModuleId): boolean {
  const own = cfg(d).modules?.[id];
  return typeof own === 'boolean' ? own : pack.modules.includes(id);
}

/* ---------- roles ---------- */
export function roleLabel(d: HasConfig, pack: IndustryPack, role: OfficeRole, lang: Lang): string {
  const label = cfg(d).roleLabels?.[role] ?? pack.roleLabels[role];
  return label[lang] ?? label.en;
}
/** What a role may do: the edition's matrix, then the company's own list for that role. The owner is never reduced. */
export function permissionsOf(d: HasConfig, pack: IndustryPack, role: OfficeRole): Permission[] {
  if (role === 'owner') return pack.rolePermissions.owner;
  const own = cfg(d).roles?.[role];
  if (!own) return pack.rolePermissions[role] ?? [];
  // a company can only hand out capabilities that exist
  const known = new Set<string>(pack.rolePermissions.owner);
  return own.filter((p): p is Permission => known.has(p));
}
/** Whether whoever is looking (an office role, or a worker in the portal) holds a capability. Workers hold none of them. */
export function can(d: HasConfig, pack: IndustryPack, viewAs: ViewAs, p: Permission): boolean {
  const role = officeRole(viewAs);
  return !!role && permissionsOf(d, pack, role).includes(p);
}

/* ---------- lead assignment ---------- */
const MANUAL: LeadRouting = { mode: 'manual', pool: [], cursor: 0, exclude: [], skipAway: true };
/** How new leads are assigned. A company that never set it up assigns by hand. */
export function routingOf(d: HasConfig): LeadRouting {
  const r = cfg(d).routing;
  return r ? { ...MANUAL, ...r, pool: r.pool ?? [], exclude: r.exclude ?? [] } : { ...MANUAL };
}

/* ---------- other settings with a default ---------- */
export const appointmentRules = (d: HasConfig) => ({ noDoubleBooking: true, prepayHours: 24, creditDays: 0, ...cfg(d).appointments });
export const vaultRules = (d: HasConfig) => ({ approval: 'second_person' as const, revealSeconds: 60, ...cfg(d).vault });
export const securityRules = (d: HasConfig) => ({ idleMinutes: 30, mfaRoles: [] as OfficeRole[], ...cfg(d).security });

/* ---------- leads, read through the configuration ---------- */
export const leadIsOpen = (d: DemoState, l: Lead): boolean => isOpen(d, packOf(d), l.status);
export const leadIsWon = (d: DemoState, l: Lead): boolean => isWon(d, packOf(d), l.status);
export const leadIsLost = (d: DemoState, l: Lead): boolean => isLost(d, packOf(d), l.status);
export const openLeads = (d: DemoState): Lead[] => { const pack = packOf(d); return d.leads.filter((l) => isOpen(d, pack, l.status)); };
