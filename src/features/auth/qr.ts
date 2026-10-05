// A small QR code encoder, written here because the page may load no outside script and there is no library to install.
// It exists for one job: drawing the `otpauth://` address of an authenticator app, about 150 characters, so that a phone
// can scan it. Byte mode, error correction level M, versions 1 to 20 (up to 666 bytes), all eight masks scored by the
// standard's penalty rules. Checked against a separate decoder in tests/e2e (the picture is read back to the same text).
// Reference: ISO/IEC 18004.

/** Per version (index 0 is version 1), level M: error correction bytes per block, then pairs of (blocks, data bytes per block). */
const BLOCKS: readonly (readonly number[])[] = [
  [10, 1, 16], [16, 1, 28], [26, 1, 44], [18, 2, 32], [24, 2, 43], [16, 4, 27], [18, 4, 31], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
  [30, 1, 50, 4, 51], [22, 6, 36, 2, 37], [22, 8, 37, 1, 38], [24, 4, 40, 5, 41], [24, 5, 41, 5, 42], [28, 7, 45, 3, 46], [28, 10, 46, 1, 47], [26, 9, 43, 4, 44],
  [26, 3, 44, 11, 45], [26, 3, 41, 13, 42],
];
/** Centres of the alignment patterns per version. */
const ALIGN: readonly (readonly number[])[] = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62],
  [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
];

// arithmetic in GF(256) with the polynomial x^8 + x^4 + x^3 + x^2 + 1
const EXP = new Uint8Array(512); const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a: number, b: number) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** Reed-Solomon error correction bytes for one block. */
function ecBytes(data: number[], count: number): number[] {
  let gen = [1];
  for (let i = 0; i < count; i++) { const next = new Array<number>(gen.length + 1).fill(0); for (let j = 0; j < gen.length; j++) { next[j] ^= gen[j]; next[j + 1] ^= mul(gen[j], EXP[i]); } gen = next; }
  const rem = new Array<number>(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.shift(); rem.push(0);
    for (let j = 0; j < count; j++) rem[j] ^= mul(gen[j + 1], factor);
  }
  return rem;
}

const dataBytes = (version: number) => { const b = BLOCKS[version - 1]; let n = 0; for (let i = 1; i < b.length; i += 2) n += b[i] * b[i + 1]; return n; };
const utf8 = (text: string): number[] => Array.from(new TextEncoder().encode(text));

/** The data and error correction bytes in the order they are placed: blocks interleaved, data first. */
function codewords(bytes: number[], version: number): number[] {
  const capacity = dataBytes(version);
  const bits: number[] = [];
  const put = (value: number, length: number) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  put(0b0100, 4);                                   // byte mode
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  for (let i = 0; i < 4 && bits.length < capacity * 8; i++) bits.push(0);   // terminator
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);

  const spec = BLOCKS[version - 1]; const ec = spec[0];
  const blocks: { data: number[]; ec: number[] }[] = [];
  let at = 0;
  for (let i = 1; i < spec.length; i += 2) for (let n = 0; n < spec[i]; n++) { const d = data.slice(at, at + spec[i + 1]); at += spec[i + 1]; blocks.push({ data: d, ec: ecBytes(d, ec) }); }
  const out: number[] = [];
  const longest = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) out.push(b.ec[i]);
  return out;
}

/** The 15 format bits (level M and the mask) with their error correction, and the 18 version bits for version 7 and up. */
function formatBits(mask: number): number {
  const value = mask;   // level M is 00, so the five data bits are the mask number
  let rem = value << 10;
  for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
  return ((value << 10) | rem) ^ 0x5412;
}
function versionBits(version: number): number {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) if ((rem >>> i) & 1) rem ^= 0x1f25 << (i - 12);
  return (version << 12) | rem;
}

