import { invoke } from '@tauri-apps/api/core'
import { authenticate, checkStatus } from '@tauri-apps/plugin-biometric'
import { isAndroid } from './platform'

// Which vault paths have an OS-protected stored password (UI marker only;
// the secret itself lives in the macOS Keychain / Android Keystore).
const MARKER_KEY = 'keepsake:biometricPaths'

function markedPaths(): string[] {
  try {
    const raw = localStorage.getItem(MARKER_KEY)
    const list = raw ? (JSON.parse(raw) as string[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function isBiometricEnabled(path: string): boolean {
  return markedPaths().includes(path)
}

function setMarker(path: string, on: boolean) {
  const list = markedPaths().filter((p) => p !== path)
  if (on) list.push(path)
  localStorage.setItem(MARKER_KEY, JSON.stringify(list))
}

export async function biometricAvailable(): Promise<boolean> {
  try {
    if (isAndroid) {
      const status = await checkStatus()
      return status.isAvailable
    }
    return await invoke<boolean>('biometric_available')
  } catch {
    return false
  }
}

export async function biometricStore(path: string, password: string): Promise<void> {
  await invoke('biometric_store', { path, password })
  setMarker(path, true)
}

/** Prompts biometrics (with device-credential fallback) and returns the master password. */
export async function biometricUnlock(path: string, fileName: string): Promise<string> {
  if (isAndroid) {
    // the OS prompt happens here; the decrypt command runs only after it succeeds
    await authenticate(`Unlock \u{201c}${fileName}\u{201d}`, { allowDeviceCredential: true })
  }
  return await invoke<string>('biometric_unlock', { path, fileName })
}

export async function biometricForget(path: string): Promise<void> {
  try {
    await invoke('biometric_forget', { path })
  } finally {
    setMarker(path, false)
  }
}
