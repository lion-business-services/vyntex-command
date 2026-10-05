// Checks the QR encoder of the sign-in pages (src/features/auth/qr.ts) with a decoder that shares no code with it:
// every symbol is drawn as a picture and read back by OpenCV (tests/e2e/qr_decode.py). The texts are authenticator
// addresses of the kind the server returns, and one text for every symbol size the encoder supports (versions 1 to 20).
//   node tests/e2e/qr_check.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from '../unit/bundle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { qrMatrix } = await load(`export { qrMatrix } from '@/features/auth/qr';`);

const texts = ['A', 'hello world',
  'otpauth://totp/LBS%20Command:owner-e2e-practice-mgb1x2%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=LBS%20Command&algorithm=SHA1&digits=6&period=30',
  'otpauth://totp/VYNTEX%20Command:someone%40example.com?secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567&issuer=VYNTEX%20Command&algorithm=SHA1&digits=6&period=30',
  'ñandú 中文 end'];
// the longest text each version holds at level M, so every size and every block layout is exercised
for (const len of [14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666]) {
  texts.push(Array.from({ length: len }, (_, i) => 'abcdefghijklmnopqrstuvwxyz0123456789:/?=&%'[(i * 7 + len) % 42]).join(''));
}
let tooLong = false;
try { qrMatrix('x'.repeat(667)); } catch { tooLong = true; }

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vx-qr-')), 'cases.json');
fs.writeFileSync(file, JSON.stringify(texts.map((text) => ({ text, m: qrMatrix(text).map((r) => r.map((v) => (v ? 1 : 0))) }))));
const r = spawnSync('python3', [path.join(here, 'qr_decode.py'), file], { encoding: 'utf8' });
process.stdout.write(r.stdout); process.stderr.write(r.stderr);
fs.rmSync(path.dirname(file), { recursive: true, force: true });
if (!tooLong) { console.error('a text longer than the largest supported symbol must be refused'); process.exit(1); }
process.exit(r.status === 0 ? 0 : 1);
