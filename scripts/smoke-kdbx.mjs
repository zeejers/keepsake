// Smoke test: verifies the argon2 wiring (hash-wasm <-> kdbxweb) by creating
// a kdbx4 database with the Argon2id KDF, saving it, and loading it back.
// Run: node scripts/smoke-kdbx.mjs
import kdbxwebNs from 'kdbxweb'
import { argon2d, argon2id } from 'hash-wasm'

// Node's CJS interop puts kdbxweb's classes on the default export;
// in the Vite/browser build they're proper named exports.
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

const creds = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString('test-password-123'))
const db = kdbxweb.Kdbx.create(creds, 'SmokeTest')
db.setVersion(4)
db.setKdf(kdbxweb.Consts.KdfId.Argon2id)

const root = db.getDefaultGroup()
const group = db.createGroup(root, 'learning')
const entry = db.createEntry(group)
entry.fields.set('Title', 'Udemy')
entry.fields.set('UserName', 'someone@example.com')
entry.fields.set('Password', kdbxweb.ProtectedValue.fromString('s3cret!'))

// attachment round-trip through the kdbx4 binary pool
const fileBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3, 4, 5])
const binary = await db.createBinary(fileBytes.buffer.slice(0))
entry.binaries.set('recovery-codes.pdf', binary)

const saved = await db.save()
console.log(`saved ${saved.byteLength} bytes (kdbx4 / argon2id)`)

const creds2 = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString('test-password-123'))
const db2 = await kdbxweb.Kdbx.load(saved, creds2)
const g2 = db2.getDefaultGroup().groups.find((g) => g.name === 'learning')
const e2 = g2.entries[0]
const title = e2.fields.get('Title')
const pass = e2.fields.get('Password').getText()
if (title !== 'Udemy' || pass !== 's3cret!') {
  throw new Error(`round-trip mismatch: ${title} / ${pass}`)
}

const bin2 = e2.binaries.get('recovery-codes.pdf')
if (!bin2) throw new Error('attachment missing after reload')
const binValue = bin2.value ?? bin2
const bytes2 =
  binValue instanceof kdbxweb.ProtectedValue ? binValue.getBinary() : new Uint8Array(binValue)
if (bytes2.length !== fileBytes.length || !bytes2.every((b, i) => b === fileBytes[i])) {
  throw new Error('attachment bytes corrupted in round-trip')
}
console.log('attachment round-trip verified')

// wrong password must fail with InvalidKey
try {
  await kdbxweb.Kdbx.load(saved.slice(0), new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString('wrong')))
  throw new Error('expected InvalidKey error')
} catch (err) {
  if (!(err instanceof kdbxweb.KdbxError) || err.code !== kdbxweb.Consts.ErrorCodes.InvalidKey) {
    throw err
  }
}

console.log('OK: create → save → reload round-trip verified, wrong password rejected')
