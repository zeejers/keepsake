<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { open, save } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  Cloud,
  KeyRound,
  FileKey2,
  Fingerprint,
  FolderOpen,
  LoaderCircle,
  History,
  Sparkles,
  Unplug,
  X,
} from 'lucide-vue-next'
import { useVaultStore } from '../stores/vault'
import { bioName } from '../lib/platform'
import { parseSourceId, sourceId, sourceLabel, type VaultSource } from '../lib/kdbx'
import {
  biometricAvailable,
  biometricForget,
  biometricStore,
  biometricUnlock,
  isBiometricEnabled,
} from '../lib/biometric'
import * as dropbox from '../lib/dropbox'
import type { DropboxFile } from '../lib/dropbox'

const props = defineProps<{ modal?: boolean }>()
const emit = defineEmits<{ close: [] }>()

const store = useVaultStore()

const mode = ref<'open' | 'dropbox' | 'create'>('open')
const selected = ref<VaultSource | null>(null)
const password = ref('')
const confirmPassword = ref('')
const keyFilePath = ref<string | null>(null)
const error = ref('')
const busy = ref(false)
const passwordInput = ref<HTMLInputElement | null>(null)

const baseName = (p: string) => p.split(/[/\\]/).pop() ?? p
const selectedId = computed(() => (selected.value ? sourceId(selected.value) : null))
const isCloud = computed(() => selected.value?.kind === 'dropbox')

const recents = ref<string[]>([])

// ---- Touch ID ----
const bioAvailable = ref(false)
const bioBusy = ref(false)
const enableBio = ref(false)
const bioRevision = ref(0)
const bioEnabled = computed(() => {
  bioRevision.value
  return !!selectedId.value && isBiometricEnabled(selectedId.value)
})

// ---- Dropbox ----
const dbxConnected = ref(false)
const dbxEmail = ref('')
const dbxAppKey = ref('')
const dbxHasDefaultKey = ref(false)
const dbxAdvanced = ref(false)
const dbxAuthStarted = ref(false)
const dbxCode = ref('')
const dbxBusy = ref(false)
const dbxFiles = ref<DropboxFile[]>([])
const dbxLoading = ref(false)
const dbxError = ref('')

// ---- create-in-Dropbox ----
const dbxCreatePicking = ref(false)
const dbxCreateName = ref('')
const dbxCreatePath = computed(() => {
  const raw = dbxCreateName.value.trim().replace(/^\/+/, '')
  if (!raw) return ''
  return '/' + (raw.toLowerCase().endsWith('.kdbx') ? raw : raw + '.kdbx')
})

onMounted(async () => {
  recents.value = store.recentFiles()
  if (!props.modal && recents.value.length) {
    selected.value = parseSourceId(recents.value[0]!)
  }
  dbxConnected.value = dropbox.isConnected()
  dbxEmail.value = dropbox.connectedEmail()
  dbxAppKey.value = dropbox.storedAppKey()
  dbxHasDefaultKey.value = !!dbxAppKey.value
  bioAvailable.value = await biometricAvailable()
})

watch(selected, () => {
  enableBio.value = false
})

watch(mode, (m) => {
  if (m === 'dropbox' && dbxConnected.value && !dbxFiles.value.length) void loadDropboxFiles()
})

const passwordsMismatch = computed(
  () =>
    mode.value === 'create' && confirmPassword.value.length > 0 && password.value !== confirmPassword.value,
)

const canSubmit = computed(() => {
  if (!selected.value || !password.value || busy.value) return false
  if (mode.value === 'create') return password.value === confirmPassword.value
  return true
})

function switchMode(next: 'open' | 'dropbox' | 'create') {
  if (mode.value === next) return
  mode.value = next
  selected.value = null
  password.value = ''
  confirmPassword.value = ''
  keyFilePath.value = null
  error.value = ''
  dbxCreatePicking.value = false
  dbxCreateName.value = ''
}

async function pickDatabase() {
  if (mode.value === 'create') {
    const picked = await save({
      defaultPath: 'Passwords.kdbx',
      filters: [{ name: 'KeePass Database', extensions: ['kdbx'] }],
    })
    if (typeof picked === 'string') {
      selected.value = {
        kind: 'file',
        path: picked.endsWith('.kdbx') ? picked : picked + '.kdbx',
      }
      error.value = ''
      passwordInput.value?.focus()
    }
  } else {
    const picked = await open({
      multiple: false,
      filters: [{ name: 'KeePass Database', extensions: ['kdbx'] }],
    })
    if (typeof picked === 'string') {
      mode.value = 'open'
      selected.value = { kind: 'file', path: picked }
      error.value = ''
      passwordInput.value?.focus()
    }
  }
}

