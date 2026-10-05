// Writing a post: the text, one picture, the networks it goes to, and a preview of how each network would take it, with
// that network's own rules (how long the text may be, whether it needs a picture). Saving keeps it as a draft; what
// happens next depends on who is writing: an owner or a manager may schedule or publish, anyone else sends it for approval.
import { useEffect, useRef, useState } from 'react';
import { LuCalendarClock, LuImagePlus, LuSend, LuX } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { A } from '@/app/router';
import { act } from '@/store/store';
import { Avatar, Badge, Button, Field, Modal, cx, toast } from '@/ui';
import { moduleOn } from '@/domain/config';
import { createPost, publishPost, schedulePost, submitPost, updatePost } from '@/domain/actions';
import { SOCIAL_CHANNELS, canApprovePosts, postProblems, type PostResult, type SocialChannel } from '@/domain/actions/social';
import type { FileRef, SocialPost } from '@/domain/types';
import { gateway } from '@/platform/gateway';
import { ChannelMark, isConnected, problemText, useFileUrl } from './parts';

const pad = (n: number) => String(n).padStart(2, '0');
/** A moment as the value of a date-and-time field, in the viewer's own time. */
export const toLocalInput = (iso: string | undefined): string => { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export function Composer({ post, when, onClose }: { post?: SocialPost; /** Start with this moment in the schedule field (a day picked on the calendar). */ when?: string; onClose: () => void }) {
  const { t, data, pack, can, live, user } = useApp();
  const [text, setText] = useState(post?.text ?? '');
  const [channels, setChannels] = useState<SocialChannel[]>(post?.channels ?? []);
  const [media, setMedia] = useState<FileRef[]>(post?.media ?? []);
  const [at, setAt] = useState(toLocalInput(post?.scheduledFor) || when || '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const approver = !!user && canApprovePosts(data, { pack }, user.id);
  const problems = postProblems({ text, channels, media });
  const integrations = can('integrations') && moduleOn(data, pack, 'integrations');
  // a live workspace publishes through a connected account: a network without one cannot be picked yet
  const offered = (id: SocialChannel) => !live || isConnected(data, id);

  const roles = { owner: t('role.owner'), manager: t('role.manager') };
  const toggle = (id: SocialChannel) => { setChannels(channels.includes(id) ? channels.filter((x) => x !== id) : [...channels, id]); setErr(''); };
  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { setErr(t('social.err.notImage')); return; }
    setBusy(true);
    try {
      const out = await gateway().files.upload(f, { folder: 'social' });
      if (out.ok) { setMedia([out.data]); setErr(''); } else setErr(t(out.reason === 'too_large' ? 'social.err.tooLarge' : out.reason === 'invalid_type' ? 'social.err.notImage' : 'social.err.upload'));
    } catch { setErr(t('social.err.upload')); }
    finally { setBusy(false); if (file.current) file.current.value = ''; }
  };
  /** Saves what is on screen as the draft and returns it, or null when there is nothing to save. */
  const save = (): SocialPost | null => {
    if (!text.trim() && !media.length) { setErr(t('social.problem.empty')); return null; }
    const input = { text, channels, media };
    if (!post) return act(createPost, input);
    const out = act(updatePost, post.id, input);
    if (!out.ok) { setErr(t('social.err.' + out.reason, roles)); return null; }
    return out.post;
  };
  const finish = (out: PostResult, said: string) => {
    if (out.ok) { toast(t(said)); onClose(); return; }
    setErr(out.reason === 'invalid' && out.problems?.length ? problemText(t, out.problems[0]) : t('social.err.' + out.reason, roles));
  };
  const draft = () => { if (save()) { toast(t('social.saved')); onClose(); } };
  const submit = () => { const p = save(); if (p) finish(act(submitPost, p.id), 'social.submitted'); };
  const schedule = () => {
    if (!at) { setErr(t('social.err.noTime')); return; }
    const p = save(); if (p) finish(act(schedulePost, p.id, new Date(at).toISOString()), 'social.scheduled');
  };
  const publish = () => { const p = save(); if (p) finish(act(publishPost, p.id), live ? 'social.queued' : 'social.sampleDone'); };

  return (
    <Modal title={t(post ? 'social.edit' : 'social.new')} onClose={onClose} size="wide" labelClose={t('common.close')}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><span className="grow" />
        <Button onClick={draft} data-testid="social-save">{t('social.saveDraft')}</Button>
        {approver ? <>
          <Button icon={<LuCalendarClock />} onClick={schedule} data-testid="social-schedule">{t('social.schedule')}</Button>
          <Button variant="primary" icon={<LuSend />} onClick={publish} data-testid="social-publish">{t('social.publishNow')}</Button>
        </> : <Button variant="primary" onClick={submit} data-testid="social-submit">{t('social.submit')}</Button>}
      </>}>
      <div className="social-compose">
        <div className="stack tight">
          <Field label={t('social.f.text')}><textarea rows={7} value={text} onChange={(e) => { setText(e.target.value); setErr(''); }} data-testid="social-text" /></Field>
          <div className="field">
            <span className="label">{t('social.f.channels')}</span>
            <div className="social-chpick" role="group" aria-label={t('social.f.channels')}>
              {SOCIAL_CHANNELS.map((c) => {
                const on = channels.includes(c.id); const ok = offered(c.id);
                return (
                  <label key={c.id} className={cx('check social-chopt', !ok && 'off')}>
                    <input type="checkbox" checked={on} disabled={!ok} onChange={() => toggle(c.id)} data-testid={`social-channel-${c.id}`} />
                    <span><ChannelMark id={c.id} />{!isConnected(data, c.id) && <Badge tone="neutral" outline>{t('social.connectFirst')}</Badge>}</span>
                  </label>
                );
              })}
            </div>
            <span className="hint">{t(live ? 'social.f.channelsLive' : 'social.f.channelsSample')} {live && integrations && <A to="/integrations">{t('nav.integrations')}</A>}</span>
          </div>
          <div className="field">
            <span className="label">{t('social.f.image')}</span>
            {media[0] ? <div className="row"><Thumb file={media[0]} /><span className="small grow clip">{media[0].name}</span><Button size="sm" variant="ghost" icon={<LuX />} onClick={() => setMedia([])}>{t('social.removeImage')}</Button></div>
              : <Button size="sm" icon={<LuImagePlus />} disabled={busy} onClick={() => file.current?.click()} data-testid="social-image">{t('social.addImage')}</Button>}
            <input ref={file} type="file" accept="image/jpeg,image/png" hidden onChange={(e) => void pick(e.target.files?.[0])} data-testid="social-file" />
            <span className="hint">{t('social.f.imageHint')}</span>
          </div>
          {approver && <Field label={`${t('social.f.when')} (${t('common.optional')})`} hint={t('social.f.whenHint')}><input type="datetime-local" value={at} onChange={(e) => { setAt(e.target.value); setErr(''); }} data-testid="social-when" /></Field>}
          {!approver && <p className="small muted">{t('social.needsApprover', roles)}</p>}
          {err && <p className="small neg" role="alert" data-testid="social-error">{err}</p>}
          {!live && <p className="xs dim">{t('social.sampleHint')}</p>}
        </div>

        <div className="social-previews" aria-label={t('social.preview')}>
          {!channels.length && <p className="small muted social-noprev">{t('social.previewEmpty')}</p>}
          {channels.map((id) => <Preview key={id} id={id} text={text} file={media[0]} problems={problems.filter((p) => p.channel === id).map((p) => problemText(t, p))} />)}
        </div>
      </div>
    </Modal>
  );
}

