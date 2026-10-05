// Unit tests for the service catalog side of the domain: the won-lead workflow (an existing client is reused, a second run
// changes nothing, the professional-services path and the field path), playbooks, repeating engagements that roll
// forward, the catalog import and the cross-sell rules. Run with `npm run test:unit` (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, blank } from './bundle.mjs';

const m = await load(`
  export { createLead, convertLead, createJob, setJobStatus, addClientPayment, startPlaybook, saveService, duplicateService, setServiceActive, deleteService, moveTier, linkExternalId, importCatalog,
    savePlaybook, evaluateCrossSell, saveCrossSellRule, addOpportunity, setOpportunityStatus, snoozeOpportunity, opportunityToLead, opportunityToEngagement, rollForward } from '@/domain/actions';
  export { wonLeadSteps, welcomeKey, fillWelcome } from '@/domain/workflows';
  export { shiftDate, periodFor, nextPeriod, fromService } from '@/domain/actions/jobs';
  export { playbookTasks, playbookStamp } from '@/domain/actions/catalog';
  export { ruleMatches, clientsMatching, clientServices } from '@/domain/actions/opportunities';
  export { PACKS } from '@/packs';
  export { seedOf, loadAllSeeds } from '@/packs/seeds';
  export { makeT } from '@/i18n';
`);
const { createLead, convertLead, createJob, setJobStatus, startPlaybook, saveService, duplicateService, setServiceActive, deleteService, moveTier, linkExternalId, importCatalog, savePlaybook,
  evaluateCrossSell, saveCrossSellRule, addOpportunity, setOpportunityStatus, snoozeOpportunity, opportunityToLead, opportunityToEngagement, wonLeadSteps, welcomeKey, fillWelcome,
  shiftDate, periodFor, nextPeriod, fromService, playbookTasks, playbookStamp, ruleMatches, clientsMatching, clientServices, PACKS, seedOf, loadAllSeeds, makeT } = m;

const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
const day = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return iso(x); };
const user = (id, role, more = {}) => ({ id, name: 'Person ' + id, role, email: id + '@example.com', active: true, ...more });
const tier = (id, price, unit = 'flat', name = 'Standard') => ({ id, name, price, unit });

/** A workspace with a small catalog: two playbooks, appointment types, and services that use them. Nothing here is a real service or price. */
function world(edition = 'practice', { catalog = true } = {}) {
  const pack = PACKS[edition];
  const d = blank(pack);
  d.users = [user('u1', 'owner'), user('u2', 'manager', { officeIds: ['o1'] }), user('u3', 'staff', { officeIds: ['o1'] }), user('u4', 'manager', { officeIds: ['o2'] })];
  d.offices = [{ id: 'o1', name: 'Main office', address: '1 Sample Way' }, { id: 'o2', name: 'Second office', address: '2 Sample Way' }];
  d.apptTypes = [{ id: 'at1', name: { en: 'First consultation', es: 'Primera consulta' }, minutes: 30, fee: 0, prepay: false, mode: 'office', active: true }];
  if (catalog) {
    d.playbooks = [
      { id: 'pb1', name: 'Return playbook', active: true, welcome: 'Hello {{name}}, welcome to {{company}} for your {{service}}. {{responsible}} is your contact.', welcomeI18n: { es: 'Hola, {{name}}: le damos la bienvenida a {{company}} para su {{service}}.' },
        steps: [
          { id: 's1', title: { en: 'Send the checklist', es: 'Enviar la lista' }, dueIn: 0, for: 'assignee', type: 'document', pri: 'high' },
          { id: 's2', title: { en: 'Check the draft', es: 'Revisar el borrador' }, dueIn: 10, for: 'manager', type: 'review' },
          { id: 's3', title: { en: 'Welcome call', es: 'Llamada de bienvenida' }, dueIn: 1, for: 'owner' },
        ] },
      { id: 'pb2', name: 'Monthly playbook', active: true, steps: [{ id: 's1', title: { en: 'Set up the file', es: 'Preparar el expediente' }, dueIn: 3, for: 'assignee' }] },
    ];
    d.catalog = [
      { id: 'sv-return', name: 'Sample return', category: 'tax', active: true, repeat: 'yearly', playbookId: 'pb1', docKinds: ['engagement_letter', 'service_order'], appointmentTypeId: 'at1', tiers: [tier('sv-return-t1', 180), tier('sv-return-t2', 320, 'flat', 'Larger')], i18n: { es: { name: 'Declaración de ejemplo' } } },
      { id: 'sv-books', name: 'Sample bookkeeping', category: 'bookkeeping', active: true, repeat: 'monthly', playbookId: 'pb2', docKinds: ['service_agreement'], tiers: [tier('sv-books-t1', 220, 'month')] },
      { id: 'sv-payroll', name: 'Sample payroll', category: 'payroll', active: true, repeat: 'monthly', tiers: [tier('sv-payroll-t1', 85, 'month')] },
      { id: 'sv-old', name: 'Sample retired service', category: 'other', active: false, tiers: [tier('sv-old-t1', 25)] },
    ];
  }
  const ctx = { pack, lang: 'en', t: makeT('en', pack), actor: 'u1' };
  return { d, ctx, pack };
}
const leadIn = (o = {}) => ({ name: 'Dana Example', phone: '609-555-0142', email: 'dana@example.com', address: '1 Sample Way', type: o.type ?? 'tax', source: 'phone', pri: 'medium', value: null, ownerId: 'u3', ...o });
const client = (id, o = {}) => ({ id, name: 'Dana Example', phone: '', email: '', addresses: [], since: '2025-01-01', notes: [], ...o });
/** Everything a second run could duplicate, counted. */
const counts = (d) => ({ clients: d.clients.length, jobs: d.jobs.length, tasks: d.tasks.length, docs: d.docs.length, messages: d.messages.length, activity: d.activity.length, opportunities: d.opportunities.length, runs: d.automation.runs.length });

