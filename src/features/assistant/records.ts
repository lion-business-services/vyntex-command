// The built-in assistant and the newer records: appointments, the service catalog, engagements by service, opportunities,
// documents waiting for a signature, deadlines, credits and review requests. Same rules as engine.ts: it answers only from
// the records it is given (already narrowed to what the person may see), it says so when a screen is not part of the
// edition or the role, and anything that changes a record is a proposal a person confirms.
// It never reads, repeats or guesses a tax ID: a question about one gets a plain "I do not have that".
import type { Appointment, AppointmentType, Client, DemoState, Lead } from '@/domain/types';
import { moduleOn } from '@/domain/config';
import { isOpenLead } from '@/domain/selectors';
import { addDays, daysBetween, today } from '@/lib/dates';
import { money, sum } from '@/lib/money';
import { askProblem, askableJobs, reviewStats, type ReviewRecord } from '@/domain/actions/reviews';
import { NAME_LEAD, NAME_TRAIL, Work, best, fold, rank, takeDate, takeTime, tidy, words, type Candidate } from './text';
import { LIST_MAX, POLITE, capped, industryWords, offer, say, text, which, type Block, type Env, type Item, type Reply } from './engine';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = (env: Env, module: Parameters<typeof moduleOn>[2]) => moduleOn(env.data, env.pack, module);
const clientName = (d: DemoState, id: string | undefined) => d.clients.find((c) => c.id === id)?.name ?? '';

/* ---------- tax IDs: never ---------- */
const TAX_ID = /\b(?:ssn|ein|itin|tax ?ids?|tax identification|taxpayer (?:id|number)|social security|seguro social|numero de (?:seguro|identificacion|contribuyente)|identificacion fiscal)\b/;
/** A number shaped like a tax ID, wherever it shows up: 123-45-6789, 12-3456789, or nine digits in a row. */
const TAX_NUMBER = /\b\d{3}[- ]\d{2}[- ]\d{4}\b|\b\d{2}-\d{7}\b|\b\d{9}\b/g;
/** Takes anything shaped like a tax ID out of a text before it is shown or sent to an AI model. */
export const maskTaxIds = (s: string): string => s.replace(TAX_NUMBER, '•••');
export const asksForTaxId = (n: string): boolean => TAX_ID.test(n);

/* ---------- appointments ---------- */
const apptPerson = (d: DemoState, a: Appointment) => clientName(d, a.clientId) || d.leads.find((l) => l.id === a.leadId)?.name || '';
const typeName = (env: Env, ty: AppointmentType | undefined) => (ty ? ty.name[env.lang] ?? ty.name.en : '');
const ON = ['requested', 'scheduled', 'awaiting_payment', 'confirmed'];

export function answerAppointments(env: Env): Reply {
  const { data, t, day, time } = env; const from = today(); const to = addDays(6);
  const list = (data.appointments ?? []).filter((a) => ON.includes(a.status) && a.date >= from && a.date <= to).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  if (!list.length) return say(text(t('asst.appt.none', { to: day(to) })), { type: 'link', label: t('asst.appt.open'), to: '/appointments' });
  const item = (a: Appointment): Item => ({
    title: apptPerson(data, a) || typeName(env, data.apptTypes.find((x) => x.id === a.typeId)),
    sub: [typeName(env, data.apptTypes.find((x) => x.id === a.typeId)), data.users.find((u) => u.id === a.staffId)?.name, a.status === 'awaiting_payment' ? t('asst.appt.unpaid') : a.status === 'requested' ? t('asst.appt.requested') : ''].filter(Boolean).join(' · '),
    right: `${day(a.date)}, ${time(a.time)}`, tone: a.status === 'awaiting_payment' ? 'warn' : undefined, to: `/appointments/${a.id}`,
  });
  return say(text(t('asst.appt.head', { n: list.length, to: day(to) })), capped(list, item, { label: t('asst.more', { n: list.length - LIST_MAX }), to: '/appointments' }), { type: 'link', label: t('asst.appt.open'), to: '/appointments' });
}

