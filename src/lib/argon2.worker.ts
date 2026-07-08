// Argon2 runs here, off the main thread, so key derivation during
// unlock/save never freezes the UI.
import { argon2d, argon2id } from 'hash-wasm'

interface Argon2Request {
  id: number
  password: ArrayBuffer
  salt: ArrayBuffer
  memory: number
  iterations: number
  length: number
  parallelism: number
  type: number
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Argon2Request>) => void) | null
  postMessage(message: unknown, transfer?: Transferable[]): void
}

scope.onmessage = async (e) => {
  const { id, password, salt, memory, iterations, length, parallelism, type } = e.data
  try {
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
    const buffer = hash.slice().buffer
    scope.postMessage({ id, ok: true, hash: buffer }, [buffer])
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
