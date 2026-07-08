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

export function generatePassword(
  length = 20,
  opts: { upper?: boolean; lower?: boolean; digits?: boolean; symbols?: boolean } = {},
): string {
  const { upper = true, lower = true, digits = true, symbols = true } = opts
  let charset = ''
  if (lower) charset += 'abcdefghijkmnopqrstuvwxyz'
  if (upper) charset += 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  if (digits) charset += '23456789'
  if (symbols) charset += '!@#$%^&*()-_=+[]{};:,.<>?'
  if (!charset) charset = 'abcdefghijkmnopqrstuvwxyz'
  const values = new Uint32Array(length)
  crypto.getRandomValues(values)
  let out = ''
  for (let i = 0; i < length; i++) {
    out += charset[values[i]! % charset.length]
  }
  return out
}
