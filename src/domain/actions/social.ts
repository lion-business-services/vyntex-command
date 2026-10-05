// Social posts: written as a draft, sent for approval, approved by an owner or a manager, scheduled or published.
// Same honesty rule as messages: in a sample workspace "publish" marks the post `demo` and nothing leaves the browser.
// In a live workspace the browser never writes `published` or `failed`: it marks the post `scheduled` (for now, or for
// a later time) and the server publishes it through the connected account and records what the provider answered.
// That difference lives in one place, `publishStatus()`.
// The channels are a list with their own rules, so another network is one more entry, not another branch in the screens.
import type { DemoState, FileRef, ISODateTime, ProviderId, SocialPost } from '../types';
import { type Ctx, logActivity } from '../context';
import { permissionsOf } from '../config';
import { isLive } from '@/platform/session';
import { nowIso } from '@/lib/dates';
import { uid } from '@/lib/id';

export type SocialChannel = SocialPost['channels'][number];
export interface ChannelRule {
  id: SocialChannel;
  /** The connection the channel is published through. */
  provider: ProviderId;
  /** Longest text the network accepts. */
  maxText: number;
  /** The network does not take a post without a picture. */
  needsImage: boolean;
  /** Most pictures in one post. */
  maxImages: number;
  /** Picture types the network accepts when a post is published for a business. */
  imageTypes: string[];
}
/**
 * What each network accepts for a post made on behalf of a business, as the networks publish it, plus this platform's own
 * limit of one picture per post. The networks change their rules from time to time: the server checks again when it
 * publishes, and its answer is what counts.
 */
export const SOCIAL_CHANNELS: ChannelRule[] = [
  { id: 'facebook', provider: 'meta', maxText: 63206, needsImage: false, maxImages: 1, imageTypes: ['image/jpeg', 'image/png'] },
  { id: 'instagram', provider: 'meta', maxText: 2200, needsImage: true, maxImages: 1, imageTypes: ['image/jpeg'] },
  { id: 'gbp', provider: 'gbp', maxText: 1500, needsImage: false, maxImages: 1, imageTypes: ['image/jpeg', 'image/png'] },
];
export const channelRule = (id: SocialChannel): ChannelRule => SOCIAL_CHANNELS.find((c) => c.id === id) as ChannelRule;

export type PostProblem = { channel: SocialChannel | null; code: 'empty' | 'no_channel' | 'too_long' | 'needs_image' | 'too_many_images' | 'image_type'; limit?: number };
/** Why a post cannot go out as it stands, per channel. An empty list means it can. */
export function postProblems(p: Pick<SocialPost, 'text' | 'channels' | 'media'>): PostProblem[] {
  const out: PostProblem[] = [];
  const images = p.media ?? [];
  if (!p.text.trim() && !images.length) out.push({ channel: null, code: 'empty' });
  if (!p.channels.length) out.push({ channel: null, code: 'no_channel' });
  for (const id of p.channels) {
    const r = channelRule(id); if (!r) continue;
    if (p.text.length > r.maxText) out.push({ channel: id, code: 'too_long', limit: r.maxText });
    if (r.needsImage && !images.length) out.push({ channel: id, code: 'needs_image' });
    if (images.length > r.maxImages) out.push({ channel: id, code: 'too_many_images', limit: r.maxImages });
    if (images.some((f) => !r.imageTypes.includes(f.mime))) out.push({ channel: id, code: 'image_type' });
  }
  return out;
}

/** The state of a post that was just published: marked as a sample, or handed to the server to publish now. */
export const publishStatus = (): SocialPost['status'] => (isLive() ? 'scheduled' : 'demo');

/** Approving, scheduling and publishing take the `social` capability and an owner or manager role. Everyone else sends for approval. */
export function canApprovePosts(d: DemoState, ctx: Pick<Ctx, 'pack'>, userId: string): boolean {
  const u = d.users.find((x) => x.id === userId);
  return !!u && (u.role === 'owner' || u.role === 'manager') && permissionsOf(d, ctx.pack, u.role).includes('social');
}

export type PostResult = { ok: true; post: SocialPost } | { ok: false; reason: 'not_found' | 'not_allowed' | 'invalid' | 'wrong_state' | 'past'; problems?: PostProblem[] };
const ref = (p: SocialPost) => ({ type: 'post' as const, id: p.id });
const line = (p: SocialPost) => p.text.replace(/\s+/g, ' ').trim().slice(0, 70);
const find = (d: DemoState, id: string) => d.posts.find((p) => p.id === id);
const editable = (p: SocialPost) => p.status === 'draft' || p.status === 'needs_approval' || p.status === 'scheduled' || p.status === 'failed';

export interface PostInput { text: string; channels: SocialChannel[]; media?: FileRef[] }

