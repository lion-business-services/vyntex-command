// Unit tests for the rule engine (src/domain/rules): conditions, matching, every kind of step, once per record and
// occasion, the loop guard, a failing step staying inside its own rule, and the eight coded rules behaving exactly as
// they did before they were run through the engine (same tasks, messages and runs on the BUILD sample business).
// Also: the shipped rules of the practice edition are complete and safe, and review requests keep their three rules.
// Run with `npm run test:unit` (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, blank } from './bundle.mjs';

const m = await load(`
  export * as actions from '@/domain/actions';
  export * as engine from '@/domain/rules/engine';
  export * as fields from '@/domain/rules/fields';
  export * as steps from '@/domain/rules/steps';
  export * as manage from '@/domain/rules/manage';
  export { testCond, matches } from '@/domain/rules/conditions';
  export * as legacy from '@/domain/automations';
  export * as reviews from '@/domain/actions/reviews';
  export { runTimed, sweepsAvailable } from '@/domain/actions/daily';
  export { practiceRules } from '@/packs/practice/rules';
  export { PACKS } from '@/packs';
  export { loadSeed, seedOf } from '@/packs/seeds';
  export { makeT } from '@/i18n';
`);
const { actions, engine, fields, steps, manage, testCond, matches, legacy, reviews, runTimed, sweepsAvailable, practiceRules, PACKS, loadSeed, seedOf, makeT } = m;

const day = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const user = (id, role, more = {}) => ({ id, name: 'Person ' + id, role, email: id + '@example.com', active: true, ...more });
const clone = (v) => JSON.parse(JSON.stringify(v));

/** A small workspace of an edition: four people, one client with a completed job, one lead. No shipped rule runs unless a test adds it. */
function world(edition = 'practice', rules = []) {
  const pack = PACKS[edition];
  const d = blank(pack);
  d.users = [user('u1', 'owner'), user('u2', 'manager'), user('u3', 'staff'), user('u5', 'readonly')];
  d.clients = [{ id: 'c1', name: 'Dana Example', phone: '609-555-0142', email: 'dana@example.com', addresses: [], since: '2025-01-01', notes: [], kind: 'individual', assignedTo: 'u3', lang: 'en' }];
  d.jobs = [{ id: 'j1', number: 'X-1', name: 'Sample return', clientId: 'c1', address: '', type: pack.serviceTypes[0].id, status: 'done', price: 500, start: day(-30), end: day(-5), repeat: 'once', scope: '', payTerms: '', managerId: 'u3', assign: [], expenses: [], received: [], log: [], notes: [], created: day(-40) }];
  d.leads = [{ id: 'l1', ticket: 'T-1', name: 'Lee Sample', phone: '609-555-0111', email: 'lee@example.com', address: '', type: pack.serviceTypes[0].id, source: 'website', status: 'new', pri: 'medium', ownerId: 'u3', value: 1500, created: day(-2), notes: [] }];
  // every shipped rule switched off, so only the rules a test gives are in force
  d.rules = [...engine.shippedRules(pack).map((r) => ({ ...clone(r), active: false })), ...rules];
  const ctx = { pack, lang: 'en', t: makeT('en', pack), actor: 'u1' };
  return { d, ctx, pack };
}
const rule = (id, event, then, more = {}) => ({ id, name: { en: id, es: id }, active: true, when: { event, ...(more.days !== undefined ? { days: more.days } : {}) }, if: more.if ?? [], then });
const task = (title = 'Call {{lead.name}}', more = {}) => ({ do: 'task', params: { title, titleEs: 'Llamar a {{lead.name}}', for: 'owner', dueIn: 2, pri: 'high', ...more } });
const runsOf = (d, id) => d.automation.runs.filter((r) => r.ruleId === id);

/* ---------- conditions ---------- */

test('every operator', () => {
  const s = { lead: { source: 'website', value: 1500, serviceIds: ['s1', 's2'], company: '', smsOptIn: true, name: 'Lee Sample' }, client: { tags: ['VIP'], emailOptOut: undefined }, extra: { days: 4 } };
  const yes = (c) => assert.equal(testCond(c, s), true, JSON.stringify(c));
  const no = (c) => assert.equal(testCond(c, s), false, JSON.stringify(c));
  yes({ field: 'lead.source', op: 'is', value: 'website' }); yes({ field: 'lead.source', op: 'is', value: 'Website' }); no({ field: 'lead.source', op: 'is', value: 'phone' });
  yes({ field: 'lead.source', op: 'is_not', value: 'phone' }); no({ field: 'lead.source', op: 'is_not', value: 'website' });
  yes({ field: 'lead.source', op: 'in', value: ['phone', 'website'] }); no({ field: 'lead.source', op: 'in', value: ['phone', 'referral'] }); no({ field: 'lead.source', op: 'in', value: [] });
  yes({ field: 'lead.value', op: 'gt', value: 1000 }); no({ field: 'lead.value', op: 'gt', value: 1500 }); yes({ field: 'lead.value', op: 'lt', value: 2000 }); no({ field: 'lead.value', op: 'lt', value: 'abc' });
  yes({ field: 'lead.value', op: 'is', value: '1500' }); yes({ field: 'extra.days', op: 'gt', value: 3 });
  yes({ field: 'lead.serviceIds', op: 'has', value: 's2' }); no({ field: 'lead.serviceIds', op: 'has', value: 's9' }); yes({ field: 'lead.serviceIds', op: 'in', value: ['s9', 's1'] });
  yes({ field: 'client.tags', op: 'has', value: 'vip' }); yes({ field: 'lead.name', op: 'has', value: 'sample' });
  yes({ field: 'lead.company', op: 'empty' }); no({ field: 'lead.company', op: 'not_empty' }); yes({ field: 'lead.source', op: 'not_empty' }); yes({ field: 'lead.nothing', op: 'empty' });
  yes({ field: 'lead.smsOptIn', op: 'is', value: true }); no({ field: 'lead.smsOptIn', op: 'is', value: false });
  // a yes or no field that was never set reads as no
  yes({ field: 'client.emailOptOut', op: 'is', value: false }); no({ field: 'client.emailOptOut', op: 'is', value: true }); yes({ field: 'client.emailOptOut', op: 'is_not', value: true });
  // a record the event did not bring
  no({ field: 'job.price', op: 'gt', value: 1 }); yes({ field: 'job.status', op: 'is_not', value: 'done' }); no({ field: 'job.status', op: 'is', value: 'done' });
});