type Person = { kind: 'client'; rec: Client } | { kind: 'lead'; rec: Lead };
/** "Book an appointment with Dana tomorrow at 10am": finds the person among clients and open leads, the type by its name, and proposes the booking. */
export function parseAppointment(input: string, env: Env): Reply {
  const { t, data } = env;
  const types = (data.apptTypes ?? []).filter((a) => a.active);
  if (!types.length) return say(text(t('asst.appt.noTypes')));
  const w = new Work(input);
  w.take(POLITE);
  const date = takeDate(w); const time = takeTime(w);
  w.take(/\b(?:schedule|book|set up|set|reschedule|programa|programar|programe|agenda|agendar|agende|reserva|reservar|reserve|reprograma|reprogramar)\b/);
  // the kind of appointment, when the person named one
  let type: AppointmentType | undefined;
  const named = types.flatMap((ty) => [ty.name.en, ty.name.es].filter(Boolean).map((label) => ({ ty, phrase: fold(label).replace(/[^a-z0-9]+/g, ' ').trim() }))).sort((a, b) => b.phrase.length - a.phrase.length);
  for (const x of named) { if (x.phrase.length >= 4 && w.take(new RegExp(`\\b(?:(?:a|an|the|una|un|la|el)\\s+)?${esc(x.phrase).replace(/ /g, '\\s+')}\\b`))) { type = x.ty; break; } }
  w.take(/\b(?:(?:a|an|the|una|la|un)\s+)?(?:visit|visita|appointment|cita|meeting|reunion|consultation|consulta)\b/);
  const query = w.rest(NAME_LEAD, NAME_TRAIL);
  const person = data.clients[0] ?? data.leads.find((l) => isOpenLead(l, data));
  const example: Block[] = person ? [{ type: 'examples', items: [t('asst.ex.appt', { name: person.name })] }] : [];
  if (!words(query).length) return say(text(t('asst.need.apptWho')), ...example);
  const cands: Candidate<Person>[] = [
    ...data.clients.map((c) => ({ rec: { kind: 'client', rec: c } as Person, name: c.name, also: c.company ?? '', boost: 0.05 })),
    ...data.leads.filter((l) => isOpenLead(l, data) && !l.clientId).map((l) => ({ rec: { kind: 'lead', rec: l } as Person, name: l.name, also: `${l.company ?? ''} ${l.ticket}` })),
  ];
  const pick = best(rank(query, cands, industryWords(env)));
  if (!pick.one && !pick.many) return say(text(t('asst.notFound.person', { q: tidy(query) })));
  if (!date || !time) return say(text(t('asst.need.apptWhen')), ...example);
  const make = (p: Person, ty: AppointmentType) => ({ kind: 'appointment' as const, ...(p.kind === 'client' ? { clientId: p.rec.id } : { leadId: p.rec.id }), typeId: ty.id, date, time, staffId: env.actor });
  if (pick.many) return which(env, 'asst.which.person2', pick.many.map((p) => ({ label: p.rec.name, sub: t(p.kind === 'client' ? 'asst.kind.client' : 'asst.kind.lead'), proposal: make(p, type ?? types[0]) })));
  // nobody said which kind and there is more than one: ask, rather than pick the first
  if (!type && types.length > 1) return which(env, 'asst.which.apptType', types.slice(0, 6).map((ty) => ({ label: typeName(env, ty), sub: `${ty.minutes} min`, proposal: make(pick.one!, ty) })));
  return offer(make(pick.one!, type ?? types[0]), env);
}

