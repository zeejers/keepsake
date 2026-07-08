// Minimal Dropbox v2 client: OAuth2 PKCE (no app secret, code copy-paste flow
// so it works identically on desktop and Android), search/download/upload.
//
// The app key is a public identifier (PKCE client). Create one at
// https://www.dropbox.com/developers/apps → "Scoped access" → "Full Dropbox"
// (or App folder), then either paste it in the UI once or set DEFAULT_APP_KEY.

const DEFAULT_APP_KEY = 'irtydupkgmoaanx'

const STORE_KEY = 'keepsake:dropbox'

interface DropboxState {
  appKey: string
  refreshToken: string
  accountEmail?: string
}

export interface DropboxFile {
  name: string
  path: string
  rev: string
  modified: string
}

export class DropboxConflictError extends Error {
  renamedTo: string
  constructor(renamedTo: string) {
    super(`Remote file changed; saved as ${renamedTo}`)
    this.renamedTo = renamedTo
  }
}

let accessToken: string | null = null
let accessTokenExpiry = 0
let pendingVerifier: string | null = null

function loadState(): DropboxState | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as DropboxState) : null
  } catch {
    return null
  }
}

function saveState(state: DropboxState | null) {
  if (state) localStorage.setItem(STORE_KEY, JSON.stringify(state))
  else localStorage.removeItem(STORE_KEY)
  accessToken = null
  accessTokenExpiry = 0
}

export function isConnected(): boolean {
  return !!loadState()?.refreshToken
}

export function connectedEmail(): string {
  return loadState()?.accountEmail ?? ''
}

export function storedAppKey(): string {
  return loadState()?.appKey || DEFAULT_APP_KEY
}

export function disconnect() {
  saveState(null)
}

// ---- OAuth (PKCE, manual code entry) ----

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function beginAuth(appKey: string): Promise<string> {
  const verifierBytes = new Uint8Array(48)
  crypto.getRandomValues(verifierBytes)
  const verifier = base64url(verifierBytes)
  pendingVerifier = verifier
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = base64url(new Uint8Array(digest))
  const params = new URLSearchParams({
    client_id: appKey,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    token_access_type: 'offline',
  })
  return `https://www.dropbox.com/oauth2/authorize?${params}`
}

export async function completeAuth(appKey: string, code: string): Promise<void> {
  if (!pendingVerifier) throw new Error('Start the Dropbox authorization first')
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code.trim(),
      client_id: appKey,
      code_verifier: pendingVerifier,
    }),
  })
  if (!res.ok) {
    throw new Error(`Dropbox rejected the code (${res.status}). Check it and try again.`)
  }
  const data = (await res.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
  }
  pendingVerifier = null
  saveState({ appKey, refreshToken: data.refresh_token })
  accessToken = data.access_token
  accessTokenExpiry = Date.now() + (data.expires_in - 60) * 1000
  // best-effort: record the account email for the UI
  try {
    const account = await rpc<{ email: string }>('users/get_current_account', null)
    const state = loadState()
    if (state) {
      localStorage.setItem(STORE_KEY, JSON.stringify({ ...state, accountEmail: account.email }))
    }
  } catch {
    // non-fatal
  }
}

async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < accessTokenExpiry) return accessToken
  const state = loadState()
  if (!state) throw new Error('Not connected to Dropbox')
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: state.refreshToken,
      client_id: state.appKey,
    }),
  })
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) {
      saveState(null)
      throw new Error('Dropbox session expired — please reconnect.')
    }
    throw new Error(`Dropbox token refresh failed (${res.status})`)
  }
  const data = (await res.json()) as { access_token: string; expires_in: number }
  accessToken = data.access_token
  accessTokenExpiry = Date.now() + (data.expires_in - 60) * 1000
  return accessToken
}

// ---- API helpers ----

async function rpc<T>(endpoint: string, body: unknown): Promise<T> {
  const token = await getAccessToken()
  const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Dropbox ${endpoint} failed (${res.status}): ${text.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

interface SearchResponse {
  matches: {
    metadata: {
      metadata: {
        '.tag': string
        name: string
        path_display: string
        rev: string
        server_modified: string
      }
    }
  }[]
}

export async function listKdbxFiles(): Promise<DropboxFile[]> {
  const data = await rpc<SearchResponse>('files/search_v2', {
    query: 'kdbx',
    options: { file_extensions: ['kdbx'], max_results: 100, filename_only: true },
  })
  return data.matches
    .map((m) => m.metadata.metadata)
    .filter((f) => f['.tag'] === 'file' && f.name.toLowerCase().endsWith('.kdbx'))
    .map((f) => ({
      name: f.name,
      path: f.path_display,
      rev: f.rev,
      modified: f.server_modified,
    }))
    .sort((a, b) => (a.modified < b.modified ? 1 : -1))
}

export async function download(path: string): Promise<{ bytes: Uint8Array; rev: string }> {
  const token = await getAccessToken()
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify({ path }),
    },
  })
  if (!res.ok) throw new Error(`Dropbox download failed (${res.status})`)
  const result = JSON.parse(res.headers.get('dropbox-api-result') ?? '{}') as { rev?: string }
  const bytes = new Uint8Array(await res.arrayBuffer())
  return { bytes, rev: result.rev ?? '' }
}

/**
 * Upload guarded by the last-known rev. If the remote changed underneath us,
 * Dropbox keeps our version as an autorenamed conflict copy and we throw
 * DropboxConflictError so the caller can tell the user.
 */
export async function upload(
  path: string,
  bytes: Uint8Array,
  rev: string | undefined,
): Promise<string> {
  const token = await getAccessToken()
  const doUpload = async (mode: unknown, autorename: boolean) => {
    return fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({ path, mode, autorename, mute: true }),
      },
      body: bytes as unknown as BodyInit,
    })
  }
  const mode = rev ? { '.tag': 'update', update: rev } : { '.tag': 'add' }
  let res = await doUpload(mode, false)
  if (res.status === 409) {
    if (!rev) {
      // add mode: the path is already taken
      throw new Error('A file with that name already exists in Dropbox.')
    }
    // remote changed: don't clobber it — save ours as a conflict copy
    res = await doUpload({ '.tag': 'add' }, true)
    if (!res.ok) throw new Error(`Dropbox upload failed (${res.status})`)
    const meta = (await res.json()) as { name: string; rev: string }
    throw new DropboxConflictError(meta.name)
  }
  if (!res.ok) throw new Error(`Dropbox upload failed (${res.status})`)
  const meta = (await res.json()) as { rev: string }
  return meta.rev
}