function changeSelection() {
  if (mode.value === 'create') {
    if (!dbxConnected.value) {
      void pickDatabase()
      return
    }
    // back to the destination choice
    selected.value = null
    dbxCreatePicking.value = false
  } else if (selected.value?.kind === 'dropbox') {
    selected.value = null
    mode.value = 'dropbox'
  } else {
    void pickDatabase()
  }
}

function confirmDropboxTarget() {
  if (!dbxCreatePath.value) return
  selected.value = { kind: 'dropbox', path: dbxCreatePath.value }
  dbxCreatePicking.value = false
  error.value = ''
  passwordInput.value?.focus()
}

async function pickKeyFile() {
  const picked = await open({ multiple: false })
  if (typeof picked === 'string') keyFilePath.value = picked
}

function useRecent(id: string) {
  mode.value = 'open'
  selected.value = parseSourceId(id)
  error.value = ''
  passwordInput.value?.focus()
}

// ---- Dropbox actions ----
async function startDropboxAuth() {
  if (!dbxAppKey.value.trim()) return
  dbxError.value = ''
  try {
    const url = await dropbox.beginAuth(dbxAppKey.value.trim())
    await openUrl(url)
    dbxAuthStarted.value = true
  } catch (err) {
    dbxError.value = err instanceof Error ? err.message : String(err)
  }
}

async function finishDropboxAuth() {
  if (!dbxCode.value.trim() || dbxBusy.value) return
  dbxBusy.value = true
  dbxError.value = ''
  try {
    await dropbox.completeAuth(dbxAppKey.value.trim(), dbxCode.value)
    dbxConnected.value = true
    dbxEmail.value = dropbox.connectedEmail()
    dbxCode.value = ''
    dbxAuthStarted.value = false
    await loadDropboxFiles()
  } catch (err) {
    dbxError.value = err instanceof Error ? err.message : String(err)
  } finally {
    dbxBusy.value = false
  }
}

async function loadDropboxFiles() {
  dbxLoading.value = true
  dbxError.value = ''
  try {
    dbxFiles.value = await dropbox.listKdbxFiles()
    dbxEmail.value = dropbox.connectedEmail()
  } catch (err) {
    dbxError.value = err instanceof Error ? err.message : String(err)
    dbxConnected.value = dropbox.isConnected()
  } finally {
    dbxLoading.value = false
  }
}

function pickDropboxFile(file: DropboxFile) {
  mode.value = 'open'
  selected.value = { kind: 'dropbox', path: file.path }
  error.value = ''
  passwordInput.value?.focus()
}

function disconnectDropbox() {
  dropbox.disconnect()
  dbxConnected.value = false
  dbxEmail.value = ''
  dbxFiles.value = []
  dbxAuthStarted.value = false
}

// ---- unlock ----
async function unlockWithBiometrics() {
  if (!selected.value || !selectedId.value || bioBusy.value) return
  bioBusy.value = true
  error.value = ''
  try {
    const pw = await biometricUnlock(selectedId.value, sourceLabel(selected.value))
    await store.unlock(selected.value, pw, null)
    emit('close')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // user backing out of the Touch ID prompt isn't an error worth showing
    if (!/cancel/i.test(message)) error.value = message
  } finally {
    bioBusy.value = false
  }
}

async function disableBiometrics() {
  if (!selectedId.value) return
  await biometricForget(selectedId.value)
  bioRevision.value++
}

