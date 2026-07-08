import { invoke } from '@tauri-apps/api/core'

// Which vault paths have a keychain-stored password (UI marker only;
// the secret itself lives in the macOS Keychain).
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
    return await invoke<boolean>('biometric_available')
  } catch {
    return false
  }
}

export async function biometricStore(path: string, password: string): Promise<void> {
  await invoke('biometric_store', { path, password })
  setMarker(path, true)
}

/** Prompts Touch ID (or the account password) and returns the master password. */
export async function biometricUnlock(path: string, fileName: string): Promise<string> {
  return await invoke<string>('biometric_unlock', { path, fileName })
}

export async function biometricForget(path: string): Promise<void> {
  try {
    await invoke('biometric_forget', { path })
  } finally {
    setMarker(path, false)
  }
}
