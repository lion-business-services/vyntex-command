// Which page each workspace address shows. Derived from the module registry (./modules.ts): one list for every edition.
import type { ComponentType } from 'react';
import type { Permission } from '@/domain/permissions';
import { MODULES, type ModuleDef, type PageProps } from './modules';

export type { PageProps } from './modules';
export interface PageDef { page: ComponentType<PageProps>; perm?: Permission; module: ModuleDef }

/** First address segment -> page. '' is the dashboard. */
export const PAGES: Record<string, PageDef> = Object.fromEntries(MODULES.map((m) => [m.path, { page: m.page, perm: m.perm, module: m }]));
