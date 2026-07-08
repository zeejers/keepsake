// Lightweight fuzzy matcher: substring beats subsequence, earlier and tighter
// matches score higher. Returns -1 when the query doesn't match at all.
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().trim()
  const t = text.toLowerCase()
  if (!q) return 0
  if (!t) return -1

  const idx = t.indexOf(q)
  if (idx >= 0) {
    let score = 1000 - idx * 4 - (t.length - q.length)
    if (idx === 0) score += 200
    return score
  }

  // subsequence match with gap penalty
  let ti = 0
  let gaps = 0
  let firstHit = -1
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi]!, ti)
    if (found < 0) return -1
    if (firstHit < 0) firstHit = found
    gaps += found - ti
    ti = found + 1
  }
  return 400 - gaps * 8 - firstHit * 2 - (t.length - q.length)
}

// Ambiguous look-alikes (l/I, O/0, 1) are deliberately excluded.
const LOWER = 'abcdefghijkmnopqrstuvwxyz'
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'
export const DEFAULT_SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>?'

export interface PasswordOptions {
  upper?: boolean
  lower?: boolean
  digits?: boolean
  symbols?: boolean
  /** which symbols to draw from when `symbols` is on */
  symbolSet?: string
}

/** Unbiased random int in [0, max) via rejection sampling. */
function randomInt(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max
  const buf = new Uint32Array(1)
  do {
    crypto.getRandomValues(buf)
  } while (buf[0]! >= limit)
  return buf[0]! % max
}

export function generatePassword(length = 20, opts: PasswordOptions = {}): string {
  const { upper = true, lower = true, digits = true, symbols = true } = opts
  const symbolSet = [...new Set(opts.symbolSet ?? DEFAULT_SYMBOLS)].join('')
  const classes: string[] = []
  if (lower) classes.push(LOWER)
  if (upper) classes.push(UPPER)
  if (digits) classes.push(DIGITS)
  if (symbols && symbolSet) classes.push(symbolSet)
  if (!classes.length) classes.push(LOWER)
  const pool = classes.join('')
  // one char from each enabled class so all of them are represented…
  const chars = classes.slice(0, Math.min(classes.length, length)).map((c) => c[randomInt(c.length)]!)
  while (chars.length < length) chars.push(pool[randomInt(pool.length)]!)
  // …then shuffle so those guaranteed chars aren't clustered at the front
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j]!, chars[i]!]
  }
  return chars.join('')
}