export function createPost(d: DemoState, ctx: Ctx, input: PostInput): SocialPost {
  const post: SocialPost = { id: uid('sp'), text: input.text.trim(), channels: [...input.channels], status: 'draft', by: ctx.actor, created: nowIso(), ...(input.media?.length ? { media: input.media } : {}) };
  d.posts.unshift(post);
  logActivity(d, ctx.actor, 'post.created', ref(post), { text: line(post) });
  return post;
}
/** Changes the text, pictures or channels. A post that was approved goes back to waiting for approval when someone else changes it. */
export function updatePost(d: DemoState, ctx: Ctx, id: string, input: PostInput): PostResult {
  const p = find(d, id); if (!p) return { ok: false, reason: 'not_found' };
  if (!editable(p)) return { ok: false, reason: 'wrong_state' };
  p.text = input.text.trim(); p.channels = [...input.channels]; p.media = input.media?.length ? input.media : undefined;
  if (p.status === 'failed') { p.status = 'draft'; p.error = undefined; }
  if (p.status === 'scheduled' && !canApprovePosts(d, ctx, ctx.actor)) { p.status = 'needs_approval'; p.approvedBy = undefined; p.scheduledFor = undefined; }
  return { ok: true, post: p };
}
/** Draft to "waiting for approval". */
export function submitPost(d: DemoState, ctx: Ctx, id: string): PostResult {
  const p = find(d, id); if (!p) return { ok: false, reason: 'not_found' };
  if (p.status !== 'draft') return { ok: false, reason: 'wrong_state' };
  const problems = postProblems(p); if (problems.length) return { ok: false, reason: 'invalid', problems };
  p.status = 'needs_approval';
  logActivity(d, ctx.actor, 'post.submitted', ref(p), { text: line(p) });
  return { ok: true, post: p };
}
/** An owner or a manager approves a post. It then waits as an approved draft until it is scheduled or published. */
export function approvePost(d: DemoState, ctx: Ctx, id: string): PostResult {
  const p = find(d, id); if (!p) return { ok: false, reason: 'not_found' };
  if (!canApprovePosts(d, ctx, ctx.actor)) return { ok: false, reason: 'not_allowed' };
  if (p.status !== 'needs_approval' && p.status !== 'draft') return { ok: false, reason: 'wrong_state' };
  p.status = 'draft'; p.approvedBy = ctx.actor;
  logActivity(d, ctx.actor, 'post.approved', ref(p), { text: line(p) });
  return { ok: true, post: p };
}
/** Sets the moment a post goes out. Doing so is the approval when the person may approve. */
export function schedulePost(d: DemoState, ctx: Ctx, id: string, when: ISODateTime): PostResult {
  const p = find(d, id); if (!p) return { ok: false, reason: 'not_found' };
  if (!canApprovePosts(d, ctx, ctx.actor)) return { ok: false, reason: 'not_allowed' };
  if (!editable(p)) return { ok: false, reason: 'wrong_state' };
  const problems = postProblems(p); if (problems.length) return { ok: false, reason: 'invalid', problems };
  if (!(new Date(when).getTime() > Date.now())) return { ok: false, reason: 'past' };
  p.status = 'scheduled'; p.scheduledFor = new Date(when).toISOString(); p.approvedBy = p.approvedBy ?? ctx.actor; p.error = undefined;
  logActivity(d, ctx.actor, 'post.scheduled', ref(p), { text: line(p) });
  return { ok: true, post: p };
}
/** Takes a post off the calendar. It stays approved. */
export function unschedulePost(d: DemoState, ctx: Ctx, id: string): PostResult {
  const p = find(d, id); if (!p) return { ok: false, reason: 'not_found' };
  if (!canApprovePosts(d, ctx, ctx.actor)) return { ok: false, reason: 'not_allowed' };
  if (p.status !== 'scheduled') return { ok: false, reason: 'wrong_state' };
  p.status = 'draft'; p.scheduledFor = undefined;
  return { ok: true, post: p };
}
/**
 * Publishes now. Sample workspace: the post is marked `demo`, with the time, and nothing is posted anywhere.
 * Live workspace: the post is handed to the server (scheduled for this moment); the server sets `published` or `failed`.
 */
export function publishPost(d: DemoState, ctx: Ctx, id: string): PostResult {
  const p = find(d, id); if (!p) return { ok: false, reason: 'not_found' };
  if (!canApprovePosts(d, ctx, ctx.actor)) return { ok: false, reason: 'not_allowed' };
  if (!editable(p)) return { ok: false, reason: 'wrong_state' };
  const problems = postProblems(p); if (problems.length) return { ok: false, reason: 'invalid', problems };
  const now = nowIso();
  p.status = publishStatus(); p.approvedBy = p.approvedBy ?? ctx.actor; p.error = undefined;
  if (p.status === 'demo') { p.publishedAt = now; p.scheduledFor = undefined; } else p.scheduledFor = now;
  logActivity(d, ctx.actor, p.status === 'demo' ? 'post.demo' : 'post.queued', ref(p), { text: line(p) });
  return { ok: true, post: p };
}
/** Tries a failed post again, the same way "publish now" does. */
export function retryPost(d: DemoState, ctx: Ctx, id: string): PostResult {
  const p = find(d, id); if (!p) return { ok: false, reason: 'not_found' };
  if (p.status !== 'failed') return { ok: false, reason: 'wrong_state' };
  return publishPost(d, ctx, id);
}
/** Removes a post that never went out. What was published stays in the history. */
export function deletePost(d: DemoState, ctx: Ctx, id: string): boolean {
  const p = find(d, id);
  if (!p || p.status === 'published') return false;
  d.posts = d.posts.filter((x) => x.id !== id);
  logActivity(d, ctx.actor, 'post.deleted', { type: 'post', id }, { text: line(p) });
  return true;
}
