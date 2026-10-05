// /api/public/*: what people outside the company reach. Nobody is signed in here. A request is addressed by a
// private link (a random token the server made and emailed) or, for the website form, by the company's form key.
//
//   POST sign/view | opened | submit | decline   { token, ... }      the signing page (src/features/public/sign.tsx)
//   GET  sign/file?k=<sealed value>                                  the PDF a signer reads, for five minutes
//   GET  review/<token>                                              the review page (src/features/public/review.tsx)
//   POST review/<token>                          { rating, comment } or { decline: true }
//   POST intake/<form key>                       a lead from the company's website form (JSON or an HTML form post)
//   POST office/<name>                           signed-in members only: see api/_lib/public/office.js
//
// The rules every token route keeps (api/_lib/public/core.js):
//   * the token is 256 random bits; only its hash is stored; it is good for one purpose, until one date, for one answer
//   * it travels in the request body (signing) or the path (reviews), and never reaches a log line
//   * every route is limited per address and per token, and has its own body size limit
//   * one answer, "cannot_be_opened", for an unknown, expired, used, revoked or misshapen token
//   * no cross-origin permission is ever given (no Access-Control header exists in this file), and a POST that
//     names another site as its origin is refused
// The service role is used throughout, because there is no person's token: every database function called from here
// is granted to the server only and takes the token's hash as its key.
import { entry, fail, methodNotAllowed } from './_lib/respond.js';
import { assertConfigured } from './_lib/guard.js';
import { cannotOpen, isToken, publicLimits, assertSameSite, body } from './_lib/public/core.js';
import { reviewGet, reviewPost } from './_lib/public/reviews.js';
import { intake } from './_lib/public/intake.js';
import { office } from './_lib/public/office.js';

const SIGN_BYTES = { view: 2048, opened: 2048, decline: 8 * 1024, submit: 512 * 1024 };

async function sign(request, action) {
  const signing = await import('./_lib/esign/signing.js');
  if (action === 'file') {
    if (request.method !== 'GET') return methodNotAllowed('GET');
    await publicLimits(request, 'sign.file', new URL(request.url).searchParams.get('k') || '', { perAddress: 60, perToken: 20 });
    return signing.file(request);
  }
  if (!Object.hasOwn(SIGN_BYTES, action)) return fail(404, 'not_found');
  if (request.method !== 'POST') return methodNotAllowed('POST');
  assertSameSite(request);
  // The address is counted before the body is read, so a flood of large bodies is cut off early.
  await publicLimits(request, 'sign', null, { perAddress: 120 });
  const b = await body(request, SIGN_BYTES[action]);
  await publicLimits(request, 'sign.' + action, typeof b.token === 'string' ? b.token.slice(0, 200) : '', { perAddress: 60, perToken: action === 'view' ? 30 : 12 });
  if (!isToken(b.token)) return cannotOpen();
  if (action === 'view') return signing.view(request, b.token);
  if (action === 'opened') return signing.opened(request, b.token);
  if (action === 'submit') return signing.submit(request, b.token, b);
  return signing.decline(request, b.token, b);
}

const routes = entry('public', async (request, path) => {
  const m = request.method;
  // A browser asking whether another site may call this gets no permission and no hint.
  if (m === 'OPTIONS') return methodNotAllowed('GET, POST');
  assertConfigured();
  const [area, rest, more] = path.split('/');
  if (more !== undefined) return fail(404, 'not_found');
  if (area === 'sign' && rest) return sign(request, rest);
  if (area === 'review' && rest) return m === 'GET' ? reviewGet(request, rest) : m === 'POST' ? reviewPost(request, rest) : methodNotAllowed('GET, POST');
  if (area === 'intake' && rest) return m === 'POST' ? intake(request, rest) : methodNotAllowed('POST');
  if (area === 'office' && rest) return m === 'POST' ? office(request, rest) : methodNotAllowed('POST');
  return fail(404, 'not_found');
});

/**
 * A review link whose last part is not even made of the characters a token uses never reaches the routes above
 * (entry() answers "not found" for such a path). It gets the same answer as any other link that does not open.
 */
async function handle(request) {
  const p = new URL(request.url).pathname;
  if (p.startsWith('/api/public/review/') && !/^[A-Za-z0-9_-]+$/.test(p.slice('/api/public/review/'.length).replace(/\/+$/, ''))) {
    try { await publicLimits(request, 'review', null); } catch { return fail(429, 'rate_limited'); }
    return cannotOpen();
  }
  return routes(request);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