test('every condition has to hold, and a rule without conditions always matches', () => {
  const s = { lead: { source: 'website', value: 1500 } };
  assert.equal(matches({ if: [] }, s), true);
  assert.equal(matches({ if: [{ field: 'lead.source', op: 'is', value: 'website' }, { field: 'lead.value', op: 'gt', value: 1000 }] }, s), true);
  assert.equal(matches({ if: [{ field: 'lead.source', op: 'is', value: 'website' }, { field: 'lead.value', op: 'gt', value: 2000 }] }, s), false);
});

test('the field catalogue: every event has wording in English and Spanish, and so does every field and operator', () => {
  for (const lang of ['en', 'es']) {
    const t = makeT(lang, PACKS.practice);
    const known = (k) => assert.notEqual(t(k), k, `${lang}: ${k}`);
    for (const e of fields.EVENTS) {
      known('auto.ev.' + e.id); known('auto.group.' + e.group);
      for (const f of fields.fieldsFor(e.id)) { known('auto.f.' + f.path); for (const op of fields.OPERATORS[f.type]) known('auto.op.' + op); }
    }
    for (const s of steps.STEPS) { known('auto.stepName.' + s.do); for (const p of s.params) if (p.type !== 'pri') known('auto.p.' + p.k); }
  }
  // an edition only offers the events it has records for
  assert.ok(!fields.eventsFor(PACKS.build).some((e) => e.id.startsWith('appointment.')));
  assert.ok(fields.eventsFor(PACKS.practice).some((e) => e.id === 'appointment.booked'));
});

/* ---------- matching and running ---------- */

test('a rule runs for its event only, when it is on and its conditions hold, and writes one run', () => {
  const { d, ctx } = world('practice', [rule('r-web', 'lead.created', [task()], { if: [{ field: 'lead.source', op: 'is', value: 'website' }] })]);
  const lead = d.leads[0];
  engine.emit(d, ctx, 'lead.stage', { lead, extra: { from: 'new', to: 'contacted' } });
  assert.equal(d.automation.runs.length, 0, 'another event does not start it');
  engine.emit(d, ctx, 'lead.created', { lead: { ...lead, source: 'phone' } });
  assert.equal(d.automation.runs.length, 0, 'the condition does not hold');
  engine.emit(d, ctx, 'lead.created', { lead });
  assert.equal(d.automation.runs.length, 1);
  const run = d.automation.runs[0];
  assert.equal(run.ruleId, 'r-web'); assert.equal(run.status, 'ok'); assert.deepEqual(run.ref, { type: 'lead', id: 'l1' }); assert.ok(run.dedupe);
  assert.equal(d.tasks.length, 1);
  assert.equal(d.tasks[0].title, 'Call Lee Sample'); assert.equal(d.tasks[0].assignee, 'u:u1'); assert.equal(d.tasks[0].due, day(2)); assert.equal(d.tasks[0].pri, 'high'); assert.equal(d.tasks[0].leadId, 'l1');
});

test('a rule that is switched off does not run, by either switch', () => {
  const { d, ctx } = world('practice', [rule('r1', 'lead.created', [task()])]);
  d.rules.find((r) => r.id === 'r1').active = false;
  engine.emit(d, ctx, 'lead.created', { lead: d.leads[0] });
  assert.equal(d.tasks.length, 0);
  d.rules.find((r) => r.id === 'r1').active = true; d.automation.enabled.r1 = false;
  engine.emit(d, ctx, 'lead.created', { lead: d.leads[0] });
  assert.equal(d.tasks.length, 0);
  manage.setRuleActive(d, ctx, 'r1', true);
  engine.emit(d, ctx, 'lead.created', { lead: d.leads[0] });
  assert.equal(d.tasks.length, 1);
});

test('counted events: a rule waits for its own number of days, in the right direction', () => {
  const { d, ctx } = world('practice', [rule('idle', 'lead.idle', [task('Idle {{days}}')], { days: 3 }), rule('near', 'deadline.near', [task('Due in {{days}}: {{title}}')], { days: 14 })]);
  const lead = d.leads[0];
  engine.emit(d, ctx, 'lead.idle', { lead, extra: { days: 2, occasion: 'a' } });
  assert.equal(runsOf(d, 'idle').length, 0, 'two days is not three yet');
  engine.emit(d, ctx, 'lead.idle', { lead, extra: { days: 3, occasion: 'a' } });
  assert.equal(runsOf(d, 'idle').length, 1);
  engine.emit(d, ctx, 'deadline.near', { ref: { type: 'compliance', id: 'x1' }, extra: { days: 20, title: 'Filing', occasion: 'd' } });
  assert.equal(runsOf(d, 'near').length, 0, 'twenty days away is too early');
  engine.emit(d, ctx, 'deadline.near', { ref: { type: 'compliance', id: 'x1' }, extra: { days: 9, title: 'Filing', occasion: 'd' } });
  assert.equal(runsOf(d, 'near').length, 1);
  assert.ok(d.tasks.some((t) => t.title === 'Due in 9: Filing'));
});

/* ---------- once per record and occasion ---------- */

test('the same rule never runs twice for the same record and occasion', () => {
  const { d, ctx } = world('practice', [rule('r1', 'lead.created', [task(), { do: 'notify', params: { who: 'manager', text: 'New lead {{lead.name}}' } }])]);
  for (let i = 0; i < 3; i++) engine.emit(d, ctx, 'lead.created', { lead: d.leads[0] });
  assert.equal(runsOf(d, 'r1').length, 1); assert.equal(d.tasks.length, 1); assert.equal(d.messages.length, 1);
  // another record is another occasion
  const other = { ...d.leads[0], id: 'l2', name: 'Other Sample' }; d.leads.push(other);
  engine.emit(d, ctx, 'lead.created', { lead: other });
  assert.equal(runsOf(d, 'r1').length, 2); assert.equal(d.tasks.length, 2);
  // every run has its own key
  assert.equal(new Set(d.automation.runs.map((r) => r.dedupe)).size, d.automation.runs.length);
});

