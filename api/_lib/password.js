// Password rules. Length is what makes a password hard to guess, so the rule is length: 12 characters or more.
// There are no "one capital, one digit, one symbol" requirements: they push people toward Password1! and add nothing.
// Instead a password is refused when it is one of the common ones, a common word dressed up with digits, a simple
// run or repetition, or built from the person's own email address.
// (Supabase Auth hashes passwords with bcrypt, which reads at most 72 bytes, so that is the upper limit.)
// The project's Supabase Auth settings should also turn on its leaked-password check where the plan offers it.

export const MIN_LENGTH = 12;
export const MAX_BYTES = 72;

/** Common passwords and the words they are built from. Compared after lowercasing and removing digits and symbols at the ends. */
const COMMON_BASES = new Set([
  'password', 'passw0rd', 'p@ssword', 'p@ssw0rd', 'qwerty', 'qwertyuiop', 'qwertyuiopasdf', 'asdfghjkl', 'zxcvbnm', 'letmein', 'welcome',
  'admin', 'administrator', 'iloveyou', 'monkey', 'dragon', 'football', 'baseball', 'superman', 'batman', 'trustno', 'sunshine',
  'princess', 'starwars', 'whatever', 'changeme', 'changeit', 'default', 'secret', 'master', 'login', 'access', 'hello', 'freedom',
  'michael', 'jennifer', 'jessica', 'charlie', 'shadow', 'summer', 'winter', 'spring', 'autumn', 'january', 'february', 'december',
  'contrasena', 'contraseña', 'bienvenido', 'bienvenida', 'tequiero', 'teamo', 'vyntex', 'vyntexcommand', 'lbscommand', 'lionbusiness',
  'company', 'business', 'office', 'accounting', 'bookkeeping', 'quickbooks', 'taxes', 'payroll',
]);
const COMMON_EXACT = new Set([
  '123456789012', '1234567890123', '12345678901234', '000000000000', '111111111111', '123123123123', '121212121212',
  'qwerty123456', 'password1234', 'password12345', 'passwordpassword', 'qwertyqwerty', '1q2w3e4r5t6y', '1qaz2wsx3edc', 'zaq12wsxcde3',
  'abcdefghijkl', 'abcdefghijklm', 'aaaaaaaaaaaa', 'abc123abc123', 'iloveyou1234', 'letmein12345', 'welcome12345', 'admin1234567',
  'correcthorsebatterystaple', 'thisismypassword', 'mypassword123', 'changeme1234', 'password!234', 'p@ssw0rd1234',
]);

const strip = (s) => s.toLowerCase().replace(/^[^a-zñ]+|[^a-zñ]+$/g, '');
/** True for one short piece repeated (abcabcabcabc) or a run up or down the keyboard row or the alphabet (123456789012). */
function trivialPattern(p) {
  const s = p.toLowerCase();
  for (let n = 1; n <= 4; n++) if (s.length % n === 0 && s === s.slice(0, n).repeat(s.length / n)) return true;
  let up = true; let down = true;
  for (let i = 1; i < s.length; i++) { const d = s.charCodeAt(i) - s.charCodeAt(i - 1); if (d !== 1) up = false; if (d !== -1) down = false; }
  return up || down;
}

/**
 * Checks a new password. Returns null when it is acceptable, or a code:
 *   too_short | too_long | common | pattern | contains_email
 */
export function passwordProblem(password, email = '') {
  if (typeof password !== 'string') return 'too_short';
  if ([...password].length < MIN_LENGTH) return 'too_short';
  if (Buffer.byteLength(password, 'utf8') > MAX_BYTES) return 'too_long';
  const lower = password.toLowerCase();
  if (COMMON_EXACT.has(lower)) return 'common';
  const core = strip(password);
  if (COMMON_BASES.has(core)) return 'common';
  // the same common word twice or three times in a row (passwordpassword)
  for (const n of [2, 3]) if (core.length % n === 0 && COMMON_BASES.has(core.slice(0, core.length / n)) && core === core.slice(0, core.length / n).repeat(n)) return 'common';
  if (trivialPattern(password)) return 'pattern';
  const mail = String(email || '').trim().toLowerCase();
  if (mail) {
    const local = mail.split('@')[0];
    const domain = (mail.split('@')[1] || '').split('.')[0];
    if (lower.includes(mail)) return 'contains_email';
    if (local.length >= 4 && lower.includes(local)) return 'contains_email';
    if (domain.length >= 5 && strip(password) === domain) return 'contains_email';
  }
  return null;
}