function Thumb({ file }: { file: FileRef }) {
  const url = useFileUrl(file);
  return url ? <img className="social-thumb" src={url} alt="" /> : <span className="social-thumb" aria-hidden="true" />;
}

/** How one network would take the post. A plain frame, not a copy of the network's own look: what matters is the text, the picture and its rules. */
function Preview({ id, text, file, problems }: { id: SocialChannel; text: string; file?: FileRef; problems: string[] }) {
  const { t, data } = useApp();
  const rule = SOCIAL_CHANNELS.find((c) => c.id === id)!;
  const url = useFileUrl(file);
  const [all, setAll] = useState(false);
  useEffect(() => { setAll(false); }, [text]);
  const long = text.length > 280;
  return (
    <article className={cx('social-preview', problems.length > 0 && 'bad')} data-channel={id} data-testid="social-preview">
      <header><ChannelMark id={id} /><span className={cx('xs', text.length > rule.maxText ? 'neg strong' : 'dim')}>{t('social.count', { n: text.length.toLocaleString('en-US'), max: rule.maxText.toLocaleString('en-US') })}</span></header>
      <div className="social-pbody">
        <div className="row tight nowrap"><Avatar name={data.company.name} size="sm" /><b className="small clip">{data.company.name}</b></div>
        {text ? <p className="social-ptext">{long && !all ? text.slice(0, 280).trimEnd() + '… ' : text}{long && <button type="button" className="linkbtn xs" onClick={() => setAll(!all)}>{t(all ? 'social.less' : 'social.more')}</button>}</p> : <p className="small dim">{t('social.noText')}</p>}
        {url ? <img className="social-pimg" src={url} alt="" /> : rule.needsImage ? <div className="social-pimg none">{t('social.problem.needs_image')}</div> : null}
      </div>
      <footer className="xs">
        <span className="dim">{t('social.rule.' + id)}</span>
        {problems.map((p) => <span key={p} className="neg strong" role="note">{p}</span>)}
      </footer>
    </article>
  );
}