/* ---------- review requests ---------- */
export function answerReviews(env: Env): Reply {
  const { data, t } = env;
  const all = (data.reviews ?? []) as ReviewRecord[];
  if (!all.length) return say(text(t('asst.review.none')), { type: 'link', label: t('asst.open.reviews'), to: '/reviews' });
  const s = reviewStats(data);
  const rated = all.filter((r) => r.status === 'rated' && typeof r.rating === 'number').sort((a, b) => (b.answeredAt ?? b.at).localeCompare(a.answeredAt ?? a.at));
  const blocks: Block[] = [text(t('asst.review.head', { n: s.total, waiting: s.waiting, rated: s.rated })), text(s.average === null ? t('asst.review.noAvg') : t('asst.review.avg', { avg: s.average.toFixed(1) }), true)];
  if (rated.length) blocks.push({ type: 'list', items: rated.slice(0, LIST_MAX).map((r) => ({ title: clientName(data, r.clientId), sub: r.comment, right: t('reviews.of5', { n: r.rating! }), tone: r.rating! <= 3 ? 'warn' : 'ok', to: '/reviews' })) });
  blocks.push({ type: 'link', label: t('asst.open.reviews'), to: '/reviews' });
  return { blocks };
}
/** "Ask Dana for a review": the client by name, their latest work that can be asked about, by email. The rules about who may be asked are checked before the card is shown. */
export function parseReview(input: string, env: Env): Reply {
  const { t, data } = env; const w = new Work(input);
  w.take(POLITE);
  w.take(/\b(?:ask|request|send|prepare|pide|pidele|pedir|pida|pidale|solicita|solicitar|solicite|envia|enviar|envie|prepara|preparar|prepare)\b/);
  w.take(/\b(?:(?:a|an|the|una|la|un)\s+)?(?:review request|solicitud de resena|review|resena|opinion|feedback)\b/);
  const query = w.rest(NAME_LEAD, NAME_TRAIL);
  const first = data.clients.find((c) => askableJobs(data, c.id).length > 0);
  const example: Block[] = first ? [{ type: 'examples', items: [t('asst.ex.review', { name: first.name })] }] : [];
  if (!words(query).length) return say(text(t('asst.need.reviewWho')), ...example);
  const pick = best(rank(query, data.clients.map((c) => ({ rec: c, name: c.name, also: c.company ?? '' })), industryWords(env)));
  if (!pick.one && !pick.many) return say(text(t('asst.notFound.person', { q: tidy(query) })));
  const make = (c: Client) => { const job = [...askableJobs(data, c.id)].sort((a, b) => (b.end || '').localeCompare(a.end || ''))[0]; return { kind: 'review' as const, clientId: c.id, ...(job ? { jobId: job.id } : {}), channel: 'email' as const }; };
  if (pick.many) return which(env, 'asst.which.record', pick.many.map((c) => ({ label: c.name, sub: c.company, proposal: make(c) })));
  return offer(make(pick.one!), env);
}
/** Why a review proposal cannot go ahead, in words, or null. */
export const reviewProblem = (p: { clientId: string; jobId?: string }, env: Env): string | null => {
  const no = askProblem(env.data, { clientId: p.clientId, jobId: p.jobId, channel: 'email' });
  return no ? env.t('reviews.problem.' + no) : null;
};

/* ---------- the catalog, and engagements by service ---------- */
const svcName = (env: Env, s: DemoState['catalog'][number]) => s.i18n?.[env.lang]?.name ?? s.name;
/** The catalog service a request names, when it names one. */
function namedService(n: string, env: Env) {
  const list = (env.data.catalog ?? []).filter((s) => s.active);
  const hits = list.filter((s) => [s.name, s.i18n?.es?.name, s.i18n?.en?.name].some((label) => { const f = label ? fold(label).replace(/[^a-z0-9]+/g, ' ').trim() : ''; return f.length >= 4 && n.includes(f); }));
  return hits.length === 1 ? hits[0] : undefined;
}
export function answerCatalog(n: string, env: Env): Reply {
  const { data, t } = env;
  const list = (data.catalog ?? []).filter((s) => s.active);
  if (!list.length) return say(text(t('asst.cat.none')), { type: 'link', label: t('asst.cat.open'), to: '/catalog' });
  const one = namedService(n, env);
  // prices are the business's own list, not client money: anyone who may open the catalog may read them
  const price = (s: (typeof list)[number]) => { const p = s.tiers.map((x) => x.price).filter((x) => x > 0); return p.length ? (p.length > 1 ? t('asst.cat.from', { price: money(Math.min(...p)) }) : money(p[0])) : t('asst.cat.noPrice'); };
  if (one) {
    return say(text(t('asst.cat.one', { name: svcName(env, one), n: one.tiers.length })), { type: 'list', items: one.tiers.map((x) => ({ title: x.name, sub: [t('asst.cat.unit.' + x.unit), x.note].filter(Boolean).join(' · '), right: x.price > 0 ? money(x.price) : t('asst.cat.noPrice') })) },
      { type: 'link', label: t('asst.sum.open', { name: svcName(env, one) }), to: `/catalog/${one.id}` });
  }
  return say(text(t('asst.cat.head', { n: list.length })), capped(list, (s) => ({ title: svcName(env, s), sub: s.category, right: price(s), to: `/catalog/${s.id}` }), { label: t('asst.more', { n: list.length - LIST_MAX }), to: '/catalog' }), { type: 'link', label: t('asst.cat.open'), to: '/catalog' });
}
export function answerByService(n: string, env: Env): Reply {
  const { data, t, can } = env;
  const active = data.jobs.filter((j) => j.status === 'progress' || j.status === 'contract' || j.status === 'hold');
  if (!active.length) return say(text(t('asst.bySvc.none')));
  const label = (j: DemoState['jobs'][number]) => { const s = (data.catalog ?? []).find((x) => x.id === j.serviceId); return s ? svcName(env, s) : j.type ? t('ty_' + j.type) : t('asst.bySvc.other'); };
  const one = namedService(n, env);
  if (one) {
    const mine = active.filter((j) => j.serviceId === one.id);
    return say(text(t('asst.bySvc.one', { service: svcName(env, one), n: mine.length })), ...(mine.length ? [capped(mine, (j): Item => ({ title: j.name, sub: [clientName(data, j.clientId), j.period].filter(Boolean).join(' · '), right: t('st_' + j.status), to: `/jobs/${j.id}` }), { label: t('asst.more', { n: mine.length - LIST_MAX }), to: '/jobs' })] : []));
  }
  const groups = new Map<string, typeof active>();
  for (const j of active) { const k = label(j); groups.set(k, [...(groups.get(k) ?? []), j]); }
  const rows = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  return say(text(t('asst.bySvc.head', { n: active.length })), { type: 'list', items: rows.slice(0, 12).map(([k, list]) => ({ title: `${k} · ${list.length}`, sub: list.slice(0, 3).map((j) => clientName(data, j.clientId)).filter(Boolean).join(', ') + (list.length > 3 ? '…' : ''), right: can('money') ? money(sum(list, (j) => j.price)) : undefined, to: '/jobs' })) });
}