async function submit() {
  if (!canSubmit.value || !selected.value) return
  busy.value = true
  error.value = ''
  try {
    if (mode.value === 'create') {
      await store.createNew(selected.value, password.value)
    } else {
      await store.unlock(selected.value, password.value, keyFilePath.value)
    }
    if (enableBio.value && bioAvailable.value && selectedId.value) {
      try {
        await biometricStore(selectedId.value, password.value)
        bioRevision.value++
        store.showToast(`${bioName} unlock enabled`)
      } catch (err) {
        store.showToast(
          `Could not enable ${bioName}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    password.value = ''
    confirmPassword.value = ''
    emit('close')
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Something went wrong.'
    passwordInput.value?.select()
  } finally {
    busy.value = false
  }
}

function fmtWhen(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

defineExpose({ pickDatabase })
</script>

<template>
  <div class="unlock" :class="{ modal: props.modal }" data-tauri-drag-region>
    <div class="card" :class="{ shake: !!error }" :key="error">
      <button v-if="props.modal" class="icon-btn close" @click="emit('close')">
        <X :size="16" />
      </button>

      <div class="mark">
        <KeyRound :size="26" />
      </div>
      <h1>Keepsake</h1>
      <p class="tagline">A safe place for your KeePass vaults</p>

      <div class="mode-tabs">
        <button class="mode-tab" :class="{ on: mode === 'open' }" @click="switchMode('open')">
          Open
        </button>
        <button class="mode-tab" :class="{ on: mode === 'dropbox' }" @click="switchMode('dropbox')">
          Dropbox
        </button>
        <button class="mode-tab" :class="{ on: mode === 'create' }" @click="switchMode('create')">
          Create new
        </button>
      </div>

      <!-- ============ Dropbox browser ============ -->
      <template v-if="mode === 'dropbox'">
        <template v-if="!dbxConnected">
          <div class="dbx-setup">
            <template v-if="!dbxAuthStarted">
              <button class="dbx-connect" :disabled="!dbxAppKey.trim()" @click="startDropboxAuth">
                <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true">
                  <path d="M6 1.807 0 5.629l6 3.822 6.001-3.822L6 1.807zM18 1.807l-6 3.822 6 3.822 6-3.822-6-3.822zM0 13.274l6 3.822 6.001-3.822L6 9.452l-6 3.822zM18 9.452l-6 3.822 6 3.822 6-3.822-6-3.822zM6.001 18.371l6.001 3.822 6-3.822-6-3.822-6.001 3.822z" />
                </svg>
                Connect Dropbox
              </button>
              <p class="dbx-note">
                Your browser will open to approve access. Vaults stay encrypted; Dropbox only
                ever stores the same bytes as your disk.
              </p>
              <template v-if="!dbxHasDefaultKey || dbxAdvanced">
                <p class="dbx-help">
                  Using your own Dropbox app? Paste its App key
                  (<span class="dbx-link" @click="openUrl('https://www.dropbox.com/developers/apps')">create one</span>
                  with Scoped access):
                </p>
                <input v-model="dbxAppKey" class="input" placeholder="Dropbox app key" spellcheck="false" />
              </template>
              <button v-else class="dbx-advanced" @click="dbxAdvanced = true">
                Advanced: use a custom app key
              </button>
            </template>

            <template v-else>
              <p class="dbx-note">
                Approve access in your browser, then paste the code Dropbox shows you:
              </p>
              <input
                v-model="dbxCode"
                class="input"
                placeholder="Paste code here"
                spellcheck="false"
                autofocus
              />
              <button class="btn primary" :disabled="!dbxCode.trim() || dbxBusy" @click="finishDropboxAuth">
                <LoaderCircle v-if="dbxBusy" :size="14" class="spin" />
                {{ dbxBusy ? 'Connecting…' : 'Finish connecting' }}
              </button>
              <button class="dbx-advanced" @click="startDropboxAuth">Reopen browser</button>
            </template>
          </div>
        </template>

        <template v-else>
          <div class="dbx-head">
            <Cloud :size="14" class="dbx-cloud" />
            <span class="dbx-account">{{ dbxEmail || 'Connected' }}</span>
            <button class="icon-btn" title="Refresh list" @click="loadDropboxFiles">
              <History :size="14" />
            </button>
            <button class="icon-btn danger" title="Disconnect Dropbox" @click="disconnectDropbox">
              <Unplug :size="14" />
            </button>
          </div>

          <div v-if="dbxLoading" class="dbx-loading">
            <LoaderCircle :size="16" class="spin" />
            Searching for .kdbx files…
          </div>
          <div v-else-if="dbxFiles.length === 0" class="dbx-loading">No .kdbx files found</div>
          <div v-else class="dbx-files">
            <button v-for="f in dbxFiles" :key="f.path" class="dbx-file" @click="pickDropboxFile(f)">
              <FileKey2 :size="15" class="file-icon" />
              <span class="dbx-file-meta">
                <span class="dbx-file-name">{{ f.name }}</span>
                <span class="dbx-file-path">{{ f.path }}</span>
              </span>
              <span class="dbx-file-when">{{ fmtWhen(f.modified) }}</span>
            </button>
          </div>
        </template>
        <p v-if="dbxError" class="error">{{ dbxError }}</p>
      </template>

      <!-- ============ Open / Create ============ -->
      <template v-else>
        <template v-if="!selected">
          <button v-if="mode === 'open'" class="file-drop" @click="pickDatabase">
            <FolderOpen :size="18" />
            <span>Choose a <b>.kdbx</b> file…</span>
          </button>

          <!-- create: pick a destination -->
          <div v-else-if="!dbxCreatePicking" class="create-choices">
            <button class="file-drop" @click="pickDatabase">
              <Sparkles :size="18" />
              <span v-if="dbxConnected">Save on this computer…</span>
              <span v-else>Choose where to save it…</span>
            </button>
            <button v-if="dbxConnected" class="file-drop dbx-drop" @click="dbxCreatePicking = true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                <path d="M6 1.807 0 5.629l6 3.822 6.001-3.822L6 1.807zM18 1.807l-6 3.822 6 3.822 6-3.822-6-3.822zM0 13.274l6 3.822 6.001-3.822L6 9.452l-6 3.822zM18 9.452l-6 3.822 6 3.822 6-3.822-6-3.822zM6.001 18.371l6.001 3.822 6-3.822-6-3.822-6.001 3.822z" />
              </svg>
              <span>Save in Dropbox</span>
            </button>
          </div>

          <!-- create: name the Dropbox vault -->
          <div v-else class="dbx-create">
            <div class="dbx-create-head">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" class="dbx-glyph" aria-hidden="true">
                <path d="M6 1.807 0 5.629l6 3.822 6.001-3.822L6 1.807zM18 1.807l-6 3.822 6 3.822 6-3.822-6-3.822zM0 13.274l6 3.822 6.001-3.822L6 9.452l-6 3.822zM18 9.452l-6 3.822 6 3.822 6-3.822-6-3.822zM6.001 18.371l6.001 3.822 6-3.822-6-3.822-6.001 3.822z" />
              </svg>
              <span>New vault in Dropbox{{ dbxEmail ? ' · ' + dbxEmail : '' }}</span>
            </div>
            <input
              v-model="dbxCreateName"
              class="input"
              placeholder="Vault name (e.g. Passwords)"
              spellcheck="false"
              autofocus
              @keydown.enter.prevent="confirmDropboxTarget"
            />
            <p class="dbx-note dbx-create-note">
              <template v-if="dbxCreatePath">Will be saved as <b>{{ dbxCreatePath }}</b></template>
              <template v-else>Use / to place it in a folder, e.g. Vaults/Personal</template>
            </p>
            <div class="dbx-create-actions">
              <button class="btn ghost" @click="dbxCreatePicking = false">Back</button>
              <button class="btn primary" :disabled="!dbxCreatePath" @click="confirmDropboxTarget">
                Continue
              </button>
            </div>
          </div>
        </template>

        <div v-else class="file-chip">
          <component :is="isCloud ? Cloud : FileKey2" :size="16" class="file-icon" />
          <div class="file-meta">
            <div class="file-name">{{ baseName(selected.path) }}</div>
            <div class="file-path">{{ isCloud ? 'Dropbox · ' + selected.path : selected.path }}</div>
          </div>
          <button class="btn ghost change" @click="changeSelection">Change</button>
        </div>

        <template v-if="selected && mode === 'open' && bioAvailable && bioEnabled">
          <button class="btn primary bio-btn" :disabled="bioBusy" @click="unlockWithBiometrics">
            <LoaderCircle v-if="bioBusy" :size="15" class="spin" />
            <Fingerprint v-else :size="16" />
            {{ bioBusy ? `Waiting for ${bioName}…` : `Unlock with ${bioName}` }}
          </button>
          <div v-show="!bioBusy" class="bio-row">
            <span class="bio-or">or use your master password</span>
            <button class="bio-disable" @click="disableBiometrics">Disable {{ bioName }}</button>
          </div>
        </template>

        <form v-if="selected" v-show="!bioBusy" class="form" @submit.prevent="submit">
          <input
            ref="passwordInput"
            v-model="password"
            class="input"
            type="password"
            :placeholder="mode === 'create' ? 'Choose a master password' : 'Master password'"
            autofocus
            autocomplete="off"
          />

          <template v-if="mode === 'create'">
            <input
              v-model="confirmPassword"
              class="input"
              type="password"
              placeholder="Confirm master password"
              autocomplete="off"
            />
            <p v-if="passwordsMismatch" class="mismatch">Passwords don't match yet</p>
          </template>

          <template v-else>
            <div v-if="keyFilePath" class="keyfile-chip">
              <FileKey2 :size="14" />
              <span>{{ baseName(keyFilePath) }}</span>
              <button type="button" class="icon-btn" @click="keyFilePath = null">
                <X :size="13" />
              </button>
            </div>
            <button v-else type="button" class="keyfile-link" @click="pickKeyFile">
              + Use a key file
            </button>
          </template>

          <label v-if="bioAvailable && !bioEnabled" class="bio-optin">
            <input v-model="enableBio" type="checkbox" />
            <Fingerprint :size="13" />
            Enable {{ bioName }} unlock for this vault
          </label>

          <button class="btn primary unlock-btn" type="submit" :disabled="!canSubmit">
            <LoaderCircle v-if="busy" :size="15" class="spin" />
            <template v-if="busy">{{ mode === 'create' ? 'Creating…' : 'Unlocking…' }}</template>
            <template v-else>{{ mode === 'create' ? 'Create Vault' : 'Unlock' }}</template>
          </button>

          <p v-if="error" class="error">{{ error }}</p>
        </form>

        <div v-if="mode === 'open' && recents.length" class="recents">
          <div class="recents-head"><History :size="12" /> Recent</div>
          <button
            v-for="id in recents"
            :key="id"
            class="recent-row"
            :class="{ current: id === selectedId }"
            @click="useRecent(id)"
          >
            <component
              :is="id.startsWith('dropbox:') ? Cloud : FileKey2"
              :size="12"
              class="recent-icon"
            />
            <span class="recent-name">{{ baseName(id.replace(/^dropbox:/, '')) }}</span>
            <span class="recent-path">{{ id.replace(/^dropbox:/, 'Dropbox · ') }}</span>
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.unlock {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(1200px 600px at 50% -10%, rgba(53, 211, 165, 0.07), transparent 60%),
    var(--bg);
}
.unlock.modal {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(5, 8, 12, 0.6);
  backdrop-filter: blur(3px);
}

.card {
  position: relative;
  width: 420px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
  overflow-y: auto;
  padding: 36px 36px 28px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 18px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.close {
  position: absolute;
  top: 12px;
  right: 12px;
}

.mark {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #06231a;
  background: linear-gradient(135deg, #45e0b2, #1fae85);
  box-shadow: 0 8px 24px rgba(53, 211, 165, 0.25);
  flex-shrink: 0;
}

h1 {
  margin: 16px 0 2px;
  font-size: 21px;
  font-weight: 700;
  letter-spacing: -0.3px;
}

.tagline {
  margin: 0 0 20px;
  color: var(--muted);
  font-size: 13px;
}

.mode-tabs {
  display: flex;
  width: 100%;
  padding: 3px;
  gap: 3px;
  border-radius: var(--radius);
  background: var(--panel);
  border: 1px solid var(--border-soft);
  margin-bottom: 14px;
  flex-shrink: 0;
}
.mode-tab {
  flex: 1;
  padding: 7px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 600;
  font-family: var(--sans);
  cursor: pointer;
}
.mode-tab.on {
  background: var(--panel-3);
  color: var(--text);
}

.file-drop {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 18px 16px;
  border-radius: var(--radius);
  border: 1.5px dashed var(--border);
  background: transparent;
  color: var(--text-soft);
  font-size: 13.5px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  flex-shrink: 0;
}
.file-drop:hover {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  color: var(--text);
}

.create-choices {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}

.dbx-drop svg,
.dbx-glyph {
  color: #0061ff;
  flex-shrink: 0;
}

.dbx-create {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex-shrink: 0;
}
.dbx-create-head {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-soft);
}
.dbx-create-note {
  text-align: left;
  min-height: 17px;
}
.dbx-create-note b {
  color: var(--text-soft);
  word-break: break-all;
}
.dbx-create-actions {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.file-chip {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--panel);
  flex-shrink: 0;
}
.file-icon {
  color: var(--accent);
  flex-shrink: 0;
}
.file-meta {
  flex: 1;
  min-width: 0;
  text-align: left;
}
.file-name {
  font-weight: 600;
  font-size: 13px;
}
.file-path {
  color: var(--faint);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.change {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--muted);
}

.form {
  width: 100%;
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mismatch {
  margin: -6px 0 0 2px;
  color: var(--danger);
  font-size: 11.5px;
}

.keyfile-link {
  align-self: flex-start;
  background: none;
  border: none;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
  padding: 0 2px;
}
.keyfile-link:hover {
  color: var(--accent);
}

.keyfile-chip {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--panel-3);
  color: var(--text-soft);
  font-size: 12px;
}
.keyfile-chip .icon-btn {
  width: 20px;
  height: 20px;
}

.unlock-btn {
  margin-top: 4px;
  padding: 10px;
  font-size: 14px;
}

.bio-btn {
  width: 100%;
  margin-top: 14px;
  padding: 10px;
  font-size: 14px;
  flex-shrink: 0;
}
.bio-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  flex-shrink: 0;
}
.bio-or {
  color: var(--faint);
  font-size: 11.5px;
}
.bio-disable {
  background: none;
  border: none;
  color: var(--faint);
  font-size: 11.5px;
  cursor: pointer;
  padding: 0;
}
.bio-disable:hover {
  color: var(--danger);
}

.bio-optin {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--muted);
  font-size: 12.5px;
  cursor: pointer;
  user-select: none;
}
.bio-optin input {
  accent-color: var(--accent);
  margin: 0;
}
.bio-optin:hover {
  color: var(--text-soft);
}

.error {
  margin: 10px 0 0;
  color: var(--danger);
  font-size: 12.5px;
  text-align: center;
}

/* ---- Dropbox ---- */
.dbx-setup {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dbx-connect {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  padding: 12px;
  border: none;
  border-radius: var(--radius);
  background: #0061ff;
  color: #fff;
  font-family: var(--sans);
  font-size: 14.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s;
}
.dbx-connect:hover:not(:disabled) {
  background: #0057e5;
}
.dbx-connect:disabled {
  opacity: 0.5;
  cursor: default;
}
.dbx-note {
  margin: 0;
  color: var(--faint);
  font-size: 11.5px;
  line-height: 1.5;
  text-align: center;
}
.dbx-advanced {
  align-self: center;
  background: none;
  border: none;
  color: var(--faint);
  font-size: 11.5px;
  cursor: pointer;
  padding: 2px;
}
.dbx-advanced:hover {
  color: var(--accent);
}
.dbx-help {
  margin: 0;
  color: var(--muted);
  font-size: 12.5px;
  line-height: 1.55;
}
.dbx-link {
  color: var(--accent);
  cursor: pointer;
}
.dbx-link:hover {
  text-decoration: underline;
}

.dbx-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 2px 10px;
}
.dbx-cloud {
  color: var(--accent);
}
.dbx-account {
  flex: 1;
  font-size: 12.5px;
  color: var(--text-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dbx-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 24px 0;
  color: var(--faint);
  font-size: 12.5px;
}

.dbx-files {
  width: 100%;
  max-height: 260px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dbx-file {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-soft);
  background: var(--panel);
  cursor: pointer;
  text-align: left;
  font-family: var(--sans);
}
.dbx-file:hover {
  border-color: var(--accent-border);
  background: var(--accent-soft);
}
.dbx-file-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.dbx-file-name {
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}
.dbx-file-path {
  color: var(--faint);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dbx-file-when {
  color: var(--faint);
  font-size: 11px;
  flex-shrink: 0;
}

/* ---- recents ---- */
.recents {
  width: 100%;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--border-soft);
}
.recents-head {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 6px;
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.7px;
  color: var(--faint);
}
.recent-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-family: var(--sans);
}
.recent-row:hover,
.recent-row.current {
  background: var(--panel-3);
}
.recent-icon {
  color: var(--muted);
  flex-shrink: 0;
}
.recent-name {
  color: var(--text-soft);
  font-size: 12.5px;
  font-weight: 600;
  flex-shrink: 0;
}
.recent-path {
  color: var(--faint);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.spin {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.shake {
  animation: shake 0.35s ease;
}
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-8px); }
  40% { transform: translateX(7px); }
  60% { transform: translateX(-5px); }
  80% { transform: translateX(3px); }
}
</style>
