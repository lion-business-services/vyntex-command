// One service: its price tiers, what starts when it is sold, how it reads in each language and where it is in use.
import { useState } from 'react';
import { LuArchive, LuArchiveRestore, LuArrowDown, LuArrowUp, LuCalendarClock, LuCopy, LuFileText, LuListChecks, LuLock, LuPencil, LuTrash2 } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A, go } from '@/app/router';
import { BackLink } from '@/app/Shell';
import { act } from '@/store/store';
import { Badge, Button, Card, Empty, IconButton, PageHeader, confirmDialog, toast } from '@/ui';
import { ActivityList } from '@/app/shared';
import { deleteService, duplicateService, moveTier, setServiceActive } from '@/domain/actions';
import { type Service, serviceDescription, serviceName, serviceUse } from '@/domain/actions/catalog';
import { moduleOn } from '@/domain/config';
import { activityFor } from '@/domain/selectors';
import type { Lang } from '@/domain/types';
import { ServiceForm } from './forms';
import { ExternalChips, categoryLabel, tierPrice, whoLabel } from './parts';

const LANGS: Lang[] = ['en', 'es', 'zh'];

export function ServicePage({ id, canEdit }: { id: string; canEdit: boolean }) {
  const { t, data, pack, lang, can } = useApp();
  const [edit, setEdit] = useState(false);
  const s = (data.catalog ?? []).find((x) => x.id === id) as Service | undefined;
  if (!s) return <Card className="work-none"><Empty title={t('catalog.notFound')} action={<A to="/catalog" className="btn" data-testid="catalog-back">{t('catalog.back')}</A>} /></Card>;

  const use = serviceUse(data, s.id);
  const inUse = use.jobs + use.leads + use.rules + use.opportunities > 0;
  const pb = (data.playbooks ?? []).find((p) => p.id === s.playbookId);
  const appt = (data.apptTypes ?? []).find((a) => a.id === s.appointmentTypeId);
  const about = serviceDescription(s, lang);
  const openJobs = data.jobs.filter((j) => j.serviceId === s.id && j.status !== 'done').length;
  const written = LANGS.filter((l) => s.i18n?.[l]?.name || s.i18n?.[l]?.description);

  const copy = () => { const c = act(duplicateService, s.id); if (c) { toast(t('catalog.duplicated')); go(`/catalog/${c.id}`); } };
  const retire = async () => {
    if (s.active && !(await confirmDialog(t('catalog.retireConfirm', { name: serviceName(s, lang) }), t('catalog.retire'), t('common.cancel'), false))) return;
    act(setServiceActive, s.id, !s.active); toast(t(s.active ? 'catalog.retiredDone' : 'catalog.restoredDone'));
  };
  const remove = async () => {
    if (!(await confirmDialog(t('catalog.deleteConfirm', { name: serviceName(s, lang) }), t('common.delete'), t('common.cancel')))) return;
    if (act(deleteService, s.id)) { toast(t('common.deleted')); go('/catalog'); }
  };

  return (
    <>
      <BackLink to="/catalog">{t('catalog.back')}</BackLink>
      <PageHeader
        title={<>{serviceName(s, lang)} {!s.active && <Badge>{t('catalog.retired')}</Badge>}</>}
        sub={[categoryLabel(t, pack, s.category), s.code].filter(Boolean).join(' · ')}
        actions={canEdit ? <>
          <Button icon={<LuPencil aria-hidden="true" />} onClick={() => setEdit(true)} data-testid="catalog-edit">{t('common.edit')}</Button>
          <Button icon={<LuCopy aria-hidden="true" />} onClick={copy} data-testid="catalog-duplicate">{t('catalog.duplicate')}</Button>
          <Button icon={s.active ? <LuArchive aria-hidden="true" /> : <LuArchiveRestore aria-hidden="true" />} onClick={retire} data-testid="catalog-retire">{t(s.active ? 'catalog.retire' : 'catalog.restore')}</Button>
          {!inUse && can('delete') && <IconButton label={t('common.delete')} onClick={remove} data-testid="catalog-delete"><LuTrash2 /></IconButton>}
        </> : undefined} />
      {!s.active && <div className="note catalog-note">{t('catalog.retiredNote')}</div>}

      <div className="split">
        <div className="stack">
          <Card flush title={<>{t('catalog.tiers')} <span className="count">{s.tiers.length}</span></>}>
            <div className="table-wrap">
              <table className="tbl stackable catalog-tiertable" data-testid="catalog-tiers">
                <thead><tr><th>{t('catalog.f.tierName')}</th><th className="num">{t('common.price')}</th><th>{t('catalog.f.tierNote')}</th>{canEdit && s.tiers.length > 1 && <th><span className="sr">{t('common.actions')}</span></th>}</tr></thead>
                <tbody>
                  {s.tiers.map((x, i) => (
                    <tr key={x.id} data-tier={x.id}>
                      <td className="t1">{x.name}{i === 0 && s.tiers.length > 1 && <> <Badge tone="accent" outline>{t('catalog.tier.first')}</Badge></>}<ExternalChips ids={x.externalIds} /></td>
                      <td data-label={t('common.price')} className="num strong nowrap">{tierPrice(t, x)}</td>
                      <td data-label={t('catalog.f.tierNote')} className="small">{x.note || null}</td>
                      {canEdit && s.tiers.length > 1 && (
                        <td className="catalog-tieracts"><span className="row tight nowrap">
                          <IconButton size="sm" label={`${t('catalog.f.up')}: ${x.name}`} disabled={i === 0} onClick={() => act(moveTier, s.id, x.id, -1)} data-testid="catalog-tier-up"><LuArrowUp /></IconButton>
                          <IconButton size="sm" label={`${t('catalog.f.down')}: ${x.name}`} disabled={i === s.tiers.length - 1} onClick={() => act(moveTier, s.id, x.id, 1)} data-testid="catalog-tier-down"><LuArrowDown /></IconButton>
                        </span></td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={t('catalog.starts.title')}>
            <div className="catalog-starts">
              <div className="catalog-start">
                <LuListChecks aria-hidden="true" />
                <div className="grow">
                  <b>{t('catalog.f.playbook')}</b>
                  {pb ? <>
                    <div className="small"><A to="/catalog/playbooks">{pb.name}</A>{!pb.active && <> <Badge>{t('catalog.pb.off')}</Badge></>}</div>
                    <ol className="catalog-pbsteps">{pb.steps.map((st) => <li key={st.id}><span>{st.title[lang] ?? st.title.en}</span><span className="xs muted nowrap">{t(st.dueIn === 0 ? 'catalog.pb.day0' : st.dueIn === 1 ? 'catalog.pb.day1' : 'catalog.pb.dayN', { n: st.dueIn })} · {whoLabel(t, st.for)}</span></li>)}</ol>
                  </> : <div className="small muted">{t('catalog.starts.noPlaybook')}</div>}
                </div>
              </div>
              <div className="catalog-start">
                <LuFileText aria-hidden="true" />
                <div className="grow"><b>{t('catalog.f.docs')}</b>
                  {s.docKinds?.length ? <div className="row tight catalog-gap">{s.docKinds.map((k) => <Badge key={k} tone="info">{t('doc.kind.' + k)}</Badge>)}</div> : <div className="small muted">{t('catalog.starts.noDocs')}</div>}
                </div>
              </div>
              <div className="catalog-start">
                <LuCalendarClock aria-hidden="true" />
                <div className="grow"><b>{t('catalog.f.appt')}</b>
                  {appt ? <div className="small">{appt.name[lang] ?? appt.name.en} · {t('catalog.minutes', { n: appt.minutes })}<div className="xs muted">{t('catalog.starts.apptNote')}</div></div> : <div className="small muted">{t('catalog.starts.noAppt')}</div>}
                </div>
              </div>
            </div>
          </Card>

          <Card title={t('catalog.lang.title')}>
            {written.length ? (
              <dl className="catalog-langs">
                {written.map((l) => (
                  <div key={l} lang={l}><dt>{t('catalog.lang.' + l)}</dt><dd><b>{s.i18n?.[l]?.name || <span className="dim">{t('catalog.lang.sameName')}</span>}</b>{s.i18n?.[l]?.description && <span className="small muted">{s.i18n[l]!.description}</span>}</dd></div>
                ))}
              </dl>
            ) : <p className="small muted">{about || t('catalog.lang.none')}</p>}
          </Card>
        </div>

        <div className="stack">
          <Card title={t('common.details')}>
            <dl className="kv">
              <dt>{t('catalog.f.category')}</dt><dd>{categoryLabel(t, pack, s.category)}</dd>
              <dt>{t('catalog.f.repeat')}</dt><dd>{t('jobs.rp.' + (s.repeat ?? 'once'))}</dd>
              <dt>{t('catalog.f.code')}</dt><dd>{s.code || <span className="dim">{t('catalog.notSet')}</span>}</dd>
              <dt>{t('common.status')}</dt><dd>{s.active ? t('catalog.active') : t('catalog.retired')}</dd>
              <dt>{t('catalog.ext.title')}</dt><dd><ExternalChips ids={s.externalIds} none /></dd>
            </dl>
            <p className="xs muted catalog-gap">{t('catalog.ext.note')}</p>
          </Card>
          <Card title={t('catalog.use.title')}>
            <dl className="kv" data-testid="catalog-use">
              <dt>{t('nav.jobs')}</dt><dd>{use.jobs ? (can('jobs') && moduleOn(data, pack, 'jobs') ? <A to={`/jobs?service=${s.id}`}>{t('catalog.use.jobs', { n: use.jobs, open: openJobs })}</A> : t('catalog.use.jobs', { n: use.jobs, open: openJobs })) : <span className="dim">0</span>}</dd>
              <dt>{t('nav.leads')}</dt><dd>{use.leads || <span className="dim">0</span>}</dd>
              <dt>{t('catalog.use.rules')}</dt><dd>{use.rules ? (can('opportunities') && moduleOn(data, pack, 'opportunities') ? <A to="/opportunities/rules">{use.rules}</A> : use.rules) : <span className="dim">0</span>}</dd>
            </dl>
            {inUse && <p className="xs muted catalog-gap">{t('catalog.use.note')}</p>}
          </Card>
          {s.internalNote && (
            <Card title={<><LuLock aria-hidden="true" className="catalog-ico" />{t('catalog.f.internal')}</>}>
              <p className="small catalog-prose">{s.internalNote}</p>
              <p className="xs muted catalog-gap">{t('catalog.f.internalHint')}</p>
            </Card>
          )}
          <Card title={t('common.activity')}><ActivityList items={activityFor(data, { type: 'service', id: s.id })} limit={6} /></Card>
        </div>
      </div>

      {edit && <ServiceForm service={s} onClose={() => setEdit(false)} />}
    </>
  );
}