/* ---------- opportunities, signatures, deadlines, credits ---------- */
export function answerOpportunities(env: Env): Reply {
  const { data, t, can } = env;
  const open = (data.opportunities ?? []).filter((o) => o.status === 'open' || o.status === 'contacted');
  if (!open.length) return say(text(t('asst.opp.none')), { type: 'link', label: t('asst.opp.open'), to: '/opportunities' });
  const svc = (id: string) => { const s = (data.catalog ?? []).find((x) => x.id === id); return s ? svcName(env, s) : ''; };
  return say(text(t('asst.opp.head', { n: open.length })),
    capped(open, (o): Item => ({ title: clientName(data, o.clientId), sub: [svc(o.serviceId), o.status === 'contacted' ? t('asst.opp.contacted') : ''].filter(Boolean).join(' · '), right: can('money') && o.value ? money(o.value) : undefined, to: `/opportunities/${o.id}` }), { label: t('asst.more', { n: open.length - LIST_MAX }), to: '/opportunities' }),
    { type: 'link', label: t('asst.opp.open'), to: '/opportunities' });
}
export function answerSignatures(env: Env): Reply {
  const { data, t, date } = env;
  const items: Item[] = [];
  for (const e of data.envelopes ?? []) {
    if (e.status !== 'sent' && e.status !== 'partly_signed') continue;
    const doc = data.docs.find((x) => x.id === e.docId);
    const waiting = e.signers.filter((s) => s.status !== 'signed' && s.status !== 'declined').map((s) => s.name).filter(Boolean);
    items.push({ title: e.title || doc?.title || '', sub: [clientName(data, doc?.clientId), waiting.length ? t('asst.sign.waiting', { names: waiting.join(', ') }) : ''].filter(Boolean).join(' · '), right: e.sentAt ? t('asst.sign.since', { date: date(e.sentAt.slice(0, 10)) }) : undefined, to: `/esign/${e.id}` });
  }
  // the one-signer signature on a document, where the edition uses that instead of signature requests
  for (const doc of data.docs) {
    if (doc.envelopeId || !doc.esign || (doc.esign.status !== 'sent' && doc.esign.status !== 'viewed')) continue;
    items.push({ title: `${t('doc.kind.' + doc.kind)} ${doc.number}`, sub: [clientName(data, doc.clientId), t('asst.sign.waiting', { names: doc.esign.signerName })].filter(Boolean).join(' · '), right: t('asst.sign.since', { date: date(doc.esign.sentAt.slice(0, 10)) }), to: `/documents/${doc.id}` });
  }
  const to = has(env, 'esign') && env.can('esign') ? '/esign' : '/documents';
  if (!items.length) return say(text(t('asst.sign.none')));
  return say(text(t('asst.sign.head', { n: items.length })), capped(items, (x) => x, { label: t('asst.more', { n: items.length - LIST_MAX }), to }), { type: 'link', label: to === '/esign' ? t('asst.sign.open') : t('nav.documents'), to });
}
export function answerDeadlines(env: Env): Reply {
  const { data, t, date } = env; const td = today();
  const list = (data.complianceItems ?? []).filter((x) => x.status === 'open' && daysBetween(td, x.due) <= 30).sort((a, b) => a.due.localeCompare(b.due));
  if (!list.length) return say(text(t('asst.dl.none')), { type: 'link', label: t('asst.dl.open'), to: '/deadlines' });
  return say(text(t('asst.dl.head', { n: list.length })),
    capped(list, (x): Item => ({ title: x.title, sub: [clientName(data, x.clientId), x.authority].filter(Boolean).join(' · '), right: x.due < td ? `${t('common.overdue')} · ${date(x.due)}` : date(x.due), tone: x.due < td ? 'bad' : daysBetween(td, x.due) <= 7 ? 'warn' : undefined, to: `/deadlines/${x.id}` }), { label: t('asst.more', { n: list.length - LIST_MAX }), to: '/deadlines' }),
    { type: 'link', label: t('asst.dl.open'), to: '/deadlines' });
}
export function answerCredits(env: Env): Reply {
  const { data, t, date } = env; const td = today();
  const live = (data.credits ?? []).filter((c) => !c.used && !c.void && (!c.expires || c.expires >= td));
  if (!live.length) return say(text(t('asst.credit.none')));
  const by = new Map<string, typeof live>();
  for (const c of live) by.set(c.clientId, [...(by.get(c.clientId) ?? []), c]);
  const rows = [...by.entries()].map(([clientId, list]) => ({ clientId, total: sum(list, (c) => c.amount), soonest: list.map((c) => c.expires).filter(Boolean).sort()[0] })).filter((r) => clientName(data, r.clientId));
  if (!rows.length) return say(text(t('asst.credit.none')));
  return say(text(t('asst.credit.head', { n: rows.length, total: money(sum(rows, (r) => r.total)) })),
    capped(rows, (r): Item => ({ title: clientName(data, r.clientId), sub: r.soonest ? t('asst.credit.exp', { date: date(r.soonest) }) : t('asst.credit.noExp'), right: money(r.total), tone: r.soonest && daysBetween(td, r.soonest) <= 14 ? 'warn' : undefined, to: `/clients/${r.clientId}` }), { label: t('asst.more', { n: rows.length - LIST_MAX }), to: '/appointments' }));
}

