// Generates demo.kdbx (password: "demo") with sample groups/entries for testing.
// Run: node scripts/make-demo.mjs
import { writeFileSync } from 'node:fs'
import kdbxwebNs from 'kdbxweb'
import { argon2d, argon2id } from 'hash-wasm'

const kdbxweb = kdbxwebNs

kdbxweb.CryptoEngine.setArgon2Impl(
  async (password, salt, memory, iterations, length, parallelism, type, _version) => {
    const fn = type === 0 ? argon2d : argon2id
    const hash = await fn({
      password: new Uint8Array(password),
      salt: new Uint8Array(salt),
      parallelism,
      iterations,
      memorySize: memory,
      hashLength: length,
      outputType: 'binary',
    })
    return hash.slice().buffer
  },
)

const creds = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString('demo'))
const db = kdbxweb.Kdbx.create(creds, 'Demo Vault')
db.setVersion(4)
db.setKdf(kdbxweb.Consts.KdfId.Argon2id)

const root = db.getDefaultGroup()

const data = {
  coding: [
    ['GitHub', 'demo@example.com', 'gh-p@ssw0rd', 'https://github.com'],
    ['GitLab', 'demo@example.com', 'gl-p@ssw0rd', 'https://gitlab.com'],
  ],
  finance: [
    ['Chase', 'demo-user', 'ch@se-secret', 'https://chase.com'],
    ['Fidelity', 'demo-user', 'f1delity!', 'https://fidelity.com'],
  ],
  learning: [['Udemy', 'demo@example.com', 'udemy-pass!', 'https://udemy.com']],
  social: [
    ['Reddit', 'demo-user', 'redd1t-pw', 'https://reddit.com'],
    ['Bluesky', 'demo.example.com', 'bsky-pw!', 'https://bsky.app'],
  ],
  home: [['Router Admin', 'admin', 'changeme123', 'http://192.168.1.1']],
}

for (const [groupName, entries] of Object.entries(data)) {
  const group = db.createGroup(root, groupName)
  for (const [title, user, pass, url] of entries) {
    const entry = db.createEntry(group)
    entry.fields.set('Title', title)
    entry.fields.set('UserName', user)
    entry.fields.set('Password', kdbxweb.ProtectedValue.fromString(pass))
    entry.fields.set('URL', url)
  }
}

const buffer = await db.save()
writeFileSync(new URL('../demo.kdbx', import.meta.url), Buffer.from(buffer))
console.log('wrote demo.kdbx (password: demo)')