/* ---------- the won-lead workflow ---------- */

test('the workflow steps are registered once, in the order of the brief', () => {
  assert.deepEqual(wonLeadSteps.map((s) => s.id), ['client', 'engagements', 'documents', 'playbook', 'welcome', 'appointment', 'opportunities', 'activity']);
});

test('practice: a won lead reuses the existing client and says so in the history', () => {
  const { d, ctx } = world();
  d.clients.push(client('c1', { email: 'DANA@example.com' }));
  const lead = createLead(d, ctx, leadIn({ serviceIds: ['sv-return'] }));
  const job = convertLead(d, ctx, lead.id);
  assert.equal(d.clients.length, 1, 'no second client record');
  assert.equal(job.clientId, 'c1');
  const linked = d.activity.filter((a) => a.kind === 'workflow.clientLinked');
  assert.equal(linked.length, 1);
  assert.deepEqual(linked[0].ref, { type: 'lead', id: lead.id });
  assert.ok(linked[0].also.some((r) => r.type === 'client' && r.id === 'c1'), 'the line shows on the client too');
});

test('practice: one engagement per service, each at its tier price, with playbook tasks, a kickoff task and a history line', () => {
  const { d, ctx } = world();
  const lead = createLead(d, ctx, leadIn({ serviceIds: ['sv-return', 'sv-books', 'sv-old'], value: 900, officeId: 'o1', kind: 'individual' }));
  const job = convertLead(d, ctx, lead.id);
  const jobs = d.jobs.filter((j) => j.leadId === lead.id);
  assert.deepEqual(jobs.map((j) => j.serviceId).sort(), ['sv-books', 'sv-return'], 'an engagement for each active service; the retired one is not sold again');
  assert.equal(job.serviceId, 'sv-return');
  assert.equal(job.price, 180, 'with several services each engagement takes its own tier price');
  assert.equal(job.unit, 'flat');
  assert.equal(job.period, String(new Date().getFullYear()), 'a yearly engagement is labelled with the year');
  const books = jobs.find((j) => j.serviceId === 'sv-books');
  assert.equal(books.price, 220);
  assert.equal(books.tierId, 'sv-books-t1');
  assert.equal(books.repeat, 'monthly');
  assert.equal(books.unit, 'month');
  assert.equal(books.clientId, job.clientId);
  assert.equal(books.managerId, job.managerId);
  assert.equal(books.officeId, 'o1');
  assert.equal(books.status, job.status);

  // the playbook of each service ran once and its tasks can be traced back to it
  const first = playbookTasks(d, job.id);
  assert.equal(first.length, 3);
  assert.ok(first.every((t) => t.auto.startsWith(playbookStamp('pb1', job.id)) && t.clientId === job.clientId));
  const byStep = Object.fromEntries(first.map((t) => [t.auto.split(':').pop(), t]));
  assert.equal(byStep.s1.assignee, 'u:' + job.managerId, 'a step for the assignee goes to the person responsible for the engagement');
  assert.equal(byStep.s1.type, 'document'); assert.equal(byStep.s1.pri, 'high'); assert.equal(byStep.s1.due, day(0));
  assert.equal(byStep.s2.assignee, 'u:u2', 'a step for a manager goes to the manager of the engagement\'s office');
  assert.equal(byStep.s2.due, day(10));
  assert.equal(byStep.s3.assignee, 'u:u1', 'a step for the owner goes to the owner');
  assert.equal(playbookTasks(d, books.id).length, 1);

  // the service asks for an appointment and the lead had none: a task, never a booked time
  const kickoff = d.tasks.filter((t) => (t.auto || '').startsWith('kickoff-appt:'));
  assert.equal(kickoff.length, 1);
  assert.equal(kickoff[0].title, 'Schedule the kickoff appointment');
  assert.equal(kickoff[0].clientId, job.clientId);
  assert.equal(d.appointments.length, 0, 'no appointment is booked for the client');

  const line = d.activity.find((a) => a.kind === 'workflow.won');
  assert.ok(line, 'the workflow leaves one line in the history');
  assert.equal(line.params.engagements, 2);
  assert.equal(line.params.tasks, 5, 'three and one playbook tasks plus the kickoff task');
  assert.ok(line.also.some((r) => r.type === 'client') && line.also.some((r) => r.type === 'job'));
  assert.equal(typeof ctx.t('act.workflow.won', line.params), 'string');
  assert.notEqual(ctx.t('act.workflow.won', line.params), 'act.workflow.won', 'the history line has wording');
});

