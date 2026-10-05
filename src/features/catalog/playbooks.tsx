// Playbooks: the list of tasks that starts with a service, and the welcome message that goes with it.
import { useState } from 'react';
import { LuMail, LuPencil, LuPlus, LuTrash2 } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { act } from '@/store/store';
import { Badge, Button, Card, Empty, IconButton, confirmDialog, toast } from '@/ui';
import { PriorityBadge } from '@/app/shared';
import { deletePlaybook } from '@/domain/actions';
import { type PlaybookFull, serviceName } from '@/domain/actions/catalog';
import { PlaybookForm } from './forms';
import { whoLabel } from './parts';

export function Playbooks({ canEdit }: { canEdit: boolean }) {
  const { t, data, lang } = useApp();
  const [form, setForm] = useState<PlaybookFull | 'new' | null>(null);
  const list = (data.playbooks ?? []) as PlaybookFull[];
  const remove = async (p: PlaybookFull, used: number) => {
    if (!(await confirmDialog(t(used ? 'catalog.pb.deleteUsed' : 'catalog.pb.deleteConfirm', { name: p.name, n: used }), t('common.delete'), t('common.cancel')))) return;
    act(deletePlaybook, p.id); toast(t('common.deleted'));
  };
  const add = canEdit ? <Button variant={list.length ? 'primary' : 'default'} icon={<LuPlus aria-hidden="true" />} onClick={() => setForm('new')} data-testid="catalog-pb-new">{t('catalog.pb.new')}</Button> : null;
  return (
    <>
      <div className="catalog-bar">
        <p className="small muted catalog-lead">{t('catalog.pb.about')}</p>
        <div className="row tight catalog-acts">{add}</div>
      </div>
      {!list.length ? (
        <Card className="work-none"><Empty title={t('catalog.pb.empty')} action={canEdit ? <Button variant="primary" icon={<LuPlus aria-hidden="true" />} onClick={() => setForm('new')}>{t('catalog.pb.new')}</Button> : undefined}>{t('catalog.pb.emptyHint')}</Empty></Card>
      ) : (
        <div className="grid2 catalog-pbs" data-testid="catalog-playbooks">
          {list.map((p) => {
            const used = (data.catalog ?? []).filter((s) => s.playbookId === p.id);
            const welcome = p.welcomeI18n?.[lang] || p.welcome;
            return (
              <Card key={p.id} className="catalog-pb" title={<>{p.name} {!p.active && <Badge>{t('catalog.pb.off')}</Badge>}</>}
                actions={canEdit ? <>
                  <IconButton size="sm" label={`${t('common.edit')}: ${p.name}`} onClick={() => setForm(p)} data-testid="catalog-pb-edit"><LuPencil /></IconButton>
                  <IconButton size="sm" label={`${t('common.delete')}: ${p.name}`} onClick={() => remove(p, used.length)} data-testid="catalog-pb-delete"><LuTrash2 /></IconButton>
                </> : undefined}>
                <p className="xs muted catalog-pb-used">
                  {used.length ? <>{t('catalog.pb.usedBy')} {used.map((s, i) => <span key={s.id}>{i > 0 && ', '}<A to={`/catalog/${s.id}`}>{serviceName(s, lang)}</A></span>)}</> : t('catalog.pb.unused')}
                </p>
                <ol className="catalog-pbsteps">
                  {p.steps.map((st) => (
                    <li key={st.id}>
                      <span>{st.title[lang] ?? st.title.en} {st.pri && st.pri !== 'medium' && <PriorityBadge pri={st.pri} />}</span>
                      <span className="xs muted">{t(st.dueIn === 0 ? 'catalog.pb.day0' : st.dueIn === 1 ? 'catalog.pb.day1' : 'catalog.pb.dayN', { n: st.dueIn })} · {whoLabel(t, st.for)}{st.type ? ` · ${t('tt_' + st.type)}` : ''}</span>
                    </li>
                  ))}
                </ol>
                {welcome
                  ? <details className="catalog-welcome"><summary><LuMail aria-hidden="true" />{t('catalog.pb.welcome')}</summary><p className="small catalog-prose">{welcome}</p><p className="xs muted">{t('catalog.pb.welcomeNote')}</p></details>
                  : <p className="xs muted catalog-gap">{t('catalog.pb.noWelcome')}</p>}
              </Card>
            );
          })}
        </div>
      )}
      {form && <PlaybookForm playbook={form === 'new' ? undefined : form} onClose={() => setForm(null)} />}
    </>
  );
}
