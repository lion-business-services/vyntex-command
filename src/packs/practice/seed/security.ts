// Secure data and access in the sample firm: requests to see a tax ID (one waiting, one approved and used, one that lapsed),
// a request to see a client of the other office, one access already granted, the access log of the protected values and a
// few lines of the audit trail. No tax ID exists anywhere in the sample: a client record holds the type and the last four
// digits, and the entries below only say who did what, to which client, when and why.
import type { AccessGrant, AccessRequest, AuditEntry, Lang, RevealRequest, SecureAccessLog, SeedData } from '@/domain/types';
import { day, stamp, txFor } from './util';

/** A moment some minutes after another one, for "approved six minutes later". */
const after = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60000).toISOString();

export function security(lang: Lang): Partial<SeedData> {
  const tx = txFor(lang);

  // rv1: the senior associate asked this morning and waits for a second person
  const asked1 = stamp(0, 9, 10);
  // rv2: asked, approved by the owner six minutes later, opened once
  const asked2 = stamp(-3, 10, 0);
  // rv3: approved, never opened inside its window, so it lapsed
  const asked3 = stamp(-9, 14, 20);

  const reveals: RevealRequest[] = [
    { id: 'rv1', clientId: 'pc7', field: 'tax_id', requestedBy: 'u2', reason: tx('State filing: the quarterly return asks for the employer number.', 'Declaración estatal: la declaración trimestral pide el número de empleador.'), at: asked1, status: 'pending' },
    { id: 'rv2', clientId: 'pc1', field: 'tax_id', requestedBy: 'u2', reason: tx('Preparing the return: the number goes on the federal form.', 'Preparación de la declaración: el número va en el formulario federal.'), at: asked2, status: 'used',
      approverId: 'u1', decidedAt: after(asked2, 6), expiresAt: after(asked2, 21) },
    { id: 'rv3', clientId: 'pc6', field: 'tax_id', requestedBy: 'u1', reason: tx('Letter from the tax agency: the reply must quote the employer number.', 'Carta de la agencia tributaria: la respuesta debe citar el número de empleador.'), at: asked3, status: 'expired',
      approverId: 'u2', decidedAt: after(asked3, 12), expiresAt: after(asked3, 27) },
  ];

  const secureLog: SecureAccessLog[] = [
    { id: 'sl9', at: asked1, clientId: 'pc7', userId: 'u2', action: 'request', reason: reveals[0].reason, requestId: 'rv1' },
    { id: 'sl8', at: after(asked2, 8), clientId: 'pc1', userId: 'u2', action: 'reveal', reason: reveals[1].reason, requestId: 'rv2' },
    { id: 'sl7', at: after(asked2, 6), clientId: 'pc1', userId: 'u1', action: 'approve', requestId: 'rv2' },
    { id: 'sl6', at: asked2, clientId: 'pc1', userId: 'u2', action: 'request', reason: reveals[1].reason, requestId: 'rv2' },
    { id: 'sl5', at: after(asked3, 27), clientId: 'pc6', userId: 'system', action: 'expire', requestId: 'rv3' },
    { id: 'sl4', at: after(asked3, 12), clientId: 'pc6', userId: 'u2', action: 'approve', requestId: 'rv3' },
    { id: 'sl3', at: asked3, clientId: 'pc6', userId: 'u1', action: 'request', reason: reveals[2].reason, requestId: 'rv3' },
    // when each number was put on file
    { id: 'sl2', at: stamp(-30, 11, 15), clientId: 'pc7', userId: 'u2', action: 'set' },
    { id: 'sl1', at: stamp(-45, 15, 40), clientId: 'pc1', userId: 'u1', action: 'set' },
    { id: 'sl0', at: stamp(-60, 10, 5), clientId: 'pc6', userId: 'u1', action: 'set' },
  ];

  // An associate of one office asks to see a client of the other one. Oldest first, the way new requests are added.
  const granted = stamp(-12, 9, 30);
  const accessRequests: AccessRequest[] = [
    { id: 'ar1', userId: 'u6', clientId: 'pc8', reason: tx('I run their payroll from the East office.', 'Corro su nómina desde la oficina este.'), at: stamp(-12, 9, 5), status: 'approved', decidedBy: 'u1', decidedAt: granted },
    { id: 'ar2', userId: 'u3', clientId: 'pc9', reason: tx('Covering payroll questions for this client while Wei is out next week.', 'Cubro las preguntas de nómina de este cliente mientras Wei está fuera la próxima semana.'), at: stamp(0, 8, 50), status: 'pending' },
  ];
  const grants: AccessGrant[] = [
    { id: 'gr1', userId: 'u6', clientId: 'pc8', grantedBy: 'u1', at: granted, expires: day(60), reason: accessRequests[0].reason },
  ];

  // What the audit trail looks like after a few ordinary days. Newest first.
  const audit: AuditEntry[] = [
    { id: 'au12', at: asked1, by: 'u2', action: 'vault.request', entity: 'client', entityId: 'pc7' },
    { id: 'au11', at: stamp(0, 8, 50), by: 'u3', action: 'access.request', entity: 'client', entityId: 'pc9' },
    { id: 'au10', at: stamp(0, 8, 40), by: 'u1', action: 'signin.completed', entity: 'user', entityId: 'u1' },
    { id: 'au9', at: stamp(-1, 11, 30), by: 'u1', action: 'invite.created', entity: 'user', entityId: 'u7', summary: 'renata@example.com' },
    { id: 'au8', at: stamp(-2, 16, 10), by: 'u2', action: 'export.clients', entity: 'export', summary: `clients-${day(-2)}.csv` },
    { id: 'au7', at: after(asked2, 8), by: 'u2', action: 'vault.reveal', entity: 'client', entityId: 'pc1' },
    { id: 'au6', at: after(asked2, 6), by: 'u1', action: 'vault.approve', entity: 'client', entityId: 'pc1' },
    { id: 'au5', at: asked2, by: 'u2', action: 'vault.request', entity: 'client', entityId: 'pc1' },
    { id: 'au4', at: after(asked3, 27), by: 'system', action: 'vault.expire', entity: 'client', entityId: 'pc6' },
    { id: 'au3', at: after(asked3, 12), by: 'u2', action: 'vault.approve', entity: 'client', entityId: 'pc6' },
    { id: 'au2', at: asked3, by: 'u1', action: 'vault.request', entity: 'client', entityId: 'pc6' },
    { id: 'au1', at: granted, by: 'u1', action: 'access.grant', entity: 'client', entityId: 'pc8' },
    { id: 'au0', at: stamp(-20, 10, 0), by: 'u1', action: 'member.role_changed', entity: 'user', entityId: 'u2', summary: 'staff > manager' },
  ];

  const newest = <T extends { at: string }>(list: T[]): T[] => [...list].sort((a, b) => b.at.localeCompare(a.at));
  return { reveals: newest(reveals), secureLog: newest(secureLog), accessRequests, grants, audit: newest(audit) };
}