test('what a rule created still counts after its run has left the history', () => {
  const { d, ctx } = world('practice', [rule('r1', 'lead.created', [task()])]);
  engine.emit(d, ctx, 'lead.created', { lead: d.leads[0] });
  d.automation.runs = [];
  engine.emit(d, ctx, 'lead.created', { lead: d.leads[0] });
  assert.equal(d.tasks.length, 1); assert.equal(d.automation.runs.length, 0);
});

test('a stage change is one occasion per stage', () => {
  const { d, ctx } = world('practice', [rule('r1', 'lead.stage', [task('Stage task')])]);
  const lead = d.leads[0];
  engine.emit(d, ctx, 'lead.stage', { lead, extra: { from: 'new', to: 'contacted' } });
  engine.emit(d, ctx, 'lead.stage', { lead, extra: { from: 'new', to: 'contacted' } });
  engine.emit(d, ctx, 'lead.stage', { lead, extra: { from: 'contacted', to: 'proposal' } });
  assert.equal(runsOf(d, 'r1').length, 2);
});

/* ---------- loop guard ---------- */

test('a rule whose own change announces its event again does not run for ever', () => {
  const { d, ctx } = world('practice', [
    rule('to-contacted', 'lead.stage', [{ do: 'stage', params: { stage: 'contacted' } }, task('After the move')]),
    rule('to-new', 'lead.stage', [{ do: 'stage', params: { stage: 'new' } }]),
  ]);
  const lead = d.leads[0];
  // moving the stage goes through the lead action, which announces lead.stage again: two rules that undo each other
  actions.setLeadStage(d, ctx, lead.id, 'contacted');
  assert.ok(d.automation.runs.length <= 8, `runs: ${d.automation.runs.length}`);
  assert.ok(d.automation.runs.every((r) => r.status !== 'failed'), JSON.stringify(d.automation.runs.map((r) => [r.ruleId, r.status, r.error])));
  assert.ok(['new', 'contacted'].includes(lead.status));
  // one task per stage the lead arrived at, at most: never one per pass round the circle
  assert.ok(d.tasks.filter((t) => t.title === 'After the move').length <= 2);
  // and doing it all again adds nothing
  const runs = d.automation.runs.length; const tasks = d.tasks.length;
  actions.setLeadStage(d, ctx, lead.id, lead.status === 'new' ? 'contacted' : 'new');
  assert.ok(d.automation.runs.length - runs <= 4 && d.tasks.length === tasks);
});

test('events more than a few levels deep are dropped', () => {
  assert.ok(engine.MAX_DEPTH >= 2 && engine.MAX_DEPTH <= 5);
});

/* ---------- a failing step ---------- */

test('a failing step stops its own rule, is written down with the reason, and the other rules still run', () => {
  const { d, ctx } = world('practice', [
    rule('bad', 'lead.created', [task('First'), { do: 'opportunity', params: { serviceId: 'no-such-service' } }, task('Never reached')]),
    rule('good', 'lead.created', [task('Good one')]),
    rule('odd', 'lead.created', [{ do: 'envelope', params: {} }]),
  ]);
  d.clients[0].id = 'c1'; const lead = { ...d.leads[0], clientId: 'c1' };
  assert.doesNotThrow(() => engine.emit(d, ctx, 'lead.created', { lead, client: d.clients[0] }));
  const bad = runsOf(d, 'bad')[0];
  assert.equal(bad.status, 'failed'); assert.equal(bad.error, 'auto.err.noService');
  assert.ok(d.tasks.some((t) => t.title === 'First')); assert.ok(!d.tasks.some((t) => t.title === 'Never reached'));
  assert.equal(runsOf(d, 'good')[0].status, 'ok'); assert.ok(d.tasks.some((t) => t.title === 'Good one'));
  assert.equal(runsOf(d, 'odd')[0].status, 'failed'); assert.equal(runsOf(d, 'odd')[0].error, 'auto.err.unsupported');
  // a rule that failed today is not tried again on the next event of the same occasion
  engine.emit(d, ctx, 'lead.created', { lead, client: d.clients[0] });
  assert.equal(runsOf(d, 'bad').length, 1);
  // the reasons are in the dictionary in both languages
  for (const lang of ['en', 'es']) for (const k of ['auto.err.noService', 'auto.err.unsupported', 'auto.err.noTitle', 'auto.err.noBody', 'auto.err.noStage', 'auto.err.noTag', 'auto.err.noBuiltin', 'auto.err.unknown', 'auto.step.failed']) assert.notEqual(makeT(lang, PACKS.practice)(k), k);
});

test('emit never throws, whatever it is given', () => {
  const { d, ctx } = world('practice', [rule('r1', 'lead.created', [task()])]);
  assert.doesNotThrow(() => engine.emit(d, ctx, 'lead.created', {}));
  assert.doesNotThrow(() => engine.emit(d, ctx, 'no.such.event', { lead: d.leads[0] }));
  d.rules.push({ id: 'broken' });
  assert.doesNotThrow(() => engine.emit(d, ctx, 'lead.created', { lead: d.leads[0] }));
});

/* ---------- each kind of step ---------- */

