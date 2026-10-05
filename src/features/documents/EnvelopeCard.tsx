// The signature card of a document, in an edition that has the Signatures screen: where the request for this document
// stands, and the way to prepare one. The request itself (signers, boxes on the pages, sending, the trail) is on its own
// page under Signatures.
import { LuDownload, LuPenLine, LuSignature } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, go } from '@/app/router';
import { act } from '@/store/store';
import { Badge, Button, Card, toast } from '@/ui';
import { CanWrite, DemoTag, PlanBadge } from '@/app/shared';
import { createEnvelope } from '@/domain/actions';
import { byId } from '@/domain/selectors';
import type { DocRecord } from '@/domain/types';
import type { EnvelopeX } from '@/domain/esign/types';
import { isOpenEnvelope, waitingOn } from '@/domain/esign/envelope';
import { downloadFile } from '@/features/esign/prepare';
import { SuccessCheck } from './success';

/** `blocked` lists what stops this document from being sent as it stands: its wording is not approved, or it still has placeholders. */
export function EnvelopeCard({ doc, blocked }: { doc: DocRecord; blocked?: { unapproved?: boolean; placeholders?: boolean; notPdf?: boolean } }) {
  const { t, data, live, can, date } = useApp();
  const env = byId(data.envelopes, doc.envelopeId) as EnvelopeX | undefined;
  const open = !!env && isOpenEnvelope(env);
  const start = () => { const r = act(createEnvelope, doc.id); if (r.ok) go(`/esign/${r.data.id}`); else toast(t('esign.err.' + r.reason), true); };
  const stops = [blocked?.notPdf && 'docs.env.notPdf', blocked?.unapproved && 'docs.env.unapproved', blocked?.placeholders && 'docs.env.placeholders'].filter((x): x is string => !!x);
  return (
    <Card className={env?.status === 'completed' ? undefined : 'raised'} title={<><LuSignature aria-hidden="true" />{t('docs.env.title')}</>} actions={<><PlanBadge feature="esignature" />{!live && <DemoTag />}</>}>
      {!env || (!open && env.status !== 'completed' && env.status !== 'draft') ? (
        <>
          <p className="small muted">{t('docs.env.intro')}</p>
          {env && <p className="small" style={{ marginTop: 8 }}><Badge tone={env.status === 'declined' ? 'bad' : 'neutral'}>{t('esign.status.' + env.status)}</Badge> <A to={`/esign/${env.id}`} className="linkbtn">{t('docs.env.last')}</A></p>}
          {stops.length > 0 && <ul className="docs-stops" data-testid="docs-env-stops">{stops.map((k) => <li key={k}>{t(k)}</li>)}</ul>}
          {blocked?.unapproved && can('config') && <p className="small"><A to="/settings/documents" className="linkbtn">{t('docs.env.toTemplates')}</A></p>}
          {!blocked?.notPdf && <div style={{ marginTop: 12 }}><CanWrite need="esign"><Button variant="primary" icon={<LuPenLine aria-hidden="true" />} onClick={start} data-testid="docs-env-start">{t('docs.env.start')}</Button></CanWrite></div>}
        </>
      ) : env.status === 'draft' ? (
        <>
          <p className="small muted">{t('docs.env.draft')}</p>
          {stops.length > 0 && <ul className="docs-stops" data-testid="docs-env-stops">{stops.map((k) => <li key={k}>{t(k)}</li>)}</ul>}
          <div style={{ marginTop: 12 }}><A to={`/esign/${env.id}`} className="btn primary" data-testid="docs-env-continue">{t('docs.env.continue')}</A></div>
        </>
      ) : env.status === 'completed' ? (
        <>
          <p className="small docs-signed" data-testid="docs-env-completed"><SuccessCheck /><span>{t('docs.env.completed', { date: date((env.completedAt ?? '').slice(0, 10)) })}</span></p>
          <div className="row" style={{ marginTop: 12 }}>
            {env.signedFile && <Button icon={<LuDownload aria-hidden="true" />} onClick={() => void downloadFile(env.signedFile)} data-testid="docs-env-download">{t('docs.env.signedCopy')}</Button>}
            <A to={`/esign/${env.id}`} className="btn ghost">{t('docs.env.open')}</A>
          </div>
        </>
      ) : (
        <>
          <p className="small"><Badge tone="warn">{t('esign.status.' + env.status)}</Badge></p>
          <p className="small muted" style={{ margin: '8px 0 12px' }} data-testid="docs-env-waiting">{t('docs.env.waiting', { names: waitingOn(env).map((s) => s.name).join(', ') })}</p>
          <A to={`/esign/${env.id}`} className="btn primary" data-testid="docs-env-open">{t('docs.env.open')}</A>
        </>
      )}
      {!live && <p className="xs dim" style={{ marginTop: 12 }}>{t('docs.env.sample')}</p>}
    </Card>
  );
}