/* ---------- routing ---------- */
/**
 * Questions about the newer records. Null when the request is not one of these, or the screen it is about is not part of
 * the edition, so the older routes get their turn. A role without access is told so.
 */
export function routeQuestion(n: string, env: Env): Reply | null {
  const { t, can } = env;
  const guard = (perm: Parameters<Env['can']>[0], r: () => Reply): Reply => (can(perm) ? r() : say(text(t(perm === 'money' || perm === 'credits' ? 'asst.noMoney' : 'asst.noAccess'))));
  if (/\b(?:signatures?|unsigned|to sign|waiting (?:for|on) (?:a )?signature|firmas?|firmar|sin firmar)\b/.test(n) && (has(env, 'esign') || has(env, 'documents'))) return guard('documents', () => answerSignatures(env));
  if (/\b(?:deadlines?|filings?|fechas? limite|vencimientos?|plazos?)\b/.test(n) && has(env, 'deadlines')) return guard('deadlines', () => answerDeadlines(env));
  if (/\b(?:credits?|creditos?)\b/.test(n) && has(env, 'appointments')) return can('credits') || can('money') ? answerCredits(env) : say(text(t('asst.noMoney')));
  if (/\b(?:reviews?|ratings?|resenas?|calificacion(?:es)?)\b/.test(n) && has(env, 'reviews')) return guard('reviews', () => answerReviews(env));
  if (/\b(?:opportunit\w*|oportunidad\w*|cross.?sell\w*|venta cruzada)\b/.test(n) && has(env, 'opportunities')) return guard('opportunities', () => answerOpportunities(env));
  if (/\bby service\b|\bpor servicio\b/.test(n)) return guard('jobs', () => answerByService(n, env));
  if (has(env, 'catalog') && (/\b(?:what|which|que|cuales)\b.*\b(?:services|servicios)\b|\bcatalog\w*\b|price list|lista de precios|how much (?:is|does|for|do)\b|cuanto (?:cuesta|cobran|cobramos|vale)|\b(?:price|precio|fee|honorarios?) (?:of|for|de|del|por)\b/.test(n))) return guard('catalog', () => answerCatalog(n, env));
  if (/\b(?:appointments?|citas?)\b/.test(n) && has(env, 'appointments')) return guard('appointments', () => answerAppointments(env));
  return null;
}
