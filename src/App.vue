<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ask } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Lock, Plus, Save, Search, X } from 'lucide-vue-next'
import UnlockScreen from './components/UnlockScreen.vue'
import Sidebar from './components/Sidebar.vue'
import EntryList from './components/EntryList.vue'
import EntryDetail from './components/EntryDetail.vue'
import SearchPalette from './components/SearchPalette.vue'
import HelpOverlay from './components/HelpOverlay.vue'
import PromptModal from './components/PromptModal.vue'
import Toast from './components/Toast.vue'
import { useVaultStore } from './stores/vault'
import { isAndroid, isMac, modKey } from './lib/platform'

const store = useVaultStore()
const unlockScreen = ref<InstanceType<typeof UnlockScreen> | null>(null)
const addingVault = ref(false)

// narrow (phone) layout: one pane at a time, drill-in navigation
const isNarrow = ref(window.innerWidth < 700)
const mobilePane = ref<'groups' | 'entries' | 'detail'>('groups')
function onResize() {
  isNarrow.value = window.innerWidth < 700
}
watch(
  () => store.selectedGroupId,
  (id) => {
    if (id !== null) mobilePane.value = 'entries'
    else if (mobilePane.value !== 'groups') mobilePane.value = 'groups'
  },
)
watch(
  () => store.selectedEntryId,
  (id) => {
    if (id) mobilePane.value = 'detail'
    else if (mobilePane.value === 'detail') mobilePane.value = 'entries'
  },
)
watch(
  () => store.activeId,
  () => {
    mobilePane.value = store.selectedEntryId ? 'detail' : store.selectedGroupId ? 'entries' : 'groups'
  },
)

// Mirror pane depth into WebView history so Android's back gesture (which
// Tauri routes to webView.goBack()) pops panes instead of closing the app;
// only at the root pane does the gesture reach the OS and exit.
const PANE_DEPTH = { groups: 0, entries: 1, detail: 2 } as const
let historyDepth = 0
let suppressPop = 0

function onPopstate() {
  if (suppressPop > 0) {
    suppressPop--
    return
  }
  historyDepth = Math.max(0, historyDepth - 1)
  if (mobilePane.value === 'detail') store.selectEntry(null)
  else if (mobilePane.value === 'entries') store.selectGroup(null)
}

watch(mobilePane, (pane) => {
  if (!isNarrow.value) return
  const target = PANE_DEPTH[pane]
  while (historyDepth < target) {
    history.pushState({ pane }, '')
    historyDepth++
  }
  if (historyDepth > target) {
    // in-app back (header buttons etc.): retire the stale history entries
    const steps = historyDepth - target
    historyDepth = target
    suppressPop++
    history.go(-steps)
  }
})

// group create / rename prompt state
const prompt = ref<{
  mode: 'create' | 'rename'
  groupId?: string
  parentId?: string
  initial?: string
} | null>(null)

function openNewGroupPrompt(parentId?: string) {
  prompt.value = { mode: 'create', parentId }
}

function openRenamePrompt(id: string, name: string) {
  prompt.value = { mode: 'rename', groupId: id, initial: name }
}

function onPromptSubmit(value: string) {
  if (!prompt.value) return
  if (prompt.value.mode === 'create') store.createGroup(value, prompt.value.parentId)
  else if (prompt.value.groupId) store.renameGroup(prompt.value.groupId, value)
}

async function confirmDirtyAndClose(id: string) {
  const session = store.sessions.find((s) => s.id === id)
  if (!session) return
  if (session.dirty) {
    const saveFirst = await ask(
      `"${session.fileName}" has unsaved changes. Save before closing?`,
      {
        title: 'Unsaved Changes',
        kind: 'warning',
        okLabel: 'Save & Close',
        cancelLabel: 'Discard & Close',
      },
    )
    if (saveFirst) {
      try {
        await store.save(id)
      } catch {
        return // save failed; keep the vault open
      }
    }
  }
  store.closeSession(id)
}

async function lockAll() {
  for (const id of store.sessions.map((s) => s.id)) {
    await confirmDirtyAndClose(id)
  }
}