const MASKS: readonly ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (_r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** How hard a finished symbol is for a scanner to read, by the four rules of the standard. Lower is better. */
function penalty(m: boolean[][]): number {
  const n = m.length; let score = 0;
  const line = (get: (i: number, j: number) => boolean) => {
    for (let i = 0; i < n; i++) {
      let run = 1;
      for (let j = 1; j <= n; j++) {
        if (j < n && get(i, j) === get(i, j - 1)) { run++; continue; }
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
      // a finder-like pattern (dark, light, three dark, light, dark) next to four light modules
      for (let j = 0; j + 6 < n; j++) {
        if (get(i, j) && !get(i, j + 1) && get(i, j + 2) && get(i, j + 3) && get(i, j + 4) && !get(i, j + 5) && get(i, j + 6)) {
          const light = (from: number) => { for (let k = from; k < from + 4; k++) if (k >= 0 && k < n && get(i, k)) return false; return true; };
          if (light(j - 4) || light(j + 7)) score += 40;
        }
      }
    }
  };
  line((i, j) => m[i][j]); line((i, j) => m[j][i]);
  let dark = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (m[r][c]) dark++;
    if (r + 1 < n && c + 1 < n && m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) score += 3;
  }
  return score + Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
}

/**
 * The symbol for a text: a square of dark (true) and light modules, without the quiet border.
 * Throws when the text is longer than version 20 holds (666 bytes), which an authenticator address never is.
 */
export function qrMatrix(text: string): boolean[][] {
  const bytes = utf8(text);
  let version = 1;
  while (version <= 20 && bytes.length + (version < 10 ? 2 : 3) > dataBytes(version)) version++;
  if (version > 20) throw new Error('too long for a QR code');
  const n = 17 + version * 4;
  const dark: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const fixed: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const set = (r: number, c: number, v: boolean) => { if (r >= 0 && r < n && c >= 0 && c < n) { dark[r][c] = v; fixed[r][c] = true; } };

  // the three finder patterns with their light border
  for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      set(r0 + r, c0 + c, ring !== 2 && ring <= 3);
    }
  }
  // alignment patterns, except where a finder pattern is
  const centres = ALIGN[version - 1];
  for (const r of centres) for (const c of centres) {
    if ((r === 6 && c === 6) || (r === 6 && c === n - 7) || (r === n - 7 && c === 6)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  // timing patterns and the module that is always dark
  for (let i = 8; i < n - 8; i++) { if (!fixed[6][i]) set(6, i, i % 2 === 0); if (!fixed[i][6]) set(i, 6, i % 2 === 0); }
  set(n - 8, 8, true);
  // room for the format bits (filled in per mask below) and the version bits
  for (let i = 0; i < 9; i++) { if (!fixed[8][i]) set(8, i, false); if (!fixed[i][8]) set(i, 8, false); }
  for (let i = 0; i < 8; i++) { set(8, n - 1 - i, false); if (i < 7) set(n - 1 - i, 8, dark[n - 1 - i][8]); }
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) { const v = ((bits >>> i) & 1) === 1; const a = Math.floor(i / 3); const b = n - 11 + (i % 3); set(a, b, v); set(b, a, v); }
  }

  // the data, in the zigzag from the bottom right corner, two columns at a time, skipping the vertical timing column
  const words = codewords(bytes, version);
  const stream: number[] = [];
  for (const w of words) for (let i = 7; i >= 0; i--) stream.push((w >>> i) & 1);
  let k = 0; let up = true;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let i = 0; i < n; i++) {
      const r = up ? n - 1 - i : i;
      for (const c of [right, right - 1]) if (!fixed[r][c]) { dark[r][c] = k < stream.length && stream[k] === 1; k++; }
    }
    up = !up;
  }

  // the mask that leaves the most readable symbol
  let best: boolean[][] | null = null; let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = dark.map((row, r) => row.map((v, c) => (fixed[r][c] ? v : v !== MASKS[mask](r, c))));
    const f = formatBits(mask);
    const bit = (i: number) => ((f >>> i) & 1) === 1;
    // first copy: around the top left finder pattern
    for (let i = 0; i <= 5; i++) m[8][i] = bit(14 - i);
    m[8][7] = bit(8); m[8][8] = bit(7); m[7][8] = bit(6);
    for (let i = 0; i <= 5; i++) m[5 - i][8] = bit(5 - i);
    // second copy: below the top right and beside the bottom left finder patterns
    for (let i = 0; i <= 6; i++) m[n - 1 - i][8] = bit(14 - i);
    for (let i = 0; i <= 7; i++) m[8][n - 8 + i] = bit(7 - i);
    const score = penalty(m);
    if (score < bestScore) { bestScore = score; best = m; }
  }
  return best as boolean[][];
}

/** The symbol as one SVG path (unit squares), with the side length including a quiet border of four modules. */
export function qrPath(text: string): { d: string; size: number } {
  const m = qrMatrix(text); const n = m.length; const q = 4;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!m[r][c]) continue;
      let run = 1;
      while (c + run < n && m[r][c + run]) run++;
      d += `M${c + q} ${r + q}h${run}v1h-${run}z`;
      c += run - 1;
    }
  }
  return { d, size: n + q * 2 };
}