test('step: task, in the language of the workspace, for the owner, the manager, the record owner or a named person', () => {
  const { d, ctx } = world('practice', [rule('r1', 'lead.created', [task('Call {{lead.name}}', { for: 'owner' }), task('M {{first_name}}', { for: 'manager', type: 'call', titleEs: 'M {{first_name}}' }), task('R', { for: 'record_owner', dueIn: 0, titleEs: '' }), task('N', { for: 'user:u5', titleEs: 'N es' })])]);
  engine.emit(d, { ...ctx, lang: 'es', t: makeT('es', ctx.pack) }, 'lead.created', { lead: d.leads[0] });
  const by = (title) => d.tasks.find((t) => t.title === title);
  assert.equal(by('Llamar a Lee Sample').assignee, 'u:u1');
  assert.equal(by('Llamar a Lee Sample').auto.startsWith('r1|lead:l1|'), true);
  assert.equal(d.tasks.filter((t) => t.assignee === 'u:u2').length, 1); assert.equal(d.tasks.find((t) => t.assignee === 'u:u2').type, 'call');
  assert.equal(d.tasks.filter((t) => t.assignee === 'u:u3').length, 1, 'the lead owner'); assert.equal(d.tasks.find((t) => t.assignee === 'u:u3').due, day(0));
  assert.equal(d.tasks.filter((t) => t.assignee === 'u:u5').length, 1);
});

test('step: message is prepared as a draft through queueMessage, in the person\'s language, and respects opt-outs', () => {
  const msg = { do: 'message', params: { channel: 'email', mode: 'draft', subject: 'Hello {{first_name}}', subjectEs: 'Hola {{first_name}}', body: 'From {{company}}', bodyEs: 'De {{company}}' } };
  const { d, ctx } = world('practice', [rule('r1', 'job.completed', [msg]), rule('r2', 'job.completed', [{ do: 'message', params: { channel: 'text', mode: 'draft', body: 'Hi' } }])]);
  const job = d.jobs[0]; const client = d.clients[0]; client.lang = 'es';
  engine.emit(d, ctx, 'job.completed', { ref: { type: 'job', id: job.id }, job, client });
  const run = runsOf(d, 'r1')[0];
  const mine = d.messages.filter((x) => (x.auto ?? '').startsWith('r1|'));
  if (run.status === 'ok') {
    assert.equal(mine.length, 1); assert.equal(mine[0].status, 'draft'); assert.equal(mine[0].subject, 'Hola Dana'); assert.equal(mine[0].body, 'De Sample Test Co'); assert.equal(mine[0].to, 'dana@example.com');
  } else {
    // the communications module answered "not available": the rule says why and nothing is written
    assert.equal(run.status, 'skipped'); assert.equal(mine.length, 0); assert.match(run.steps[0].key, /^auto\.skip\./);
  }
  // no consent for texts on record: nothing is prepared, and the run says so
  assert.equal(runsOf(d, 'r2')[0].status, 'skipped'); assert.equal(runsOf(d, 'r2')[0].steps[0].key, 'auto.skip.no_consent');
  // opted out of emails
  const again = world('practice', [rule('r1', 'job.completed', [msg])]);
  again.d.clients[0].emailOptOut = true;
  engine.emit(again.d, again.ctx, 'job.completed', { job: again.d.jobs[0], client: again.d.clients[0] });
  assert.equal(again.d.messages.length, 0); assert.equal(runsOf(again.d, 'r1')[0].steps[0].key, 'auto.skip.opted_out');
});

test('step: notify leaves a note for the person inside the company', () => {
  const { d, ctx } = world('practice', [rule('r1', 'lead.won', [{ do: 'notify', params: { who: 'manager', text: '{{lead.name}} is now a client' } }])]);
  engine.emit(d, ctx, 'lead.won', { lead: d.leads[0], client: d.clients[0], job: d.jobs[0] });
  assert.equal(d.messages.length, 1);
  assert.equal(d.messages[0].channel, 'system'); assert.equal(d.messages[0].to, 'Person u2'); assert.equal(d.messages[0].body, 'Lee Sample is now a client'); assert.equal(d.messages[0].read, false);
  assert.deepEqual(runsOf(d, 'r1')[0].steps, [{ key: 'auto.step.notify', params: { who: 'Person u2' } }]);
});

test('step: assign hands the lead over and keeps the trail', () => {
  const { d, ctx } = world('practice', [rule('r1', 'lead.created', [{ do: 'assign', params: { to: 'user:u2' } }])]);
  engine.emit(d, ctx, 'lead.created', { lead: d.leads[0] });
  assert.equal(d.leads[0].ownerId, 'u2'); assert.equal(d.leads[0].handoffs.at(-1).how, 'rule'); assert.equal(d.leads[0].originalOwnerId, 'u3');
});

test('step: stage moves a lead to a stage and a job to a status', () => {
  const { d, ctx } = world('practice', [rule('r1', 'lead.created', [{ do: 'stage', params: { stage: 'contacted' } }]), rule('r2', 'job.created', [{ do: 'stage', params: { status: 'hold' } }])]);
  engine.emit(d, ctx, 'lead.created', { lead: d.leads[0] });
  assert.equal(d.leads[0].status, 'contacted');
  d.jobs[0].status = 'progress';
  engine.emit(d, ctx, 'job.created', { job: d.jobs[0], client: d.clients[0] });
  assert.equal(d.jobs[0].status, 'hold');
});

test('step: document asks the documents module, and says so when no document could be made', () => {
  const { d, ctx } = world('practice', [rule('r1', 'job.created', [{ do: 'document', params: { kind: 'engagement_letter' } }])]);
  const before = d.docs.length;
  engine.emit(d, ctx, 'job.created', { job: d.jobs[0], client: d.clients[0] });
  const run = runsOf(d, 'r1')[0];
  if (run.status === 'ok') { assert.equal(d.docs.length, before + 1); assert.equal(d.docs[0].kind, 'engagement_letter'); assert.equal(run.steps[0].key, 'auto.step.doc'); }
  else { assert.equal(run.status, 'skipped'); assert.equal(run.steps[0].key, 'auto.skip.doc'); assert.equal(d.docs.length, before); }
});