async function visitSelectedUrl() {
  const url = store.selectedEntry?.url?.trim()
  if (!url) return
  const target = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url
  try {
    await openUrl(target)
  } catch {
    store.showToast('Could not open URL')
  }
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  return (
    !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
  )
}

function onKeydown(e: KeyboardEvent) {
  const mod = isMac ? e.metaKey : e.ctrlKey
  const typing = isTyping(e)

  // ---- works everywhere ----
  if (mod && e.key.toLowerCase() === 'o') {
    e.preventDefault()
    if (store.locked) unlockScreen.value?.pickDatabase()
    else addingVault.value = true
    return
  }

  if (store.locked) return

  if (mod && (e.key.toLowerCase() === 'k' || (e.key.toLowerCase() === 'f' && !e.shiftKey))) {
    e.preventDefault()
    store.searchOpen = !store.searchOpen
    return
  }

  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault()
    if (store.editing) {
      // commit the entry form first, then write to disk
      document.querySelector<HTMLFormElement>('form.edit')?.requestSubmit()
      void store.save()
    } else if (store.dirty) {
      void store.save()
    }
    return
  }

  if (mod && e.key.toLowerCase() === 'l') {
    e.preventDefault()
    if (store.activeId) void confirmDirtyAndClose(store.activeId)
    return
  }

  // ⌘1…⌘9 switch vault tabs
  if (mod && e.key >= '1' && e.key <= '9') {
    const session = store.sessions[Number(e.key) - 1]
    if (session) {
      e.preventDefault()
      store.setActive(session.id)
    }
    return
  }

  if (mod && e.key === 'Enter' && store.editing) {
    e.preventDefault()
    document.querySelector<HTMLFormElement>('form.edit')?.requestSubmit()
    return
  }

  if (mod && e.key.toLowerCase() === 'n') {
    e.preventDefault()
    if (e.shiftKey) openNewGroupPrompt()
    else if (!store.editing) store.createEntry()
    return
  }

  if (e.key === 'Escape') {
    if (store.searchOpen) store.searchOpen = false
    else if (store.helpOpen) store.helpOpen = false
    else if (addingVault.value) addingVault.value = false
    else if (prompt.value) prompt.value = null
    else if (store.editing) store.cancelEdit()
    else if (store.selectedEntryId || store.selectedEntryIds.size) store.selectEntry(null)
    return
  }

  // ---- below: only when not typing in a field ----
  if (typing || store.searchOpen || store.editing || prompt.value || addingVault.value) return

  if (mod && e.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) {
    if (store.selectedEntryId) {
      e.preventDefault()
      store.copyPassword()
    }
    return
  }

  if (mod && e.key.toLowerCase() === 'b') {
    e.preventDefault()
    store.copyUsername()
    return
  }

  if (mod && e.key.toLowerCase() === 'a') {
    e.preventDefault()
    store.selectAllEntries()
    return
  }

  if (mod && e.key.toLowerCase() === 'u') {
    e.preventDefault()
    void visitSelectedUrl()
    return
  }

  if (mod && e.key.toLowerCase() === 'e') {
    e.preventDefault()
    store.startEdit()
    return
  }

  if (e.key === 'Enter' && store.selectedEntryId) {
    e.preventDefault()
    store.startEdit()
    return
  }

  if ((e.key === 'Backspace' && mod) || e.key === 'Delete') {
    if (store.selectedEntryId || store.selectedEntryIds.size) {
      e.preventDefault()
      store.deleteSelectedEntries()
    }
    return
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (e.shiftKey) store.extendEntrySelection(1)
    else store.moveEntrySelection(1)
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (e.shiftKey) store.extendEntrySelection(-1)
    else store.moveEntrySelection(-1)
    return
  }

  if (e.key === '?') {
    e.preventDefault()
    store.helpOpen = !store.helpOpen
  }
}

// suppress the webview's default context menu (Reload etc.) everywhere
// except text fields, where native copy/paste is useful
function onContextMenu(e: MouseEvent) {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  e.preventDefault()
}