test('practice: a single service keeps the value agreed on the lead', () => {
  const { d, ctx } = world();
  const lead = createLead(d, ctx, leadIn({ serviceIds: ['sv-return'], value: 250 }));
  const job = convertLead(d, ctx, lead.id);
  assert.equal(d.jobs.length, 1);
  assert.equal(job.price, 250);
});

test('practice: documents and the welcome draft cope with a module that is not available, and never create the same thing twice', () => {
  const { d, ctx } = world();
  const lead = createLead(d, ctx, leadIn({ serviceIds: ['sv-return'], lang: 'es' }));
  const job = convertLead(d, ctx, lead.id);
  // whatever the documents module answers today, one document per kind at most
  for (const kind of ['engagement_letter', 'service_order']) assert.ok(d.docs.filter((x) => x.jobId === job.id && x.kind === kind).length <= 1, kind);
  const made = d.docs.filter((x) => x.jobId === job.id && ['engagement_letter', 'service_order'].includes(x.kind)).length;
  const pending = d.activity.find((a) => a.kind === 'workflow.docsPending');
  assert.equal(made + (pending ? pending.params.n : 0), 2, 'each listed document is either prepared or reported as still to prepare');
  // exactly one welcome for the engagement, a draft, whoever prepared it (the playbook's message or the edition's email)
  const welcome = d.messages.filter((x) => x.auto === welcomeKey(job.id));
  assert.equal(welcome.length, 1);
  assert.equal(welcome[0].status, 'draft', 'a welcome is prepared for review, never sent');
});

test('the welcome message is filled from the client, the company and the service', () => {
  assert.equal(fillWelcome('Hello {{name}}, {{ company }} / {{service}} / {{unknown}}', { name: 'Dana', company: 'Sample Co', service: 'Sample return' }), 'Hello Dana, Sample Co / Sample return / {{unknown}}');
});

test('practice: running the workflow a second time changes nothing', () => {
  const { d, ctx } = world();
  d.crossSell.push({ id: 'r1', name: 'Books then payroll', whenServiceIds: ['sv-books'], suggestServiceId: 'sv-payroll', active: true });
  const lead = createLead(d, ctx, leadIn({ serviceIds: ['sv-return', 'sv-books'] }));
  const job = convertLead(d, ctx, lead.id);
  const c = d.clients.find((x) => x.id === job.clientId);
  assert.equal(d.opportunities.length, 1, 'the cross-sell rules looked at the new client');
  const before = counts(d); const price = job.price;
  job.price = 199;   // a person changed the price afterwards
  for (const step of wonLeadSteps) step.run(d, ctx, { lead, client: c, job, newClient: true });
  for (const step of wonLeadSteps) step.run(d, ctx, { lead, client: c, job, newClient: false });
  assert.deepEqual({ ...counts(d), activity: 0 }, { ...before, activity: 0 }, 'no second engagement, task, document, message or opportunity');
  assert.equal(d.activity.length - before.activity, 1, 'only the note that an existing client was linked, once');
  assert.equal(job.price, 199, 'a later run does not undo an edit');
  assert.notEqual(price, 199);
  // converting again returns the same engagement
  assert.equal(convertLead(d, ctx, lead.id).id, job.id);
  assert.deepEqual({ ...counts(d), activity: 0 }, { ...before, activity: 0 });
});

test('practice: a lead that already had an appointment gets no scheduling task, and the appointment is linked', () => {
  const { d, ctx } = world();
  const lead = createLead(d, ctx, leadIn({ serviceIds: ['sv-return'] }));
  d.appointments.push({ id: 'ap1', typeId: 'at1', leadId: lead.id, staffId: 'u3', date: day(2), time: '10:00', minutes: 30, mode: 'office', status: 'scheduled', fee: 0, created: new Date().toISOString(), createdBy: 'u3' });
  const job = convertLead(d, ctx, lead.id);
  assert.equal(d.tasks.filter((t) => (t.auto || '').startsWith('kickoff-appt:')).length, 0);
  assert.equal(d.appointments[0].clientId, job.clientId);
  assert.equal(d.appointments[0].jobId, job.id);
  // a visit date on the lead counts as well
  const other = createLead(d, ctx, leadIn({ name: 'Other Person', email: 'other@example.com', phone: '609-555-0143', serviceIds: ['sv-return'], apptDate: day(3) }));
  convertLead(d, ctx, other.id);
  assert.equal(d.tasks.filter((t) => (t.auto || '').startsWith('kickoff-appt:')).length, 0);
});

test('practice: a lead without a catalog service passes through as before', () => {
  const { d, ctx } = world();
  const lead = createLead(d, ctx, leadIn());
  const job = convertLead(d, ctx, lead.id);
  assert.equal(d.jobs.length, 1);
  assert.equal(job.serviceId, undefined);
  assert.equal(d.activity.filter((a) => a.kind.startsWith('workflow.')).length, 0, 'nothing to report');
  assert.ok(d.tasks.some((t) => (t.auto || '').startsWith('lead-won:' + job.id)), 'the kickoff tasks of the edition are created');
});