test('step: playbook starts the tasks of the service, once', () => {
  const { d, ctx } = world('practice', [rule('r1', 'job.created', [{ do: 'playbook', params: {} }])]);
  d.playbooks = [{ id: 'pb1', name: 'Sample playbook', active: true, steps: [{ id: 's1', title: { en: 'Ask for documents', es: 'Pedir documentos' }, dueIn: 1, for: 'assignee' }, { id: 's2', title: { en: 'Review', es: 'Revisar' }, dueIn: 3, for: 'manager' }] }];
  d.catalog = [{ id: 'sv1', name: 'Sample service', category: 'Tax', active: true, tiers: [{ id: 't1', name: 'Standard', price: 200, unit: 'flat' }], playbookId: 'pb1' }];
  d.jobs[0].serviceId = 'sv1'; d.jobs[0].status = 'progress';
  engine.emit(d, ctx, 'job.created', { job: d.jobs[0], client: d.clients[0] });
  const run = runsOf(d, 'r1')[0];
  if (run.status === 'ok') { assert.equal(d.tasks.length, 2); assert.deepEqual(run.steps, [{ key: 'auto.step.tasks', params: { n: 2 } }]); }
  else assert.equal(run.steps[0].key, 'auto.skip.playbook');
  // a job without a playbook: nothing to start, and the run says so
  const w2 = world('practice', [rule('r1', 'job.created', [{ do: 'playbook', params: {} }])]);
  engine.emit(w2.d, w2.ctx, 'job.created', { job: w2.d.jobs[0], client: w2.d.clients[0] });
  assert.equal(runsOf(w2.d, 'r1')[0].status, 'skipped'); assert.equal(w2.d.tasks.length, 0);
});

test('step: opportunity opens one for the client and the service, never a second', () => {
  const { d, ctx } = world('practice', [rule('r1', 'job.completed', [{ do: 'opportunity', params: { serviceId: 'sv2', note: 'Ask about payroll' } }])]);
  d.catalog = [{ id: 'sv2', name: 'Payroll', category: 'Payroll', active: true, tiers: [{ id: 't1', name: 'Standard', price: 90, unit: 'month' }] }];
  engine.emit(d, ctx, 'job.completed', { job: d.jobs[0], client: d.clients[0] });
  assert.equal(d.opportunities.length, 1); assert.equal(d.opportunities[0].clientId, 'c1'); assert.equal(d.opportunities[0].serviceId, 'sv2'); assert.equal(d.opportunities[0].status, 'open');
  engine.emit(d, ctx, 'job.completed', { job: { ...d.jobs[0], id: 'j2' }, client: d.clients[0] });
  assert.equal(d.opportunities.length, 1);
});

test('step: review prepares a request, never sends one', () => {
  const { d, ctx } = world('practice', [rule('r1', 'review.due', [{ do: 'review', params: { channel: 'email' } }])]);
  engine.emit(d, ctx, 'review.due', { job: d.jobs[0], client: d.clients[0], extra: { days: 5, threshold: 3 } });
  assert.equal(d.reviews.length, 1); assert.equal(d.reviews[0].status, 'draft'); assert.equal(d.reviews[0].jobId, 'j1'); assert.equal(d.reviews[0].by, 'automation');
  assert.ok(d.messages.every((x) => x.status === 'draft'));
  engine.emit(d, ctx, 'review.due', { job: d.jobs[0], client: d.clients[0], extra: { days: 6, threshold: 3 } });
  assert.equal(d.reviews.length, 1, 'never twice for the same engagement');
});

test('step: tag adds a tag to the client once', () => {
  const { d, ctx } = world('practice', [rule('r1', 'payment.received', [{ do: 'tag', params: { tag: 'Paid on time' } }])]);
  const pay = (id) => ({ id, date: day(0), method: 'cash', ref: '', amount: 10 });
  engine.emit(d, ctx, 'payment.received', { job: d.jobs[0], client: d.clients[0], payment: pay('p1') });
  engine.emit(d, ctx, 'payment.received', { job: d.jobs[0], client: d.clients[0], payment: pay('p2') });
  assert.deepEqual(d.clients[0].tags, ['Paid on time']);
  assert.equal(runsOf(d, 'r1').length, 1, 'the second payment had nothing to add, so nothing is written down');
});

test('step: builtin runs the coded rule, and a company can add steps around it', () => {
  const { d, ctx } = world('build');
  const r = d.rules.find((x) => x.id === 'lead-intake'); r.active = true; r.then.push(task('Extra step for {{lead.name}}'));
  const lead = actions.createLead(d, ctx, { name: 'Quinn Tester', phone: '609-555-0199', email: 'quinn@example.com', address: '', type: ctx.pack.serviceTypes[0].id, source: 'website', pri: 'medium', value: null, ownerId: '' });
  const run = runsOf(d, 'lead-intake')[0];
  assert.deepEqual(run.steps.map((s) => s.key), ['auto.step.owner', 'auto.step.followUp', 'auto.step.task', 'auto.step.task']);
  assert.ok(d.tasks.some((t) => t.auto === 'lead-intake:' + lead.id)); assert.ok(d.tasks.some((t) => t.title === 'Extra step for Quinn Tester'));
  assert.equal(runsOf(d, 'lead-intake').length, 1, 'the lead action and the engine together announce it once');
});

/* ---------- the eight coded rules behave as before ---------- */

/** The automation entry exactly as it was before the engine: every coded rule for the event, in order, one run each. */
function legacyEmit(d, ctx, e) {
  for (const r of legacy.RULES) {
    if (r.trigger !== e.type) continue;
    if (d.automation.enabled[r.id] === false) continue;
    const res = r.run(d, ctx, e);
    if (!res || !res.steps.length) continue;
    d.automation.runs.unshift({ ruleId: r.id, steps: res.steps, ref: res.ref });
  }
}
const strip = (list, drop) => list.map((x) => { const y = { ...x }; for (const k of drop) delete y[k]; return y; });
/** Everything the coded rules can touch, without the ids and stamps that differ by nature. */
const picture = (d) => ({
  tasks: strip(d.tasks, ['id']), messages: strip(d.messages, ['id', 'at']), docs: strip(d.docs, ['id']), leads: d.leads, jobs: d.jobs,
  runs: d.automation.runs.map((r) => ({ ruleId: r.ruleId, steps: r.steps, ref: r.ref })),
  activity: strip(d.activity, ['id', 'at']),
});