// On Android, leaving the app locks every vault: whoever picks up the
// phone next gets the unlock screen, not the password list.
function onVisibilityChange() {
  if (isAndroid && document.visibilityState === 'hidden' && !store.locked) {
    void store.lockAll()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('resize', onResize)
  window.addEventListener('popstate', onPopstate)
  document.addEventListener('visibilitychange', onVisibilityChange)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('contextmenu', onContextMenu)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('popstate', onPopstate)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <UnlockScreen v-if="store.locked" ref="unlockScreen" />

  <div v-else class="shell">
    <header class="topbar" data-tauri-drag-region>
      <div v-if="isMac" class="traffic-spacer" data-tauri-drag-region />

      <div class="tabs" data-tauri-drag-region>
        <button
          v-for="session in store.sessions"
          :key="session.id"
          class="tab"
          :class="{ on: session.id === store.activeId }"
          @click="store.setActive(session.id)"
        >
          <span class="tab-name">{{ session.fileName }}</span>
          <span v-if="session.dirty" class="dirty-dot" title="Unsaved changes" />
          <span
            class="tab-close"
            title="Close vault"
            @click.stop="confirmDirtyAndClose(session.id)"
          >
            <X :size="12" />
          </span>
        </button>
        <button class="icon-btn add-tab" :title="`Open another vault (${modKey}O)`" @click="addingVault = true">
          <Plus :size="15" />
        </button>
      </div>

      <div class="topbar-actions">
        <button class="search-pill" @click="store.searchOpen = true">
          <Search :size="13" />
          <span>Search</span>
          <span class="pill-keys"><kbd>{{ modKey }}</kbd><kbd>K</kbd></span>
        </button>
        <button
          class="btn"
          :class="{ primary: store.dirty }"
          :disabled="!store.dirty || store.saving"
          @click="store.save()"
        >
          <Save :size="14" />
          {{ store.saving ? 'Saving…' : 'Save' }}
        </button>
        <button class="icon-btn" title="Lock all vaults" @click="lockAll">
          <Lock :size="16" />
        </button>
      </div>
    </header>

    <main class="panes" :class="isNarrow ? ['narrow', 'show-' + mobilePane] : []">
      <Sidebar @new-group="openNewGroupPrompt" @rename-group="openRenamePrompt" />
      <EntryList :narrow="isNarrow" @back="store.selectGroup(null)" />
      <EntryDetail :narrow="isNarrow" @back="store.selectEntry(null)" />
    </main>
  </div>

  <UnlockScreen v-if="addingVault && !store.locked" modal @close="addingVault = false" />

  <SearchPalette />
  <HelpOverlay />
  <PromptModal
    :open="!!prompt"
    :title="prompt?.mode === 'rename' ? 'Rename group' : 'New group'"
    :initial="prompt?.initial"
    :confirm-label="prompt?.mode === 'rename' ? 'Rename' : 'Create'"
    placeholder="Group name"
    @submit="onPromptSubmit"
    @close="prompt = null"
  />
  <Toast />
</template>

<style scoped>
.shell {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 48px;
  padding: 0 12px 0 16px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.traffic-spacer {
  width: 64px;
  flex-shrink: 0;
}

.tabs {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.tabs::-webkit-scrollbar {
  display: none;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px 6px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 600;
  font-family: var(--sans);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}
.tab:hover {
  background: var(--panel-2);
  color: var(--text-soft);
}
.tab.on {
  background: var(--panel-3);
  border-color: var(--border);
  color: var(--text);
}
.tab-name {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  color: var(--faint);
}
.tab-close:hover {
  background: var(--danger-soft);
  color: var(--danger);
}
.add-tab {
  flex-shrink: 0;
}

.dirty-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.search-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px 6px 11px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--muted);
  font-size: 12.5px;
  font-family: var(--sans);
  cursor: pointer;
  transition: border-color 0.12s, color 0.12s;
}
.search-pill:hover {
  border-color: var(--accent-border);
  color: var(--text);
}
.pill-keys {
  display: inline-flex;
  gap: 3px;
}

.panes {
  flex: 1;
  display: grid;
  grid-template-columns: 240px 300px 1fr;
  min-height: 0;
}

/* phone layout: one pane at a time */
.panes.narrow {
  grid-template-columns: 1fr;
}
.panes.narrow > * {
  display: none !important;
}
.panes.narrow.show-groups > :nth-child(1),
.panes.narrow.show-entries > :nth-child(2),
.panes.narrow.show-detail > :nth-child(3) {
  display: flex !important;
}
</style>
