<script setup lang="ts">
import { nextTick, reactive, ref, watch } from 'vue'
import {
  Copy,
  Download,
  Layers,
  Eye,
  EyeOff,
  ExternalLink,
  KeyRound,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-vue-next'
import { openUrl } from '@tauri-apps/plugin-opener'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { readFile, writeFile } from '@tauri-apps/plugin-fs'
import { ChevronLeft } from 'lucide-vue-next'
import EntryAvatar from './EntryAvatar.vue'
import PasswordGenerator from './PasswordGenerator.vue'
import { useVaultStore } from '../stores/vault'
import { modKey } from '../lib/platform'
import type { CustomField } from '../lib/types'

defineProps<{ narrow?: boolean }>()
const emit = defineEmits<{ back: [] }>()

const store = useVaultStore()

const revealed = ref(false)
const notesRevealed = ref(false)
const revealedInEdit = ref(false)

const draft = reactive({
  title: '',
  username: '',
  password: '',
  url: '',
  notes: '',
  custom: [] as CustomField[],
})

const titleInput = ref<HTMLInputElement | null>(null)

watch(
  () => [store.editing, store.selectedEntryId],
  async ([editing]) => {
    revealed.value = false
    notesRevealed.value = false
    if (editing && store.selectedEntry) {
      const e = store.selectedEntry
      draft.title = e.title
      draft.username = e.username
      draft.password = e.password
      draft.url = e.url
      draft.notes = e.notes
      draft.custom = e.custom.map((f) => ({ ...f }))
      revealedInEdit.value = store.editingIsNew
      await nextTick()
      titleInput.value?.focus()
    }
  },
  { immediate: true },
)

function commit() {
  if (!store.selectedEntryId) return
  store.updateEntry(store.selectedEntryId, {
    title: draft.title.trim() || 'Untitled',
    username: draft.username,
    password: draft.password,
    url: draft.url.trim(),
    notes: draft.notes,
    custom: draft.custom,
  })
}

function applyGenerated(password: string) {
  draft.password = password
  revealedInEdit.value = true
}

function addCustomField() {
  draft.custom.push({ key: '', value: '', protected: false })
}

async function visit(url: string) {
  let target = url.trim()
  if (!target) return
  if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) target = 'https://' + target
  try {
    await openUrl(target)
  } catch {
    store.showToast('Could not open URL')
  }
}

/** Notes: drag-select copies just the selection; a plain click does nothing. */
function onNotesMouseUp() {
  if (!notesRevealed.value) return
  const selection = window.getSelection()?.toString()
  if (selection) void store.copyToClipboard(selection, 'Selection')
}

async function addAttachment() {
  if (!store.selectedEntry) return
  const path = await openDialog({ multiple: false, title: 'Attach a file' })
  if (typeof path !== 'string') return
  const data = await readFile(path)
  const name = path.split(/[/\\]/).pop() ?? 'file'
  await store.addAttachment(store.selectedEntry.id, name, data)
}