for (const edition of ['build', 'clean', 'events']) {
  test(`the coded rules give the same tasks, messages, documents and runs as before on the ${edition} sample business`, async () => {
    const pack = PACKS[edition];
    await loadSeed(edition);
    const seed = seedOf(edition)('en');
    const base = { ...blank(pack), ...clone(seed), rules: clone(pack.rules) };
    base.automation = { enabled: {}, runs: [] };
    const a = clone(base), b = clone(base);
    const ctx = { pack, lang: 'en', t: makeT('en', pack), actor: base.users[0].id };
    const stage = (role) => pack.leadStages.find((s) => s.role === role)?.id;
    const events = (d) => {
      const L = (pred) => d.leads.find(pred); const J = (pred) => d.jobs.find(pred);
      const visit = L((l) => l.status === stage('visit') && l.apptDate); const proposal = L((l) => l.status === stage('proposal'));
      const fresh = L((l) => l.status === stage('new')); const won = L((l) => l.jobId && d.jobs.some((j) => j.id === l.jobId));
      const started = J((j) => j.status === 'progress'); const done = J((j) => j.status === 'done'); const paid = J((j) => j.received.length > 0);
      return [
        fresh && { type: 'lead.created', lead: fresh }, visit && { type: 'lead.stage', lead: visit, from: stage('new') }, proposal && { type: 'lead.stage', lead: proposal, from: stage('new') },
        won && { type: 'lead.won', lead: won, job: d.jobs.find((j) => j.id === won.jobId) }, started && { type: 'job.status', job: started, from: 'contract' }, done && { type: 'job.status', job: done, from: 'progress' },
        // the same events a second time: nothing may double
        started && { type: 'job.status', job: started, from: 'hold' }, paid && { type: 'payment.received', job: paid, amount: paid.received[paid.received.length - 1].amount }, { type: 'daily' }, { type: 'daily' },
      ].filter(Boolean);
    };
    const ea = events(a), eb = events(b);
    assert.ok(ea.length >= 8, `events: ${ea.length}`);
    for (let i = 0; i < ea.length; i++) { legacy.emit(a, ctx, ea[i]); legacyEmit(b, ctx, eb[i]); }
    const pa = picture(a), pb = picture(b);
    assert.ok(pb.runs.length >= 5, `runs: ${pb.runs.length}`);
    assert.deepEqual(pa.runs, pb.runs); assert.deepEqual(pa.tasks, pb.tasks); assert.deepEqual(pa.messages, pb.messages); assert.deepEqual(pa.docs, pb.docs);
    assert.deepEqual(pa.leads, pb.leads); assert.deepEqual(pa.jobs, pb.jobs); assert.deepEqual(pa.activity, pb.activity);
    // switched off, a coded rule stays off in the engine too
    const c = clone(base); c.automation.enabled['lead-intake'] = false;
    legacy.emit(c, ctx, events(c)[0]);
    assert.equal(c.automation.runs.length, 0);
  });
}

test('the field editions ship exactly the eight coded rules, each as one builtin step', () => {
  const rules = engine.shippedRules(PACKS.build);
  assert.deepEqual(rules.map((r) => r.id), legacy.RULES.map((r) => r.id));
  for (const r of rules) { assert.deepEqual(r.then, [{ do: 'builtin', params: { rule: r.id } }]); assert.equal(r.when.event, legacy.RULES.find((x) => x.id === r.id).trigger); }
});

test('a fresh sample: the starting emails are prepared as before and no run is typed in', async () => {
  const pack = PACKS.build; await loadSeed('build');
  const d = { ...blank(pack), ...clone(seedOf('build')('en')), rules: clone(pack.rules) }; d.automation = { enabled: {}, runs: [] };
  const ctx = { pack, lang: 'en', t: makeT('en', pack), actor: d.users[0].id };
  legacy.primeDemo(d, ctx);
  assert.ok(d.messages.length >= 1 && d.messages.length <= 3); assert.ok(d.messages.every((x) => x.status === 'draft'));
  assert.equal(d.automation.runs.length, 0, 'BUILD has no rule that counts days');
});

/* ---------- the practice edition ---------- */

test('the practice edition: every shipped rule is complete, named in both languages and never sends to a client by itself', () => {
  const ids = new Set();
  for (const r of practiceRules) {
    assert.ok(!ids.has(r.id), 'unique id ' + r.id); ids.add(r.id);
    assert.ok(r.name.en && r.name.es, r.id); assert.equal(r.shipped, true);
    assert.equal(manage.ruleProblem(r), null, `${r.id}: ${JSON.stringify(manage.ruleProblem(r))}`);
    assert.ok(fields.eventDef(r.when.event), `${r.id}: event ${r.when.event}`);
    for (const c of r.if) assert.ok(fields.fieldDef(r.when.event, c.field), `${r.id}: field ${c.field}`);
    const builtin = r.then.some((s) => s.do === 'builtin');
    if (!builtin) assert.ok(r.about?.en && r.about?.es, r.id + ' has a one-line description');
    for (const s of r.then) {
      if (s.do === 'message') { assert.equal(s.params.mode, 'draft', r.id + ' prepares a draft'); assert.ok(s.params.bodyEs && s.params.subjectEs, r.id + ' is written in Spanish too'); }
      if (s.do === 'task') assert.ok(s.params.titleEs, r.id);
      for (const v of Object.values(s.params)) if (typeof v === 'string') assert.ok(!/[—–]/.test(v), r.id + ': no long dashes');
    }
    for (const lang of ['en', 'es']) assert.equal(makeT(lang, PACKS.practice)(`auto.${r.id}.name`) !== `auto.${r.id}.name`, true, `${r.id} has a name in the dictionary (${lang})`);
  }
  // the seven coded rules a practice has, unchanged, plus the ones written as data
  const coded = practiceRules.filter((r) => r.then.some((s) => s.do === 'builtin')).map((r) => r.id);
  assert.deepEqual(coded.sort(), legacy.RULES.map((r) => r.id).filter((id) => id !== 'compliance-watch').sort());
  assert.ok(practiceRules.length - coded.length >= 15);
  // they are in force for the edition whether or not its pack lists them
  assert.equal(engine.shippedRules(PACKS.practice).length, practiceRules.length);
});

