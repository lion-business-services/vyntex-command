// Which page each workspace address shows. One registry for every industry edition.
import { lazy, type ComponentType } from 'react';
import type { Permission } from '@/domain/permissions';

// each page is loaded the first time it is opened, so the first screen stays light
const DashboardPage = lazy(() => import('@/features/dashboard'));
const LeadsPage = lazy(() => import('@/features/leads'));
const ClientsPage = lazy(() => import('@/features/clients'));
const JobsPage = lazy(() => import('@/features/jobs'));
const CalendarPage = lazy(() => import('@/features/calendar'));
const TasksPage = lazy(() => import('@/features/tasks'));
const TeamPage = lazy(() => import('@/features/team'));
const DocumentsPage = lazy(() => import('@/features/documents'));
const MessagesPage = lazy(() => import('@/features/messages'));
const PaymentsPage = lazy(() => import('@/features/payments'));
const ReportsPage = lazy(() => import('@/features/reports'));
const CompliancePage = lazy(() => import('@/features/compliance'));
const AutomationsPage = lazy(() => import('@/features/automations'));
const AssistantPage = lazy(() => import('@/features/assistant'));
const SettingsPage = lazy(() => import('@/features/settings'));

/** `id` is the record in the address (/jobs/<id>), `sub` anything after it. */
export interface PageProps { id?: string; sub?: string }
export interface PageDef { page: ComponentType<PageProps>; perm?: Permission }

export const PAGES: Record<string, PageDef> = {
  '': { page: DashboardPage },
  leads: { page: LeadsPage, perm: 'leads' },
  clients: { page: ClientsPage, perm: 'clients' },
  jobs: { page: JobsPage, perm: 'jobs' },
  calendar: { page: CalendarPage, perm: 'calendar' },
  tasks: { page: TasksPage, perm: 'tasks' },
  team: { page: TeamPage, perm: 'team' },
  documents: { page: DocumentsPage, perm: 'documents' },
  messages: { page: MessagesPage, perm: 'documents' },
  payments: { page: PaymentsPage, perm: 'money' },
  reports: { page: ReportsPage, perm: 'reports' },
  compliance: { page: CompliancePage, perm: 'compliance' },
  automations: { page: AutomationsPage, perm: 'automations' },
  assistant: { page: AssistantPage, perm: 'assistant' },
  settings: { page: SettingsPage, perm: 'settings' },
};