async function saveAttachment(name: string) {
  if (!store.selectedEntry) return
  const bytes = store.getAttachmentBytes(store.selectedEntry.id, name)
  if (!bytes) return
  const target = await saveDialog({ defaultPath: name, title: 'Save attachment' })
  if (typeof target !== 'string') return
  await writeFile(target, bytes)
  store.showToast(`Saved ${name}`)
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const dots = '••••••••••'

function fmtDate(d: Date | undefined) {
  if (!d) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
</script>

<template>
  <section class="detail">
    <!-- multi-selection -->
    <div v-if="store.selectedEntryIds.size > 1" class="empty" data-tauri-drag-region>
      <div class="empty-inner">
        <Layers :size="36" class="empty-icon" />
        <p class="empty-title">{{ store.selectedEntryIds.size }} entries selected</p>
        <button class="btn danger" @click="store.deleteSelectedEntries()">
          <Trash2 :size="14" />
          {{ store.inTrash ? `Delete ${store.selectedEntryIds.size} Forever` : `Move ${store.selectedEntryIds.size} to Trash` }}
        </button>
        <p class="multi-hint"><kbd>esc</kbd> to clear selection</p>
      </div>
    </div>

    <!-- empty state -->
    <div v-else-if="!store.selectedEntry" class="empty" data-tauri-drag-region>
      <div class="empty-inner">
        <KeyRound :size="36" class="empty-icon" />
        <p class="empty-title">Select an entry</p>
        <div class="cheats">
          <div class="cheat"><span><kbd>{{ modKey }}</kbd><kbd>K</kbd></span> Search everything</div>
          <div class="cheat"><span><kbd>{{ modKey }}</kbd><kbd>N</kbd></span> New entry in this group</div>
          <div class="cheat"><span><kbd>{{ modKey }}</kbd><kbd>C</kbd></span> Copy password</div>
          <div class="cheat"><span><kbd>{{ modKey }}</kbd><kbd>B</kbd></span> Copy username</div>
          <div class="cheat"><span><kbd>?</kbd></span> All shortcuts</div>
        </div>
      </div>
    </div>

    <!-- view mode -->
    <template v-else-if="!store.editing">
      <div class="head" data-tauri-drag-region>
        <button v-if="narrow" class="icon-btn" title="Back to entries" @click="emit('back')">
          <ChevronLeft :size="18" />
        </button>
        <EntryAvatar :title="store.selectedEntry.title || '?'" :size="40" />
        <h2 class="head-title">{{ store.selectedEntry.title || '(untitled)' }}</h2>
      </div>

      <div class="fields">
        <div class="field" v-if="store.selectedEntry.username">
          <span class="label">Username</span>
          <span
            class="value clicky"
            title="Click to copy"
            @click="store.copyUsername()"
            >{{ store.selectedEntry.username }}</span
          >
          <button class="icon-btn copy" :title="`Copy username (${modKey}B)`" @click="store.copyUsername()">
            <Copy :size="14" />
          </button>
        </div>

        <div class="field">
          <span class="label">Password</span>
          <span
            class="value mono clicky"
            title="Click to copy"
            @click="store.copyPassword()"
            >{{ revealed ? store.selectedEntry.password || '(empty)' : dots }}</span
          >
          <button class="icon-btn copy" :title="revealed ? 'Hide' : 'Reveal'" @click="revealed = !revealed">
            <component :is="revealed ? EyeOff : Eye" :size="14" />
          </button>
          <button class="icon-btn copy" :title="`Copy password (${modKey}C)`" @click="store.copyPassword()">
            <Copy :size="14" />
          </button>
        </div>

        <div class="field" v-if="store.selectedEntry.url">
          <span class="label">URL</span>
          <span
            class="value clicky"
            title="Click to copy"
            @click="store.copyToClipboard(store.selectedEntry.url, 'URL')"
            >{{ store.selectedEntry.url }}</span
          >
          <button class="icon-btn copy" :title="`Open in browser (${modKey}U)`" @click="visit(store.selectedEntry.url)">
            <ExternalLink :size="14" />
          </button>
          <button
            class="icon-btn copy"
            title="Copy URL"
            @click="store.copyToClipboard(store.selectedEntry.url, 'URL')"
          >
            <Copy :size="14" />
          </button>
        </div>

        <div class="field" v-for="f in store.selectedEntry.custom" :key="f.key">
          <span class="label">{{ f.key }}</span>
          <span
            class="value clicky"
            :class="{ mono: f.protected }"
            title="Click to copy"
            @click="store.copyToClipboard(f.value, f.key)"
            >{{ f.value }}</span
          >
          <button
            class="icon-btn copy"
            :title="`Copy ${f.key}`"
            @click="store.copyToClipboard(f.value, f.key)"
          >
            <Copy :size="14" />
          </button>
        </div>

        <div class="notes" v-if="store.selectedEntry.notes">
          <div class="notes-head">
            <span class="label">Notes</span>
            <button
              class="icon-btn"
              :title="notesRevealed ? 'Hide notes' : 'Reveal notes'"
              @click="notesRevealed = !notesRevealed"
            >
              <component :is="notesRevealed ? EyeOff : Eye" :size="14" />
            </button>
            <button
              class="icon-btn"
              title="Copy all notes"
              @click="store.copyToClipboard(store.selectedEntry.notes, 'Notes')"
            >
              <Copy :size="14" />
            </button>
          </div>
          <p
            class="notes-body"
            :class="{ veiled: !notesRevealed }"
            @mouseup="onNotesMouseUp"
          >{{ store.selectedEntry.notes }}</p>
          <p class="notes-hint">
            {{ notesRevealed ? 'Select text to copy just that part' : 'Reveal to select individual parts' }}
          </p>
        </div>

        <div class="attachments">
          <div class="attachments-head">
            <span class="label">Attachments</span>
            <button class="btn ghost add-attachment" @click="addAttachment">
              <Paperclip :size="13" />
              Attach file
            </button>
          </div>
          <div v-if="store.selectedEntry.attachments.length" class="attachment-rows">
            <div
              v-for="a in store.selectedEntry.attachments"
              :key="a.name"
              class="attachment"
              :title="`Save ${a.name}`"
              @click="saveAttachment(a.name)"
            >
              <Paperclip :size="14" class="attachment-icon" />
              <span class="attachment-name">{{ a.name }}</span>
              <span class="attachment-size">{{ fmtSize(a.size) }}</span>
              <button
                class="icon-btn copy"
                :title="`Save ${a.name}`"
                @click.stop="saveAttachment(a.name)"
              >
                <Download :size="14" />
              </button>
              <button
                class="icon-btn copy danger"
                :title="`Remove ${a.name}`"
                @click.stop="store.removeAttachment(store.selectedEntry!.id, a.name)"
              >
                <X :size="14" />
              </button>
            </div>
          </div>
        </div>

        <p class="times">
          Created {{ fmtDate(store.selectedEntry.created) }} · Modified
          {{ fmtDate(store.selectedEntry.modified) }}
        </p>
      </div>

      <div class="foot">
        <button class="btn" @click="store.startEdit()">
          <Pencil :size="14" />
          Edit
          <span class="kbd-group"><kbd>{{ modKey }}</kbd><kbd>E</kbd></span>
        </button>
        <button class="btn danger" @click="store.deleteSelectedEntries()">
          <Trash2 :size="14" />
          {{ store.inTrash ? 'Delete Forever' : 'Delete' }}
        </button>
      </div>
    </template>

    <!-- edit mode -->
    <template v-else>
      <div class="head" data-tauri-drag-region>
        <button v-if="narrow" class="icon-btn" title="Back" @click="store.cancelEdit()">
          <ChevronLeft :size="18" />
        </button>
        <EntryAvatar :title="draft.title || '?'" :size="40" />
        <h2 class="head-title">{{ store.editingIsNew ? 'New Entry' : 'Edit Entry' }}</h2>
      </div>

      <form class="edit" @submit.prevent="commit">
        <label class="edit-field">
          <span class="label">Title</span>
          <input ref="titleInput" v-model="draft.title" class="input" placeholder="e.g. GitHub" />
        </label>

        <label class="edit-field">
          <span class="label">Username</span>
          <input v-model="draft.username" class="input" placeholder="email or username" autocomplete="off" />
        </label>

        <label class="edit-field">
          <span class="label">Password</span>
          <span class="pw-row">
            <input
              v-model="draft.password"
              class="input mono"
              :type="revealedInEdit ? 'text' : 'password'"
              autocomplete="off"
            />
            <button type="button" class="icon-btn" :title="revealedInEdit ? 'Hide' : 'Reveal'" @click="revealedInEdit = !revealedInEdit">
              <component :is="revealedInEdit ? EyeOff : Eye" :size="15" />
            </button>
            <PasswordGenerator @use="applyGenerated" />
          </span>
        </label>

        <label class="edit-field">
          <span class="label">URL</span>
          <input v-model="draft.url" class="input" placeholder="https://…" autocomplete="off" />
        </label>

        <label class="edit-field">
          <span class="label">Notes</span>
          <textarea v-model="draft.notes" class="input notes-input" rows="4" />
        </label>

        <div class="custom-section">
          <div class="custom-row" v-for="(f, i) in draft.custom" :key="i">
            <input v-model="f.key" class="input key" placeholder="Field name" />
            <input v-model="f.value" class="input" placeholder="Value" />
            <button type="button" class="icon-btn danger" title="Remove field" @click="draft.custom.splice(i, 1)">
              <X :size="14" />
            </button>
          </div>
          <button type="button" class="btn ghost add-field" @click="addCustomField">
            <Plus :size="14" />
            Add field
          </button>
        </div>

        <div class="foot edit-foot">
          <button type="submit" class="btn primary">
            Save Entry
            <span class="kbd-group"><kbd>{{ modKey }}</kbd><kbd>↵</kbd></span>
          </button>
          <button type="button" class="btn" @click="store.cancelEdit()">
            Cancel
            <span class="kbd-group"><kbd>esc</kbd></span>
          </button>
        </div>
      </form>
    </template>
  </section>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  background: var(--bg);
  min-height: 0;
  overflow-y: auto;
}

.empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.empty-inner {
  text-align: center;
  color: var(--faint);
}
.empty-icon {
  opacity: 0.5;
}
.empty-title {
  margin: 12px 0 20px;
  font-size: 14px;
  color: var(--muted);
}
.multi-hint {
  margin: 16px 0 0;
  font-size: 11.5px;
  color: var(--faint);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}
.cheats {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12.5px;
}
.cheat {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: flex-start;
  text-align: left;
}
.cheat span {
  display: inline-flex;
  gap: 3px;
  min-width: 52px;
  justify-content: flex-end;
}

.head {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 16px 24px 14px;
  flex-shrink: 0;
}
.head-title {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fields {
  flex: 1;
  padding: 10px 24px 16px;
}

.field {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 12px;
  margin-bottom: 6px;
  border-radius: var(--radius);
  background: var(--panel-2);
  border: 1px solid var(--border-soft);
}
.label {
  width: 92px;
  flex-shrink: 0;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.value {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.clicky {
  cursor: pointer;
  border-radius: 5px;
  margin: -3px -6px;
  padding: 3px 6px;
}
.clicky:hover {
  background: var(--accent-soft);
  color: var(--text);
}
.clicky:active {
  background: var(--accent-border);
}
.mono {
  font-family: var(--mono);
  letter-spacing: 0.3px;
}

.field .copy {
  opacity: 0;
  transition: opacity 0.1s;
}
.field:hover .copy {
  opacity: 1;
}

.notes {
  padding: 12px;
  margin-top: 10px;
  border-radius: var(--radius);
  background: var(--panel-2);
  border: 1px solid var(--border-soft);
}
.notes-head {
  display: flex;
  align-items: center;
  gap: 4px;
}
.notes-head .label {
  flex: 1;
}
.notes-body {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--text-soft);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
  font-family: var(--mono);
  font-size: 12.5px;
  line-height: 1.55;
}
.notes-body.veiled {
  filter: blur(5px);
  user-select: none;
  pointer-events: none;
  max-height: 120px;
  overflow: hidden;
}
.notes-hint {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--faint);
}

.attachments {
  margin-top: 10px;
}
.attachments-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 2px 6px;
}
.attachments-head .label {
  width: auto;
}
.add-attachment {
  color: var(--muted);
  font-size: 12px;
  padding: 4px 8px;
}
.add-attachment:hover {
  color: var(--accent);
}
.attachment-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.attachment {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 12px;
  border-radius: var(--radius);
  background: var(--panel-2);
  border: 1px solid var(--border-soft);
  cursor: pointer;
}
.attachment:hover {
  border-color: var(--border);
  background: var(--panel-3);
}
.attachment-icon {
  color: var(--muted);
  flex-shrink: 0;
}
.attachment-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.attachment-size {
  color: var(--faint);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
.attachment .copy {
  opacity: 0;
  transition: opacity 0.1s;
}
.attachment:hover .copy {
  opacity: 1;
}

.times {
  margin: 16px 2px 0;
  color: var(--faint);
  font-size: 11.5px;
}

.foot {
  display: flex;
  gap: 8px;
  padding: 14px 24px 18px;
  border-top: 1px solid var(--border-soft);
  flex-shrink: 0;
}
.kbd-group {
  display: inline-flex;
  gap: 3px;
  margin-left: 2px;
  opacity: 0.65;
}

/* ---- edit mode ---- */
.edit {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 6px 24px 0;
  min-height: 0;
}
.edit-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 13px;
}
.pw-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.pw-row .icon-btn {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border: 1px solid var(--border);
  background: var(--panel);
}
.pw-row .icon-btn:hover {
  background: var(--panel-3);
}
.notes-input {
  resize: vertical;
  min-height: 70px;
  line-height: 1.5;
  font-family: var(--mono);
  font-size: 12.5px;
}

.custom-section {
  margin-bottom: 10px;
}
.custom-row {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
  align-items: center;
}
.custom-row .key {
  width: 160px;
  flex-shrink: 0;
}
.add-field {
  color: var(--muted);
  font-size: 12.5px;
  padding: 5px 8px;
}
.add-field:hover {
  color: var(--accent);
}

.edit-foot {
  margin-top: auto;
  padding-left: 0;
  padding-right: 0;
}
</style>