test('the practice sample business: the history comes from the rules running on the sample records', async () => {
  const pack = PACKS.practice; await loadSeed('practice');
  const d = { ...blank(pack), rules: clone(pack.rules), ...clone(seedOf('practice')('en')) }; d.automation = { enabled: {}, runs: [] };
  const ctx = { pack, lang: 'en', t: makeT('en', pack), actor: d.users[0].id };
  const tasks = d.tasks.length;
  legacy.primeDemo(d, ctx);
  const runs = d.automation.runs.length;
  assert.ok(runs >= 3, `runs: ${runs}`);
  assert.ok(d.automation.runs.every((r) => r.status !== 'failed'), JSON.stringify(d.automation.runs.filter((r) => r.status === 'failed')));
  assert.ok(d.tasks.length > tasks);
  // nothing a rule wrote to a client left: every message it prepared is a draft, or a note to the team
  for (const x of d.messages.filter((y) => y.auto)) assert.ok(x.status === 'draft' || x.channel === 'system', `${x.auto}: ${x.status}`);
  // running the day again changes nothing
  actions.runDaily(d, ctx); const after = d.automation.runs.length; const t2 = d.tasks.length; const m2 = d.messages.length;
  actions.runDaily(d, ctx);
  assert.equal(d.automation.runs.length, after); assert.equal(d.tasks.length, t2); assert.equal(d.messages.length, m2);
  // two answered sample reviews, and the low one has its follow-up task
  const rated = d.reviews.filter((r) => r.status === 'rated');
  assert.equal(rated.length, 2);
  const low = rated.find((r) => r.rating <= reviews.LOW_RATING);
  assert.ok(low && d.tasks.some((t) => t.auto === 'review-low:' + low.id));
  assert.ok(d.reviews.some((r) => r.status === 'draft' && r.by === 'automation'), 'the review rule prepared a draft for the latest completed engagement');
});

test('the daily run calls the sweeps other modules export, when they exist', () => {
  const names = sweepsAvailable();
  for (const n of names) assert.ok(['sweepAppointments', 'sweepEnvelopes', 'evaluateCrossSell'].includes(n));
  const { d, ctx } = world('practice');
  assert.doesNotThrow(() => actions.runDaily(d, ctx));
});

/* ---------- changing rules ---------- */

test('saving, copying, resetting and deleting rules', () => {
  const { d, ctx, pack } = world('practice');
  d.rules = [];
  const bad = manage.saveRule(d, ctx, { id: '', name: { en: '', es: '' }, active: true, when: { event: 'lead.created' }, if: [], then: [task()] });
  assert.deepEqual(bad, { ok: false, problem: { what: 'name' } });
  const named = (r) => ({ ...r, id: '', name: { en: 'Mine', es: '' } });
  assert.deepEqual(manage.saveRule(d, ctx, named(rule('', 'lead.created', []))).problem, { what: 'step' });
  assert.deepEqual(manage.saveRule(d, ctx, named(rule('', 'lead.created', [task()], { if: [{ field: 'lead.source', op: 'is' }] }))).problem, { what: 'cond', at: 0 });
  assert.deepEqual(manage.saveRule(d, ctx, named(rule('', 'lead.created', [{ do: 'task', params: { title: '', for: 'owner' } }]))).problem, { what: 'param', at: 0, param: 'title' });
  const ok = manage.saveRule(d, ctx, named(rule('', 'lead.created', [task()])));
  assert.equal(ok.ok, true); assert.ok(ok.rule.id); assert.equal(ok.rule.name.es, 'Mine'); assert.equal(ok.rule.shipped, undefined);
  assert.equal(d.rules.length, engine.shippedRules(pack).length + 1, 'the first change writes the whole set into the company list');
  // a shipped rule: change it, see that it changed, put it back
  const shipped = d.rules.find((r) => r.id === 'p-lead-idle');
  assert.equal(engine.ruleChanged(pack, shipped), false);
  manage.saveRule(d, ctx, { ...shipped, when: { ...shipped.when, days: 7 } });
  assert.equal(engine.ruleChanged(pack, d.rules.find((r) => r.id === 'p-lead-idle')), true);
  assert.equal(d.rules.find((r) => r.id === 'p-lead-idle').shipped, true);
  manage.resetRule(d, ctx, 'p-lead-idle');
  assert.equal(d.rules.find((r) => r.id === 'p-lead-idle').when.days, 3);
  // copies start off, and a coded rule cannot be copied
  const copy = manage.duplicateRule(d, ctx, 'p-lead-idle', { en: 'Copy', es: 'Copia' });
  assert.equal(copy.active, false); assert.equal(copy.shipped, undefined); assert.notEqual(copy.id, 'p-lead-idle');
  assert.equal(manage.duplicateRule(d, ctx, 'lead-intake', { en: 'x', es: 'x' }), null);
  // only a company's own rule can be deleted
  assert.equal(manage.deleteRule(d, ctx, 'p-lead-idle'), false); assert.equal(manage.deleteRule(d, ctx, copy.id), true); assert.equal(manage.deleteRule(d, ctx, ok.rule.id), true);
  assert.equal(d.rules.length, engine.shippedRules(pack).length);
});

test('preview: which records on file a rule would catch', () => {
  const { d } = world('practice');
  d.leads.push({ ...d.leads[0], id: 'l2', source: 'phone' }, { ...d.leads[0], id: 'l3', source: 'website', created: day(-90) });
  const p = engine.previewRule(d, { when: { event: 'lead.created' }, if: [{ field: 'lead.source', op: 'is', value: 'website' }] });
  assert.equal(p.possible, true); assert.equal(p.total, 2, 'leads of the last 30 days'); assert.equal(p.hits.length, 1); assert.deepEqual(p.hits[0].ref, { type: 'lead', id: 'l1' });
  assert.equal(engine.previewRule(d, { when: { event: 'daily' }, if: [] }).possible, false);
});

/* ---------- review requests ---------- */

