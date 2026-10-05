// What the end-to-end tests use to act as people: a real Chromium, one browser context per person (its own cookies, its
// own storage, its own network address as a proxy would report it), and a way to make a crafted request from inside
// that person's page, with their cookies, the way an attacker with a signed-in browser would.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export async function launch() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch { throw new Error('Playwright is not installed where Node can find it (set NODE_PATH to the folder that holds it).'); }
  return chromium.launch(fs.existsSync(CHROME) ? { executablePath: CHROME } : {});
}

let people = 0;
/**
 * One person at one browser. `errors` collects uncaught page errors and console errors other than failed requests
 * (a refused request is logged by the browser as an error; whether it was expected is the test's business, through `statuses`).
 */
export async function person(browser, origin, { width = 1440, height = 900, locale = 'en-US' } = {}) {
  people += 1;
  const address = `198.51.100.${people}`;
  const context = await browser.newContext({ viewport: { width, height }, locale, acceptDownloads: true, extraHTTPHeaders: { 'x-real-ip': address } });
  // no internet here: the font files are not part of what is tested
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  // generous: the machine that runs this may be busy with other work, and nothing here depends on being fast
  context.setDefaultTimeout(Number(process.env.E2E_TIMEOUT_MS) || 90000);
  const page = await context.newPage();
  const errors = []; const statuses = []; const applies = [];
  page.on('pageerror', (e) => errors.push('page error: ' + String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_RESET/.test(m.text())) errors.push('console: ' + m.text().slice(0, 300)); });
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) statuses.push(`${r.status()} ${new URL(r.url()).pathname}`);
    // every answer to a change request, so a test can say that nothing was refused (or exactly what was)
    if (r.url().endsWith('/api/ws/apply')) r.json().then((j) => applies.push(j), () => undefined);
  });

  /**
   * A request made by script inside the person's page: their cookies travel, and the browser sets Origin itself.
   * `csrf`: true sends the value the server handed out, false sends none, a string sends that string.
   */
  const api = (method, url, body, { csrf = true, headers = {} } = {}) => page.evaluate(async ({ method, url, body, csrf, headers }) => {
    const h = { ...headers };
    if (method !== 'GET') {
      h['content-type'] = 'application/json';
      if (csrf === true) { const s = await (await fetch('/api/auth/session', { headers: { 'x-vx-passive': '1' } })).json(); h['x-vx-csrf'] = s.csrf; } else if (typeof csrf === 'string') h['x-vx-csrf'] = csrf;
    }
    const res = await fetch(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await res.json(); } catch { /* not JSON */ }
    return { status: res.status, json };
  }, { method, url, body, csrf, headers });

  const saved = (timeout = 60000) => page.waitForSelector('[data-testid=sync-status][data-state=saved]', { timeout });
  /** Does something on the page and waits until the change request it causes was answered and the indicator says saved. */
  const synced = async (action) => {
    const n = applies.length;
    await action();
    for (const t0 = Date.now(); applies.length === n;) { if (Date.now() - t0 > 60000) throw new Error('the page sent no change request'); await new Promise((r) => setTimeout(r, 40)); }
    await saved();
  };
  return {
    context, page, errors, statuses, applies, origin, address, api, saved, synced,
    go: (p) => page.goto(origin + p),
    workspace: (timeout = 90000) => page.waitForSelector('.shell .side-brand', { timeout }),
    close: () => context.close(),
  };
}

/** Types email and password into the sign-in form that is on screen and sends it. */
export async function fillSignIn(p, email, password) {
  await p.page.waitForSelector('[data-testid=auth-form]');
  await p.page.fill('[data-testid=auth-email]', email);
  await p.page.fill('[data-testid=auth-password]', password);
  await p.page.keyboard.press('Enter');
}
/** Types a six-digit code into the code field on screen (it sends itself on the sixth digit). */
export async function typeCode(p, code, selector = '[data-testid=auth-code]') {
  await p.page.waitForSelector(selector);
  await p.page.fill(selector, code);
}

/**
 * Moves the stamps inside a person's sealed session cookie, the way time passing would: the test process holds the same
 * secret as the test server, opens the cookie, changes `last` (activity) or `iat` (sign-in time) and seals it again.
 */
export async function ageSession(deployment, p, { idleMinutes, ageHours }) {
  Object.assign(process.env, { VX_ENV: 'test', SESSION_SECRET: deployment.secrets.SESSION_SECRET });
  delete process.env.SESSION_SECRET_PREVIOUS; delete process.env.VERCEL_ENV;
  const S = await import('../../api/_lib/session.js');
  const cookies = await p.context.cookies(deployment.origin);
  const header = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const { session } = S.openSession(new Request(deployment.origin + '/x', { headers: { cookie: header } }));
  if (!session) throw new Error('the session cookie did not open');
  const now = Math.floor(Date.now() / 1000);
  if (idleMinutes !== undefined) session.last = now - idleMinutes * 60;
  if (ageHours !== undefined) session.iat = now - ageHours * 3600;
  const next = [];
  for (const c of S.sessionCookies(session)) {
    const [pair] = c.split(';'); const i = pair.indexOf('=');
    const name = pair.slice(0, i); const value = pair.slice(i + 1);
    if (value) next.push({ name, value, url: deployment.origin, httpOnly: true, sameSite: 'Lax' });
  }
  await p.context.addCookies(next);
}

/** Reads the QR code on screen with OpenCV, from a picture of the element: what a phone camera would get. */
export async function readQr(p, selector = '[data-testid=auth-qr]') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-qr-shot-'));
  const file = path.join(dir, 'qr.png');
  await p.page.locator(selector).screenshot({ path: file });
  const r = spawnSync('python3', ['-c', `
import sys, cv2
img = cv2.imread(sys.argv[1])
img = cv2.copyMakeBorder(img, 40, 40, 40, 40, cv2.BORDER_CONSTANT, value=(255, 255, 255))
out = ''
for d in [cv2.QRCodeDetector()] + ([cv2.QRCodeDetectorAruco()] if hasattr(cv2, 'QRCodeDetectorAruco') else []):
    for scale in (1, 2, 3):
        big = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
        try:
            got, _, _ = d.detectAndDecode(big)
        except cv2.error:
            got = ''
        if got:
            out = got
            break
    if out:
        break
print(out)
`, file], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return r.stdout.trim();
}

/** A screenshot for a person to look at afterwards. Outside the repository: E2E_SHOTS, or a folder under the temporary folder. */
export const SHOTS = process.env.E2E_SHOTS || path.join(os.tmpdir(), 'vx-e2e-shots');
export async function shot(p, name) {
  const dir = SHOTS;
  fs.mkdirSync(dir, { recursive: true });
  await p.page.screenshot({ path: path.join(dir, name + '.png') });
}
