import * as kdbxweb from 'kdbxweb'
import { readFile, writeFile, copyFile } from '@tauri-apps/plugin-fs'
import * as dropbox from './dropbox'

// kdbxweb has no built-in argon2; ours runs hash-wasm in a Web Worker so the
// UI never freezes during key derivation (unlock and every save re-derive).
// kdbxweb passes `memory` in KiB, which matches hash-wasm's memorySize unit.
let worker: Worker | null = null
let argon2RequestId = 0
const argon2Pending = new Map<
  number,
  { resolve: (hash: ArrayBuffer) => void; reject: (err: Error) => void }
>()

function argon2Worker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./argon2.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent) => {
      const { id, ok, hash, error } = e.data as {
        id: number
        ok: boolean
        hash?: ArrayBuffer
        error?: string
      }
      const pending = argon2Pending.get(id)
      if (!pending) return
      argon2Pending.delete(id)
      if (ok && hash) pending.resolve(hash)
      else pending.reject(new Error(error ?? 'argon2 failed'))
    }
    worker.onerror = (e) => {
      for (const pending of argon2Pending.values()) {
        pending.reject(new Error(e.message || 'argon2 worker crashed'))
      }
      argon2Pending.clear()
    }
  }
  return worker
}

let cryptoReady = false
function initCrypto() {
  if (cryptoReady) return
  cryptoReady = true
  kdbxweb.CryptoEngine.setArgon2Impl(
    (password, salt, memory, iterations, length, parallelism, type, _version) => {
      const id = ++argon2RequestId
      return new Promise<ArrayBuffer>((resolve, reject) => {
        argon2Pending.set(id, { resolve, reject })
        argon2Worker().postMessage({
          id,
          password,
          salt,
          memory,
          iterations,
          length,
          parallelism,
          type,
        })
      })
    },
  )
}

// ---- vault sources ----

export type VaultSource =
  | { kind: 'file'; path: string }
  | { kind: 'dropbox'; path: string }

/** Stable string identity for a source (used for recents, biometrics, tabs). */
export function sourceId(source: VaultSource): string {
  return source.kind === 'dropbox' ? `dropbox:${source.path}` : source.path
}

export function parseSourceId(id: string): VaultSource {
  return id.startsWith('dropbox:')
    ? { kind: 'dropbox', path: id.slice('dropbox:'.length) }
    : { kind: 'file', path: id }
}

export function sourceLabel(source: VaultSource): string {
  return source.path.split(/[/\\]/).pop() ?? source.path
}

// Multiple databases can be open at once; each gets a handle id.
interface VaultHandle {
  db: kdbxweb.Kdbx
  source: VaultSource
  /** last-known Dropbox rev, used for conflict-safe uploads */
  rev?: string
}

const vaults = new Map<string, VaultHandle>()
let nextId = 1

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}

export function getDb(id: string): kdbxweb.Kdbx {
  const vault = vaults.get(id)
  if (!vault) throw new Error('Vault is not open')
  return vault.db
}

export function getSource(id: string): VaultSource | null {
  return vaults.get(id)?.source ?? null
}

export function findBySource(source: VaultSource): string | null {
  const wanted = sourceId(source)
  for (const [id, vault] of vaults) {
    if (sourceId(vault.source) === wanted) return id
  }
  return null
}

export async function openVault(
  source: VaultSource,
  password: string,
  keyFilePath?: string | null,
): Promise<string> {
  initCrypto()
  let data: Uint8Array
  let rev: string | undefined
  if (source.kind === 'dropbox') {
    const result = await dropbox.download(source.path)
    data = result.bytes
    rev = result.rev
  } else {
    data = await readFile(source.path)
  }
  const keyFile = keyFilePath ? toArrayBuffer(await readFile(keyFilePath)) : undefined
  const credentials = new kdbxweb.Credentials(
    kdbxweb.ProtectedValue.fromString(password),
    keyFile,
  )
  const db = await kdbxweb.Kdbx.load(toArrayBuffer(data), credentials)
  const id = String(nextId++)
  vaults.set(id, { db, source, rev })
  return id
}

/** Create a brand-new kdbx4/Argon2id database and write it to disk. */
export async function createVaultFile(filePath: string, password: string): Promise<string> {
  initCrypto()
  const name = (filePath.split(/[/\\]/).pop() ?? 'Passwords').replace(/\.kdbx$/i, '')
  const credentials = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(password))
  const db = kdbxweb.Kdbx.create(credentials, name)
  db.setVersion(4)
  db.setKdf(kdbxweb.Consts.KdfId.Argon2id)
  db.meta.recycleBinEnabled = true
  const buffer = await db.save()
  await writeFile(filePath, new Uint8Array(buffer))
  const id = String(nextId++)
  vaults.set(id, { db, source: { kind: 'file', path: filePath } })
  return id
}

/** May throw DropboxConflictError — the data is safe (conflict copy) but the
 *  caller should tell the user. */
export async function saveVault(id: string): Promise<void> {
  const vault = vaults.get(id)
  if (!vault) throw new Error('Vault is not open')
  const buffer = await vault.db.save()
  const bytes = new Uint8Array(buffer)
  if (vault.source.kind === 'dropbox') {
    vault.rev = await dropbox.upload(vault.source.path, bytes, vault.rev)
  } else {
    try {
      await copyFile(vault.source.path, vault.source.path + '.bak')
    } catch {
      // best-effort backup; don't block the save
    }
    await writeFile(vault.source.path, bytes)
  }
}

export function closeVault(id: string) {
  vaults.delete(id)
}

export function friendlyOpenError(err: unknown): string {
  if (err instanceof kdbxweb.KdbxError) {
    if (err.code === kdbxweb.Consts.ErrorCodes.InvalidKey) {
      return 'Wrong password or key file. Please try again.'
    }
    if (err.code === kdbxweb.Consts.ErrorCodes.BadSignature) {
      return "That file doesn't look like a KeePass database."
    }
    return `Could not open database: ${err.message ?? err.code}`
  }
  return err instanceof Error ? err.message : 'Could not open the database.'
}
