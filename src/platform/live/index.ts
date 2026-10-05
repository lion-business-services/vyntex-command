// The live implementation of the workspace gateway: fetch calls to this site's own /api addresses (docs/SERVER.md).
//
//   http.ts        the one fetch function: csrf header, background polling mark, coded answers, the identity check prompt
//   auth.ts        sign-in, the second step, invitations, passwords
//   workspace.ts   opening a workspace from an address, the background check, sign-out, the end of a session
//   sync.ts        ordinary changes: requests with idempotency keys, repeated until answered, never applied twice
//   carry.ts       what is on its way or was unsaved when a session ended (memory only)
//   ops.ts         protected operations, files, connections, the 1099 functions
//   status.ts      saved, saving, offline, problem: `useSyncStatus()` for the workspace frame
//
// Nothing here is called in a sample workspace: the sample implementation answers there (../sample.ts).
import { registerGateway, type WorkspaceData, type WorkspaceGateway } from '../gateway';
import { session } from '../session';
import { get, reasonOf } from './http';
import { liveAuth } from './auth';
import { applyWithKey } from './sync';
import { liveCompliance, liveFiles, liveIntegrations, liveProtected } from './ops';
import { PACKS } from '@/packs';

const tenant = (): string => session()?.tenantId ?? '';

export const liveGateway: WorkspaceGateway = {
  mode: 'workspace',
  sample: false,
  async load() {
    const a = await get<{ data: WorkspaceData }>('/api/ws/load?tenant=' + encodeURIComponent(tenant()));
    if (!a.ok) throw new Error(reasonOf(a));
    return a.data.data;
  },
  // The store sends its changes the same way (bootLive is given makeSync). `idem` lets a caller name one request itself,
  // so that repeating it can never apply it twice.
  apply: (ops, idem) => applyWithKey(tenant(), ops, idem),
  protected: liveProtected,
  auth: liveAuth,
  files: liveFiles,
  integrations: liveIntegrations,
  // the 1099 functions exist for the editions that pay field workers
  get compliance() { const s = session(); return s && PACKS[s.industry]?.usesWorkers ? liveCompliance : null; },
};
export const LIVE_AVAILABLE = true;

registerGateway('live', liveGateway);