test('field edition: the kickoff tasks of the edition and its welcome email, exactly as before', () => {
  const { d, ctx, pack } = world('build', { catalog: false });
  const lead = createLead(d, ctx, leadIn({ type: pack.serviceTypes[0].id, value: 5000, ownerId: 'u2' }));
  const job = convertLead(d, ctx, lead.id);
  assert.equal(d.jobs.length, 1);
  assert.equal(job.price, 5000);
  const kick = d.tasks.filter((t) => (t.auto || '').startsWith('lead-won:' + job.id));
  assert.equal(kick.length, (pack.kickoffTasks.length || 3), 'one task per kickoff line of the edition');
  assert.equal(d.messages.filter((x) => x.auto === 'lead-won:' + job.id && x.status === 'draft').length, 1);
  assert.equal(d.tasks.filter((t) => (t.auto || '').startsWith('playbook:') || (t.auto || '').startsWith('kickoff-appt:')).length, 0);
  assert.equal(d.activity.filter((a) => a.kind.startsWith('workflow.')).length, 0);
  assert.equal(d.opportunities.length, 0);
  assert.equal(d.docs.length, 0, 'no document is prepared that the edition did not prepare before');
});

test('field edition with a catalog: the service playbook runs next to the edition\'s kickoff tasks', () => {
  const { d, ctx, pack } = world('clean');
  const lead = createLead(d, ctx, leadIn({ type: pack.serviceTypes[0].id, serviceIds: ['sv-books'], ownerId: 'u2' }));
  const job = convertLead(d, ctx, lead.id);
  assert.equal(job.serviceId, 'sv-books');
  assert.equal(playbookTasks(d, job.id).length, 1);
  assert.ok(d.tasks.some((t) => (t.auto || '').startsWith('lead-won:' + job.id)));
  assert.equal(d.jobs.filter((j) => j.parentId).length, 0);
});

/* ---------- playbooks ---------- */

test('startPlaybook creates the tasks once per engagement and dates them from the engagement start', () => {
  const { d, ctx } = world();
  d.clients.push(client('c1'));
  const job = createJob(d, ctx, { ...fromService(d, ctx, 'sv-return'), clientId: 'c1', status: 'estimate', start: day(20), managerId: 'u3', officeId: 'o2' });
  assert.equal(playbookTasks(d, job.id).length, 0, 'a proposal starts nothing');
  const made = startPlaybook(d, ctx, job.id);
  assert.equal(made.length, 3);
  assert.deepEqual(made.map((t) => t.due), [day(20), day(30), day(21)]);
  assert.equal(made[1].assignee, 'u:u4', 'the manager of the engagement\'s office');
  assert.deepEqual(startPlaybook(d, ctx, job.id), [], 'a second start creates nothing');
  assert.equal(d.tasks.filter((t) => t.jobId === job.id).length, 3);
  assert.equal(d.activity.filter((a) => a.kind === 'catalog.playbook').length, 1);
});

test('the playbook starts when an engagement moves past the proposal, and not for an inactive playbook', () => {
  const { d, ctx } = world();
  d.clients.push(client('c1'));
  const job = createJob(d, ctx, { ...fromService(d, ctx, 'sv-books'), clientId: 'c1', status: 'estimate' });
  setJobStatus(d, ctx, job.id, 'contract');
  assert.equal(playbookTasks(d, job.id).length, 1);
  setJobStatus(d, ctx, job.id, 'progress');
  assert.equal(playbookTasks(d, job.id).length, 1);
  d.playbooks.find((p) => p.id === 'pb1').active = false;
  const other = createJob(d, ctx, { ...fromService(d, ctx, 'sv-return'), clientId: 'c1', status: 'progress' });
  assert.equal(playbookTasks(d, other.id).length, 0);
  assert.equal(startPlaybook(d, ctx, 'no-such-job').length, 0);
});

test('savePlaybook keeps step ids, fills a missing language and drops empty steps', () => {
  const { d, ctx } = world();
  const p = savePlaybook(d, ctx, { name: ' New playbook ', active: true, welcome: ' Hi {{name}} ', steps: [{ title: { en: 'One', es: '' }, dueIn: 2.4, for: 'owner' }, { title: { en: '', es: '' }, dueIn: 1, for: 'owner' }] });
  assert.equal(p.name, 'New playbook'); assert.equal(p.welcome, 'Hi {{name}}');
  assert.equal(p.steps.length, 1);
  assert.deepEqual(p.steps[0].title, { en: 'One', es: 'One' });
  assert.equal(p.steps[0].dueIn, 2);
  const again = savePlaybook(d, ctx, { ...p, steps: [{ ...p.steps[0], title: { en: 'One', es: 'Uno' } }, { title: { en: 'Two', es: 'Dos' }, dueIn: 5, for: 'assignee', type: 'call' }] }, p.id);
  assert.equal(again.steps[0].id, p.steps[0].id);
  assert.equal(again.steps.length, 2);
  assert.equal(savePlaybook(d, ctx, { name: '  ', active: true, steps: [] }), null);
});

/* ---------- repeating engagements ---------- */