test('review requests: never before the work is complete, never twice, never a client who opted out', () => {
  const { d, ctx } = world('practice');
  d.jobs.push({ ...d.jobs[0], id: 'j2', status: 'progress', end: '' });
  assert.deepEqual(reviews.requestReview(d, ctx, { clientId: 'c1', jobId: 'j2', channel: 'email' }), { ok: false, reason: 'not_complete' });
  assert.deepEqual(reviews.requestReview(d, ctx, { clientId: 'nobody', channel: 'email' }), { ok: false, reason: 'no_client' });
  d.clients[0].emailOptOut = true;
  assert.deepEqual(reviews.requestReview(d, ctx, { clientId: 'c1', jobId: 'j1', channel: 'email' }), { ok: false, reason: 'opted_out' });
  assert.deepEqual(reviews.requestReview(d, ctx, { clientId: 'c1', jobId: 'j1', channel: 'text' }), { ok: false, reason: 'no_consent' });
  d.clients[0].emailOptOut = false;
  const first = reviews.requestReview(d, ctx, { clientId: 'c1', jobId: 'j1', channel: 'email' });
  assert.equal(first.ok, true); assert.equal(first.review.status, 'draft'); assert.ok(first.review.token.startsWith('sample-'));
  assert.deepEqual(reviews.requestReview(d, ctx, { clientId: 'c1', jobId: 'j1', channel: 'email' }), { ok: false, reason: 'already_asked' });
  // other completed work for the same client, right after: not yet
  d.jobs.push({ ...d.jobs[0], id: 'j3' });
  assert.deepEqual(reviews.requestReview(d, ctx, { clientId: 'c1', jobId: 'j3', channel: 'email' }), { ok: false, reason: 'asked_recently' });
  // a later period of a repeating engagement is the same engagement
  d.reviews[0].at = new Date(Date.now() - 200 * 86400000).toISOString();
  d.jobs.push({ ...d.jobs[0], id: 'j4', parentId: 'j1', repeat: 'monthly' });
  assert.deepEqual(reviews.requestReview(d, ctx, { clientId: 'c1', jobId: 'j4', channel: 'email' }), { ok: false, reason: 'already_asked' });
});

test('review requests: sending in a sample marks it as shown, an answer is recorded once, a low rating creates the follow-up', () => {
  const { d, ctx } = world('practice');
  assert.deepEqual(reviews.reviewStats(d), { total: 0, rated: 0, declined: 0, waiting: 0, average: null, counts: [0, 0, 0, 0, 0] });
  const r = reviews.requestReview(d, ctx, { clientId: 'c1', jobId: 'j1', channel: 'email' }).review;
  assert.equal(reviews.reviewStats(d).average, null, 'no rating, no average');
  const sent = reviews.sendReview(d, ctx, r.id);
  assert.equal(sent.ok, true); assert.equal(r.status, 'demo', 'a sample workspace never says sent');
  assert.equal(reviews.openReview(d, ctx, r.token).status, 'opened');
  assert.deepEqual(reviews.answerReview(d, ctx, r.token, { rating: 9 }), { ok: false, reason: 'invalid' });
  const out = reviews.answerReview(d, ctx, r.token, { rating: 2, comment: '  Slow answers.  ' });
  assert.equal(out.ok, true); assert.equal(out.low, true); assert.equal(r.status, 'rated'); assert.equal(r.comment, 'Slow answers.');
  assert.ok(out.task); assert.equal(out.task.assignee, 'u:u2', 'the manager'); assert.equal(out.task.pri, 'high'); assert.equal(out.task.clientId, 'c1');
  assert.deepEqual(reviews.answerReview(d, ctx, r.token, { rating: 5 }), { ok: false, reason: 'closed' });
  assert.equal(reviews.sweepReviews(d, ctx).length, 0, 'the follow-up exists once');
  assert.equal(reviews.reviewStats(d).average, 2);
  assert.deepEqual(reviews.answerReview(d, ctx, 'no-such-token', { rating: 5 }), { ok: false, reason: 'not_found' });
  // a high rating creates no task
  const w2 = world('practice'); const r2 = reviews.requestReview(w2.d, w2.ctx, { clientId: 'c1', jobId: 'j1', channel: 'email' }).review;
  const hi = reviews.answerReview(w2.d, w2.ctx, r2.token, { rating: 5 });
  assert.equal(hi.low, false); assert.equal(hi.task, undefined); assert.equal(w2.d.tasks.length, 0);
  // the public link is only ever a secure web address
  assert.equal(reviews.saveReviewSettings(w2.d, w2.ctx, { publicUrl: 'javascript:alert(1)' }), false);
  assert.equal(reviews.saveReviewSettings(w2.d, w2.ctx, { publicUrl: 'http://example.com/r' }), false);
  assert.equal(reviews.saveReviewSettings(w2.d, w2.ctx, { publicUrl: 'https://example.com/r', delayDays: 5 }), true);
  assert.deepEqual(reviews.reviewSettings(w2.d), { delayDays: 5, linkDays: 30, publicUrl: 'https://example.com/r' });
});

test('counted events of the day: an idle lead, an overdue task, completed work due for a review', () => {
  const { d, ctx } = world('practice', [rule('idle', 'lead.idle', [task('Idle {{lead.name}}')], { days: 1 }), rule('late', 'task.overdue', [{ do: 'notify', params: { who: 'manager', text: 'Late: {{task.title}}' } }], { days: 2 }), rule('rev', 'review.due', [{ do: 'review', params: { channel: 'email' } }])]);
  d.tasks.push({ id: 't1', title: 'Old task', assignee: 'u:u3', due: day(-3), status: 'todo', pri: 'medium', created: day(-9) }, { id: 't2', title: 'Recent task', assignee: 'u:u3', due: day(-1), status: 'todo', pri: 'medium', created: day(-9) });
  runTimed(d, ctx);
  assert.equal(runsOf(d, 'idle').length, 1); assert.equal(runsOf(d, 'late').length, 1); assert.equal(runsOf(d, 'rev').length, 1);
  assert.equal(d.messages.find((x) => x.channel === 'system').body, 'Late: Old task');
  runTimed(d, ctx);
  assert.equal(d.automation.runs.length, 3, 'the next run of the day adds nothing');
});
