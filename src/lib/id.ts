import { isLive } from '@/platform/session';

/**
 * A new record id. Sample workspaces use short readable ids with a prefix (`l8k2j1x9`). A live workspace uses a UUID, because
 * that is what the database keys are; the prefix is ignored there.
 */
export const uid = (prefix = ''): string => (isLive() ? crypto.randomUUID() : prefix + Math.random().toString(36).slice(2, 10));
