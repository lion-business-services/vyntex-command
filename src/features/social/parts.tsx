// Small pieces the social screen and its composer share.
import { useEffect, useState } from 'react';
import { LuFacebook, LuInstagram, LuStore } from 'react-icons/lu';
import { useApp } from '@/app/hooks';
import { Badge, type Tone } from '@/ui';
import type { TFn } from '@/i18n';
import type { DemoState, FileRef, SocialPost } from '@/domain/types';
import { channelRule, type PostProblem, type SocialChannel } from '@/domain/actions/social';
import { gateway } from '@/platform/gateway';

const ICON = { facebook: LuFacebook, instagram: LuInstagram, gbp: LuStore };
/** The networks' own names: never translated. */
export const CHANNEL_NAME: Record<SocialChannel, string> = { facebook: 'Facebook', instagram: 'Instagram', gbp: 'Google Business Profile' };
export function ChannelMark({ id, short }: { id: SocialChannel; short?: boolean }) {
  const Icon = ICON[id];
  return <span className="social-ch" title={CHANNEL_NAME[id]}><Icon aria-hidden="true" />{short ? <span className="sr">{CHANNEL_NAME[id]}</span> : CHANNEL_NAME[id]}</span>;
}
/** Whether the account a network is published through is connected. The server sets that; a sample workspace never has one. */
export const isConnected = (d: DemoState, id: SocialChannel): boolean => d.connections.some((c) => c.id === channelRule(id).provider && c.state === 'connected');

export function problemText(t: TFn, p: PostProblem): string {
  return t('social.problem.' + p.code, { n: p.limit !== undefined ? p.limit.toLocaleString('en-US') : '' });
}

const TONE: Record<SocialPost['status'], Tone> = { draft: 'neutral', needs_approval: 'warn', scheduled: 'info', demo: 'accent', published: 'ok', failed: 'bad' };
/** The state of a post, in words that never claim more than happened: `demo` reads "Sample: nothing was published". */
export function PostStatus({ post }: { post: SocialPost }) {
  const { t } = useApp();
  return (
    <>
      <Badge tone={TONE[post.status]} outline={post.status === 'demo'}>{t('social.status.' + post.status)}</Badge>
      {post.status === 'draft' && post.approvedBy && <Badge tone="ok" outline>{t('social.approved')}</Badge>}
    </>
  );
}

/** An address to show a stored picture: at hand in a sample workspace, asked from the server (short lived) in a live one. */
export function useFileUrl(file: FileRef | undefined): string {
  const [url, setUrl] = useState(file?.dataUrl ?? '');
  useEffect(() => {
    if (!file) { setUrl(''); return; }
    if (file.dataUrl) { setUrl(file.dataUrl); return; }
    let alive = true;
    gateway().files.url(file).then((out) => { if (alive) setUrl(out.ok ? out.data : ''); }, () => { if (alive) setUrl(''); });
    return () => { alive = false; };
  }, [file?.dataUrl, file?.path]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}
