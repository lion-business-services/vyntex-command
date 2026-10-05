// Builds the RFC 2822 text of an email for the Gmail API (plain text and HTML, optional attachments, reply headers).
// Every value that ends up in a header is reduced to one line first, so a subject or a name can never add a header.
import { randomBytes } from 'node:crypto';

const oneLine = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();
/** Non ASCII header text as an RFC 2047 encoded word. */
const word = (v) => (/^[\x20-\x7e]*$/.test(v) ? v : '=?UTF-8?B?' + Buffer.from(v).toString('base64') + '?=');
const wrap = (b64) => b64.replace(/(.{76})/g, '$1\r\n');
const b64 = (v) => wrap(Buffer.from(v).toString('base64'));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const textToHtml = (text) => '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">' + esc(text).replace(/\r?\n/g, '<br>') + '</div>';
const safeName = (n) => oneLine(n).replace(/["\\\/]/g, '').slice(0, 120) || 'attachment';
const MSG_ID = /^<[^<>\s]{3,300}>$/;
const TYPE = /^[\w.+-]{1,60}\/[\w.+-]{1,80}$/;

/**
 * msg: { from, fromName?, to[], cc?[], bcc?[], subject, text, html?, messageId?, inReplyTo?, references?,
 *        attachments?: [{ filename, contentType, data: Buffer }] }
 * Addresses must already be checked by the caller. Returns the message as a string with CRLF line ends.
 */
export function buildMime(msg) {
  const alt = 'vxa_' + randomBytes(12).toString('hex');
  const text = String(msg.text ?? '');
  const altPart = [
    `--${alt}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', b64(text),
    `--${alt}`, 'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', b64(msg.html || textToHtml(text)),
    `--${alt}--`,
  ];
  const name = oneLine(msg.fromName).replace(/["\\<>]/g, '');
  const head = [
    `From: ${name ? `"${word(name)}" ` : ''}<${msg.from}>`,
    `To: ${msg.to.join(', ')}`,
    msg.cc && msg.cc.length ? `Cc: ${msg.cc.join(', ')}` : null,
    msg.bcc && msg.bcc.length ? `Bcc: ${msg.bcc.join(', ')}` : null,
    `Subject: ${word(oneLine(msg.subject))}`,
    msg.messageId && MSG_ID.test(msg.messageId) ? `Message-ID: ${msg.messageId}` : null,
  ];
  // Reply threading: mail programs join a conversation by these two headers (Gmail also needs the thread id and the
  // same subject, which the adapter sends alongside).
  if (msg.inReplyTo && MSG_ID.test(msg.inReplyTo)) {
    const refs = oneLine(msg.references).split(/\s+/).filter((r) => MSG_ID.test(r));
    if (!refs.includes(msg.inReplyTo)) refs.push(msg.inReplyTo);
    head.push(`In-Reply-To: ${msg.inReplyTo}`, `References: ${refs.slice(-20).join(' ')}`);
  }
  head.push('MIME-Version: 1.0');
  const lines = head.filter(Boolean);
  const files = (msg.attachments || []).filter((a) => a && Buffer.isBuffer(a.data) && a.data.length);
  if (!files.length) return [...lines, `Content-Type: multipart/alternative; boundary="${alt}"`, '', ...altPart, ''].join('\r\n');
  const mix = 'vxm_' + randomBytes(12).toString('hex');
  const parts = [...lines, `Content-Type: multipart/mixed; boundary="${mix}"`, '', `--${mix}`, `Content-Type: multipart/alternative; boundary="${alt}"`, '', ...altPart];
  for (const a of files) {
    const file = safeName(a.filename);
    const type = TYPE.test(String(a.contentType || '')) ? a.contentType : 'application/octet-stream';
    // RFC 2231 form for the name, so accents survive; the plain form is kept beside it for older programs.
    const star = `UTF-8''${encodeURIComponent(file)}`;
    parts.push(`--${mix}`, `Content-Type: ${type}; name="${word(file)}"`, `Content-Disposition: attachment; filename="${word(file)}"; filename*=${star}`, 'Content-Transfer-Encoding: base64', '', wrap(a.data.toString('base64')));
  }
  parts.push(`--${mix}--`, '');
  return parts.join('\r\n');
}

/** "Name <a@b.c>, other@x.y" -> [{ name, email }] with the email in lower case. */
export function parseAddresses(value) {
  const out = [];
  const re = /(?:"?([^"<,]*?)"?\s*<([^>\s]+)>|([^\s,<>]+@[^\s,<>]+))/g;
  let m;
  while ((m = re.exec(String(value || ''))) && out.length < 50) out.push({ name: (m[1] || '').trim(), email: (m[2] || m[3] || '').trim().toLowerCase() });
  return out;
}