test('dates and periods move forward by the calendar', () => {
  assert.equal(shiftDate('2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(shiftDate('2026-11-15', 'quarterly'), '2027-02-15');
  assert.equal(shiftDate('2024-02-29', 'yearly'), '2025-02-28');
  assert.equal(shiftDate('2026-10-05', 'weekly'), '2026-10-12');
  assert.equal(shiftDate('2026-10-05', 'biweekly'), '2026-10-19');
  assert.equal(shiftDate('2026-10-05', 'once'), '2026-10-05');
  assert.equal(periodFor('yearly', '2026-10-05', 'en'), '2026');
  assert.equal(periodFor('quarterly', '2026-10-05', 'en'), 'Q4 2026');
  assert.equal(periodFor('monthly', '2026-10-05', 'es'), 'Octubre 2026');
  assert.equal(periodFor('once', '2026-10-05', 'en'), '');
  assert.equal(nextPeriod('2025', 'yearly', '2027-02-01', 'en'), '2026');
  assert.equal(nextPeriod('Q4 2026', 'quarterly', '2027-01-01', 'en'), 'Q1 2027');
  assert.equal(nextPeriod('Q3 2026', 'quarterly', '2026-10-01', 'en'), 'Q4 2026');
  assert.equal(nextPeriod('December 2026', 'monthly', '2027-01-01', 'en'), 'January 2027');
  assert.equal(nextPeriod('diciembre de 2026', 'monthly', '2027-01-01', 'es'), 'Enero de 2027');
  assert.equal(nextPeriod('2026-10-05', 'weekly', '2026-10-12', 'en'), '2026-10-12');
  assert.equal(nextPeriod('Fiscal year ending June', 'yearly', '2027-07-01', 'en'), '2027', 'a period that cannot be counted is named from the next start date');
  assert.equal(nextPeriod('2026', 'once', '2027-01-01', 'en'), '');
});

test('a completed repeating engagement rolls forward once, pointing back at the one it follows', () => {
  const { d, ctx } = world();
  d.clients.push(client('c1'));
  const job = createJob(d, ctx, { ...fromService(d, ctx, 'sv-books'), clientId: 'c1', status: 'progress', start: '2026-09-01', end: '2026-09-30', period: 'September 2026', managerId: 'u3', officeId: 'o1', scope: 'Sample scope', price: 240 });
  setJobStatus(d, ctx, job.id, 'done');
  const next = d.jobs.find((j) => j.parentId === job.id);
  assert.ok(next, 'the next period exists');
  assert.equal(next.period, 'October 2026');
  assert.equal(next.start, '2026-10-01'); assert.equal(next.end, '2026-10-30');
  assert.equal(next.status, 'progress');
  assert.equal(next.price, 240, 'the agreed price carries over, not the catalog price');
  assert.equal(next.serviceId, 'sv-books'); assert.equal(next.tierId, 'sv-books-t1'); assert.equal(next.unit, 'month');
  assert.equal(next.managerId, 'u3'); assert.equal(next.officeId, 'o1'); assert.equal(next.scope, 'Sample scope'); assert.equal(next.repeat, 'monthly');
  assert.equal(next.received.length, 0);
  assert.notEqual(next.number, job.number);
  assert.equal(playbookTasks(d, next.id).length, 1, 'the playbook starts for the new period');
  assert.equal(d.activity.filter((a) => a.kind === 'job.rolled').length, 1);
  // reopening and completing again does not create a second next period
  setJobStatus(d, ctx, job.id, 'progress'); setJobStatus(d, ctx, job.id, 'done');
  assert.equal(d.jobs.filter((j) => j.parentId === job.id).length, 1);
});

test('one-time work, a retired service and the field editions do not roll forward', () => {
  const { d, ctx } = world();
  d.clients.push(client('c1'));
  const once = createJob(d, ctx, { name: 'One-time work', clientId: 'c1', status: 'progress' });
  setJobStatus(d, ctx, once.id, 'done');
  const retired = createJob(d, ctx, { ...fromService(d, ctx, 'sv-payroll'), clientId: 'c1', status: 'progress', start: day(-30) });
  setServiceActive(d, ctx, 'sv-payroll', false);
  setJobStatus(d, ctx, retired.id, 'done');
  assert.equal(d.jobs.filter((j) => j.parentId).length, 0);
  assert.equal(d.activity.filter((a) => a.kind === 'job.notRolled').length, 1, 'the history says why there is no next period');

  const field = world('clean');
  field.d.clients.push(client('c1'));
  const weekly = createJob(field.d, field.ctx, { name: 'Weekly cleaning', clientId: 'c1', status: 'progress', repeat: 'weekly', start: day(-14) });
  setJobStatus(field.d, field.ctx, weekly.id, 'done');
  assert.equal(field.d.jobs.length, 1, 'a field job that repeats stays one job');
});

/* ---------- catalog ---------- */

test('saveService: validation, stable tier ids, order, and a tier linked to another system is never dropped', () => {
  const { d, ctx } = world();
  assert.equal(saveService(d, ctx, { name: '', category: 'tax', active: true, tiers: [{ name: 'A', price: 1, unit: 'flat' }] }), null, 'a service needs a name');
  assert.equal(saveService(d, ctx, { name: 'No tiers', category: 'tax', active: true, tiers: [{ name: ' ', price: 1, unit: 'flat' }] }), null, 'and at least one tier');
  const s = saveService(d, ctx, { name: ' Sample service ', category: 'tax', active: true, repeat: 'once', i18n: { es: { name: 'Servicio de ejemplo' }, zh: { name: ' ' } }, docKinds: ['engagement_letter', 'engagement_letter'],
    tiers: [{ name: 'Basic', price: 99.999, unit: 'flat' }, { name: 'Plus', price: -5, unit: 'nonsense' }] });
  assert.equal(s.name, 'Sample service');
  assert.equal(s.repeat, undefined);
  assert.deepEqual(Object.keys(s.i18n), ['es']);
  assert.deepEqual(s.docKinds, ['engagement_letter']);
  assert.deepEqual(s.tiers.map((t) => [t.name, t.price, t.unit]), [['Basic', 100, 'flat'], ['Plus', 0, 'flat']]);
  const [basic, plus] = s.tiers;
  assert.equal(linkExternalId(d, ctx, { serviceId: s.id, tierId: basic.id }, 'square', 'SQ-1'), true);
  assert.equal(linkExternalId(d, ctx, { serviceId: s.id, tierId: basic.id }, 'square', 'SQ-2'), false, 'insert only: an id on file is never replaced');
  assert.equal(s.tiers[0].externalIds.square, 'SQ-1');
  assert.equal(linkExternalId(d, ctx, { serviceId: s.id }, 'square', 'SQ-ITEM'), true);
  // reorder and rename: ids stay; the linked tier is left out of the form and is kept anyway
  const saved = saveService(d, ctx, { ...s, tiers: [{ id: plus.id, name: 'Plus renamed', price: 150, unit: 'month' }, { name: 'Third', price: 10, unit: 'hour' }] }, s.id);
  assert.equal(saved.tiers[0].id, plus.id); assert.equal(saved.tiers[0].name, 'Plus renamed');
  assert.equal(saved.tiers.length, 3);
  assert.equal(saved.tiers[2].id, basic.id, 'the tier that another system knows is still there');
  assert.equal(saved.externalIds.square, 'SQ-ITEM');
  moveTier(d, ctx, s.id, basic.id, -1);
  assert.equal(saved.tiers[1].id, basic.id);
  // a copy is a new service everywhere
  const copy = duplicateService(d, ctx, s.id);
  assert.notEqual(copy.id, s.id);
  assert.equal(copy.externalIds, undefined);
  assert.ok(copy.tiers.every((t) => !t.externalIds && !saved.tiers.some((x) => x.id === t.id)));
  assert.ok(copy.name.startsWith('Sample service ('));
});

test('a service in use is retired, not deleted; a retired one cannot be picked', () => {
  const { d, ctx } = world();
  d.clients.push(client('c1'));
  createJob(d, ctx, { ...fromService(d, ctx, 'sv-return'), clientId: 'c1', status: 'progress' });
  assert.equal(deleteService(d, ctx, 'sv-return'), false);
  setServiceActive(d, ctx, 'sv-return', false);
  assert.equal(d.catalog.find((s) => s.id === 'sv-return').active, false);
  assert.equal(d.jobs[0].serviceId, 'sv-return', 'the engagement keeps its service');
  assert.equal(deleteService(d, ctx, 'sv-old'), true);
  assert.equal(d.catalog.some((s) => s.id === 'sv-old'), false);
});

test('importCatalog previews without changing anything, then adds services and tiers and updates prices', () => {
  const { d, ctx } = world();
  const rows = [
    { category: 'tax', service: 'sample RETURN', tier: 'Standard', price: 195, unit: 'flat' },            // existing tier, new price
    { category: 'tax', service: 'Sample return', tier: 'Larger', price: 320, unit: 'flat' },              // unchanged
    { category: 'tax', service: 'Sample return', tier: 'Rush', price: 400, unit: 'flat', note: 'Two days' }, // new tier
    { category: 'advisory', service: 'Imported service', serviceEs: 'Servicio importado', tier: 'Hourly', price: 70, unit: 'HOUR', repeat: 'Monthly' },
    { category: 'advisory', service: 'Imported service', tier: 'Day', price: 500, unit: 'flat' },
    { category: 'tax', service: '', tier: 'x', price: 1, unit: 'flat' },
    { category: 'tax', service: 'Bad price', tier: 'x', price: NaN, unit: 'flat' },
  ];
  const before = JSON.stringify(d.catalog);
  const plan = importCatalog(d, ctx, rows, false);
  assert.deepEqual({ ...plan, skipped: plan.skipped.map((s) => s.line + ':' + s.reason) }, { newServices: 1, newTiers: 3, changedTiers: 1, unchanged: 1, skipped: ['7:name', '8:price'] });
  assert.equal(JSON.stringify(d.catalog), before, 'a preview changes nothing');
  const done = importCatalog(d, ctx, rows, true);
  assert.equal(done.newServices, 1);
  const ret = d.catalog.find((s) => s.id === 'sv-return');
  assert.deepEqual(ret.tiers.map((t) => [t.name, t.price]), [['Standard', 195], ['Larger', 320], ['Rush', 400]]);
  assert.equal(ret.tiers[0].id, 'sv-return-t1', 'an existing tier keeps its id');
  const fresh = d.catalog.find((s) => s.name === 'Imported service');
  assert.equal(fresh.i18n.es.name, 'Servicio importado'); assert.equal(fresh.repeat, 'monthly'); assert.equal(fresh.tiers.length, 2); assert.equal(fresh.tiers[0].unit, 'hour');
  // the same file again adds nothing
  const again = importCatalog(d, ctx, rows, true);
  assert.deepEqual([again.newServices, again.newTiers, again.changedTiers, again.unchanged], [0, 0, 0, 5]);
});

/* ---------- cross-sell ---------- */

function sold(d, ctx, clientId, serviceId, more = {}) { return createJob(d, ctx, { ...fromService(d, ctx, serviceId), clientId, status: 'progress', start: day(-40), ...more }); }

test('a rule suggests a service once: not when the client has it, has an "unless" service, is the wrong kind, or it is too early', () => {
  const { d, ctx } = world();
  d.clients.push(client('biz', { kind: 'business' }), client('biz2', { kind: 'business' }), client('person', { kind: 'individual' }), client('gone', { kind: 'business', lifecycle: 'former' }));
  const rule = saveCrossSellRule(d, ctx, { name: 'Books then payroll', whenServiceIds: ['sv-books', 'sv-payroll'], suggestServiceId: 'sv-payroll', unlessServiceIds: ['sv-old'], clientKind: 'business', delayDays: 30, note: 'Ask about payroll', active: true });
  assert.deepEqual(rule.whenServiceIds, ['sv-books'], 'the suggested service cannot trigger its own suggestion');
  sold(d, ctx, 'biz', 'sv-books'); sold(d, ctx, 'person', 'sv-books'); sold(d, ctx, 'gone', 'sv-books');
  sold(d, ctx, 'biz2', 'sv-books', { start: day(-5) });
  assert.deepEqual(clientsMatching(d, rule).map((c) => c.id), ['biz']);
  // creating the engagements already ran the rules for those clients
  assert.equal(d.opportunities.length, 1);
  const o = d.opportunities[0];
  assert.deepEqual([o.clientId, o.serviceId, o.ruleId, o.status, o.by, o.value, o.note], ['biz', 'sv-payroll', rule.id, 'open', 'automation', 85, 'Ask about payroll']);
  assert.deepEqual(evaluateCrossSell(d, ctx), [], 'running again creates no duplicate');
  // dismissed means do not suggest it again
  setOpportunityStatus(d, ctx, o.id, 'dismissed', 'Does payroll in house');
  assert.equal(o.dismissedReason, 'Does payroll in house');
  assert.deepEqual(evaluateCrossSell(d, ctx), []);
  // too early for biz2 today, due later
  const biz2 = d.clients.find((c) => c.id === 'biz2');
  assert.equal(ruleMatches(d, rule, biz2), false);
  assert.equal(ruleMatches(d, rule, biz2, day(26)), true);
  // an "unless" service, even one only proposed, blocks the suggestion
  createJob(d, ctx, { ...fromService(d, ctx, 'sv-old'), clientId: 'biz2', status: 'estimate' });
  assert.equal(ruleMatches(d, rule, biz2, day(26)), false);
  // a retired suggestion is offered to nobody; a rule for a service that does not exist cannot be saved
  setServiceActive(d, ctx, 'sv-payroll', false);
  assert.deepEqual(clientsMatching(d, rule), []);
  assert.equal(saveCrossSellRule(d, ctx, { name: 'Broken', whenServiceIds: [], suggestServiceId: 'no-such-service', active: true }), null);
});

test('a client who buys the suggested service settles the opportunity; a proposal does not count as having it', () => {
  const { d, ctx } = world();
  d.clients.push(client('c1', { kind: 'business' }));
  saveCrossSellRule(d, ctx, { name: 'Books then payroll', whenServiceIds: ['sv-books'], suggestServiceId: 'sv-payroll', active: true });
  createJob(d, ctx, { ...fromService(d, ctx, 'sv-books'), clientId: 'c1', status: 'estimate' });
  assert.equal(d.opportunities.length, 0, 'a proposal is not a service the client has');
  setJobStatus(d, ctx, d.jobs[0].id, 'progress');
  assert.equal(d.opportunities.length, 1);
  assert.deepEqual([...clientServices(d, 'c1').has.keys()], ['sv-books']);
  const job = sold(d, ctx, 'c1', 'sv-payroll');
  assert.equal(d.opportunities[0].status, 'won');
  assert.equal(d.opportunities[0].jobId, job.id);
});

test('an opportunity becomes a lead for the same client, or an engagement, once', () => {
  const { d, ctx, pack } = world();
  d.clients.push(client('c1', { kind: 'business', email: 'dana@example.com', phone: '609-555-0142', assignedTo: 'u3', officeId: 'o1', lang: 'es' }));
  const o = addOpportunity(d, ctx, { clientId: 'c1', serviceId: 'sv-return', note: 'Asked at the front desk' });
  assert.equal(addOpportunity(d, ctx, { clientId: 'c1', serviceId: 'sv-return' }).id, o.id, 'no second open opportunity for the same client and service');
  assert.equal(o.value, 180);
  const lead = opportunityToLead(d, ctx, o.id);
  assert.equal(opportunityToLead(d, ctx, o.id).id, lead.id);
  assert.equal(d.leads.length, 1);
  assert.deepEqual([lead.clientId, lead.serviceIds, lead.ownerId, lead.officeId, lead.kind, lead.lang, lead.value], ['c1', ['sv-return'], 'u3', 'o1', 'business', 'es', 180]);
  assert.ok(pack.leadSources.some((s) => s.id === lead.source));
  assert.equal(o.leadId, lead.id); assert.equal(o.status, 'contacted');
  // winning that lead reuses the client and wins the opportunity
  const job = convertLead(d, ctx, lead.id);
  assert.equal(d.clients.length, 1);
  assert.equal(o.status, 'won'); assert.equal(o.jobId, job.id);

  const p = addOpportunity(d, ctx, { clientId: 'c1', serviceId: 'sv-books' });
  snoozeOpportunity(d, ctx, p.id, day(14), true);
  assert.equal(p.followUp, day(14));
  assert.ok(d.tasks.some((t) => t.clientId === 'c1' && t.due === day(14) && t.assignee === 'u:u3'), 'a reminder for whoever looks after the client');
  const eng = opportunityToEngagement(d, ctx, p.id);
  assert.equal(opportunityToEngagement(d, ctx, p.id).id, eng.id);
  assert.deepEqual([eng.serviceId, eng.price, eng.repeat, eng.clientId, eng.managerId, eng.officeId, eng.status], ['sv-books', 220, 'monthly', 'c1', 'u3', 'o1', 'contract']);
  assert.equal(p.status, 'won'); assert.equal(p.followUp, undefined);
});

/* ---------- the sample business ---------- */

test('the practice sample: every rule points at services that exist and applies to a sample client; every opportunity is consistent', async () => {
  await loadAllSeeds();
  for (const lang of ['en', 'es']) {
    const pack = PACKS.practice;
    const d = { ...blank(pack), ...seedOf('practice')(lang) };
    const ids = new Set(d.catalog.map((s) => s.id));
    assert.ok(d.catalog.length >= 12 && d.catalog.length <= 16, `${d.catalog.length} services`);
    assert.ok(d.playbooks.length >= 2 && d.playbooks.length <= 3);
    for (const s of d.catalog) {
      assert.ok(s.i18n.en.name && s.i18n.es.name, `${s.id}: named in English and Spanish`);
      assert.ok(!s.playbookId || d.playbooks.some((p) => p.id === s.playbookId), `${s.id}: its playbook exists`);
      assert.equal(s.externalIds, undefined, 'a sample service is not connected to anything');
    }
    assert.ok(d.crossSell.length >= 3 && d.crossSell.length <= 4);
    for (const r of d.crossSell) {
      for (const id of [r.suggestServiceId, ...r.whenServiceIds, ...(r.unlessServiceIds || [])]) assert.ok(ids.has(id), `${r.id}: service ${id} exists`);
      const hit = d.clients.filter((c) => ruleMatches(d, r, c) || d.opportunities.some((o) => o.ruleId === r.id && o.clientId === c.id));
      assert.ok(hit.length > 0, `${r.id} applies to at least one sample client`);
    }
    assert.deepEqual([...new Set(d.opportunities.map((o) => o.status))].sort(), ['contacted', 'dismissed', 'open', 'won']);
    for (const o of d.opportunities) { assert.ok(ids.has(o.serviceId)); assert.ok(d.clients.some((c) => c.id === o.clientId)); assert.ok(!o.jobId || d.jobs.some((j) => j.id === o.jobId)); }
    assert.deepEqual([...new Set(d.jobs.map((j) => j.status))].sort(), ['contract', 'done', 'estimate', 'hold', 'progress'], 'an engagement in every status');
    for (const j of d.jobs) {
      const s = d.catalog.find((x) => x.id === j.serviceId);
      assert.ok(s, `${j.id}: its service exists`);
      assert.ok(s.tiers.some((t) => t.id === j.tierId), `${j.id}: its tier exists`);
      assert.ok(!j.parentId || d.jobs.some((x) => x.id === j.parentId && x.status === 'done' && x.clientId === j.clientId && x.serviceId === j.serviceId), `${j.id}: follows a completed period of the same service`);
    }
    assert.ok(d.jobs.some((j) => j.parentId) && d.jobs.some((j) => j.received.length), 'repeating engagements and payments');
    // running the rules on the untouched sample creates exactly the one suggestion nobody has seen yet
    const ctx = { pack, lang, t: makeT(lang, pack), actor: 'u1' };
    const made = evaluateCrossSell(d, ctx);
    assert.deepEqual(made.map((o) => [o.clientId, o.serviceId]), [['pc5', 's-advisory']]);
    assert.deepEqual(evaluateCrossSell(d, ctx), []);
  }
});
