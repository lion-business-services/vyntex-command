// One description of a document, built from the job, the client, the company and the industry's agreement template.
// The screen, the printout and the PDF are all drawn from this same description, so they can never disagree.
import type { DemoState, DocKind, DocRecord, Lang } from '@/domain/types';
import type { IndustryPack } from '@/packs/types';
import { makeT } from '@/i18n';
import { byId, jobMoney } from '@/domain/selectors';
import { money2 } from '@/lib/money';
import { fmtDate } from '@/lib/dates';

/** A piece of text on the document. `base` is what the app generates; `text` is what shows (the saved edit, when there is one). */
export interface TextBlock { t: 'text'; key: string; style: 'h' | 'p' | 'strong' | 'small'; text: string; base: string; /** Comes from the record, so it is changed there and not typed over. */ locked?: boolean }
export interface ColsBlock { t: 'cols'; cols: { head: string; body: TextBlock }[] }
export interface AmountRow { label: string; amount: string; kind?: 'minus' | 'total' }
export interface TableBlock { t: 'table'; rows: AmountRow[]; /** Shown under the total when nothing is owed. */ paidNote?: string }
export interface SignParty {
  role: 'client' | 'company';
  /** Line under the signature line, e.g. "Client: Maria Lopez". */
  label: string;
  dateLabel: string;
  /** Present once the demo signature exists. Never a legally executed signature. */
  signed?: { image?: string; name: string; date: string; note: string };
}
export interface SignBlock { t: 'sign'; parties: SignParty[] }
export interface NoticeBlock { t: 'notice'; tone: 'draft' | 'void'; text: string }
export type Block = TextBlock | ColsBlock | TableBlock | SignBlock | NoticeBlock;

export interface DocModel {
  lang: Lang;
  kind: DocKind;
  number: string;
  fileName: string;
  company: { name: string; lines: string[]; logo?: string };
  title: TextBlock;
  /** Right-hand header lines: number and date. */
  meta: string[];
  blocks: Block[];
  /** True when this language version has saved edits. */
  edited: boolean;
  /** "Page 1 of 2" */
  pageLabel: (n: number, total: number) => string;
}

/** Saved edits are kept per document language, so an English edit never shows up in the Spanish version. */
export const editKey = (lang: Lang, key: string) => `${lang}:${key}`;
export const hasEdits = (doc: DocRecord, lang?: Lang) => Object.keys(doc.edits || {}).some((k) => !lang || k.startsWith(lang + ':'));

export function buildDoc(doc: DocRecord, data: DemoState, pack: IndustryPack, lang: Lang): DocModel | null {
  const job = byId(data.jobs, doc.jobId);
  if (!job) return null;
  const client = byId(data.clients, doc.clientId) ?? byId(data.clients, job.clientId);
  const t = makeT(lang, pack);
  const co = data.company;
  const m = jobMoney(data, job);
  const edits = doc.edits || {};
  const text = (key: string, style: TextBlock['style'], base: string, locked?: boolean): TextBlock => {
    const saved = locked ? undefined : edits[editKey(lang, key)];
    return { t: 'text', key, style, base, text: saved ?? base, locked };
  };
  const day = (d: string) => (d ? fmtDate(d, lang) : t('docs.p.tbd'));
  /** Date and time with the year, as it should read on a document. */
  const stamp = (iso?: string) => { const d = iso ? new Date(iso) : null; return d && !isNaN(d.getTime()) ? d.toLocaleString(lang === 'es' ? 'es-US' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : t('docs.p.tbd'); };
  const lines = (...parts: (string | undefined)[]) => parts.filter((x) => x && x.trim()).join('\n');

  const clientName = client?.name ?? t('docs.p.noClient');
  const parties = text('client', 'p', lines(clientName, client?.company, client?.phone, client?.email) || clientName);
  const site = text('site', 'p', lines(job.address, `${job.name} · ${job.number}`));
  const cols = (head: string): ColsBlock => ({ t: 'cols', cols: [{ head, body: parties }, { head: t('jobSite'), body: site }] });

  const es = doc.esign;
  const signedInfo = es && es.status === 'signed'
    ? { image: es.signature, name: es.typedName || es.signerName, date: stamp(es.signedAt), note: t('docs.p.signedDemo') }
    : undefined;
  const clientParty = (label: string): SignParty => ({ role: 'client', label: `${label}: ${clientName}`, dateLabel: t('common.date'), signed: signedInfo });
  const companyParty: SignParty = { role: 'company', label: `${t('docs.p.companySig')}: ${co.name}`, dateLabel: t('common.date') };

  const blocks: Block[] = [];
  if (doc.status === 'void') blocks.push({ t: 'notice', tone: 'void', text: t('docs.p.void') });
  let title: TextBlock;

  if (doc.kind === 'contract') {
    const L = pack.agreement[lang];
    const fill = (s: string, p: Record<string, string>) => s.replace(/\{(\w+)\}/g, (all, k: string) => p[k] ?? all);
    title = text('title', 'h', L.title);
    blocks.push(text('intro', 'p', fill(L.intro, { company: co.name })));
    blocks.push(cols(t('docs.p.client')));
    blocks.push(text('s1', 'h', L.s1), text('scope', 'p', job.scope.trim() || t('docs.p.noScope')));
    blocks.push(text('s2', 'h', L.s2), text('total', 'strong', `${L.total}: ${money2(m.price)}`, true), text('payTerms', 'p', job.payTerms.trim() || t('docs.p.noTerms')));
    blocks.push(text('s3', 'h', L.s3), text('sched', 'p', fill(L.sched, { start: day(job.start), end: day(job.end) })));
    blocks.push(text('s4', 'h', L.s4), text('chg', 'p', L.chg));
    blocks.push(text('s5', 'h', L.s5), text('ins', 'p', L.ins));
    blocks.push(text('s6', 'h', L.s6), text('cxl', 'p', L.cxl));
    blocks.push(text('s7', 'h', L.s7), text('esig', 'p', L.esig));
    blocks.push({ t: 'sign', parties: [clientParty(t('docs.p.client')), companyParty] });
    blocks.push({ t: 'notice', tone: 'draft', text: L.draft });
  } else if (doc.kind === 'invoice') {
    title = text('title', 'h', t('doc.kind.invoice'));
    blocks.push(cols(t('billTo')));
    const rows: AmountRow[] = [{ label: `${t('contractTotal')} · ${job.name}`, amount: money2(m.price) }];
    for (const r of job.received) rows.push({ label: [t('docs.p.payment'), fmtDate(r.date, lang), t('m_' + r.method), r.ref].filter(Boolean).join(' · '), amount: money2(r.amount), kind: 'minus' });
    rows.push({ label: t('balanceDue'), amount: money2(m.clientOwes), kind: 'total' });
    blocks.push({ t: 'table', rows, paidNote: m.price > 0 && m.clientOwes <= 0.005 ? t('docs.p.paidFull') : undefined });
    if (job.payTerms.trim()) blocks.push(text('termsH', 'h', t('docs.p.terms')), text('payTerms', 'p', job.payTerms.trim()));
    blocks.push(text('payInstr', 'p', t('payInstr')), text('thanks', 'p', t('thanks', { company: co.name })));
  } else {
    title = text('title', 'h', t('doc.kind.estimate'));
    blocks.push(text('intro', 'p', t('docs.p.est.intro', { company: co.name })));
    blocks.push(cols(t('docs.p.client')));
    blocks.push(text('scopeH', 'h', t('docs.p.est.scope')), text('scope', 'p', job.scope.trim() || t('docs.p.noScope')));
    blocks.push(text('priceH', 'h', t('docs.p.est.price')), text('total', 'strong', money2(m.price), true));
    if (job.payTerms.trim()) blocks.push(text('payTerms', 'p', job.payTerms.trim()));
    blocks.push(text('validH', 'h', t('docs.p.est.validH')), text('valid', 'p', t('docs.p.est.valid')));
    blocks.push(text('accept', 'p', t('docs.p.est.accept')));
    blocks.push({ t: 'sign', parties: [clientParty(t('docs.p.acceptedBy'))] });
  }

  return {
    lang, kind: doc.kind, number: doc.number, fileName: doc.number.replace(/[^\w.-]+/g, '-') + '.pdf',
    company: { name: co.name, lines: [co.license, [co.phone, co.email].filter(Boolean).join(' · ')].filter((x) => x && x.trim()), logo: co.logo },
    title, meta: [`${t('docs.p.number')} ${doc.number}`, fmtDate(doc.created, lang)],
    blocks, edited: hasEdits(doc, lang),
    pageLabel: (n, total) => t('docs.p.page', { n, total }),
  };
}

/** Every piece of text a person may type over, in reading order. */
export function editableBlocks(model: DocModel): TextBlock[] {
  const out: TextBlock[] = [model.title];
  for (const b of model.blocks) {
    if (b.t === 'text' && !b.locked) out.push(b);
    if (b.t === 'cols') for (const c of b.cols) out.push(c.body);
  }
  return out;
}
