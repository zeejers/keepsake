<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronLeft, Copy, ExternalLink, Pencil, Plus, Trash2, User } from 'lucide-vue-next'
import { openUrl } from '@tauri-apps/plugin-opener'
import EntryAvatar from './EntryAvatar.vue'
import { useVaultStore } from '../stores/vault'
import { isMac, modKey, shiftKey, deleteKey } from '../lib/platform'

defineProps<{ narrow?: boolean }>()
const emit = defineEmits<{ back: [] }>()

const store = useVaultStore()

const menu = ref<{ x: number; y: number; entryId: string } | null>(null)

const menuMulti = computed(() => store.selectedEntryIds.size > 1)

const menuEntry = computed(() =>
  menu.value ? store.entries.find((e) => e.id === menu.value!.entryId) ?? null : null,
)

function newEntry() {
  store.createEntry()
}

function onRowClick(e: MouseEvent, id: string) {
  if (e.shiftKey) store.rangeSelectEntries(id)
  else if (e.metaKey || e.ctrlKey) store.toggleEntrySelect(id)
  else store.selectEntry(id)
}

function onDblClick(id: string) {
  store.selectEntry(id)
  store.startEdit()
}

function onRowContext(e: MouseEvent, id: string) {
  // right-clicking outside the current selection retargets it
  if (!store.selectedEntryIds.has(id)) store.selectEntry(id)
  const menuWidth = 210
  const menuHeight = 220
  menu.value = {
    x: Math.min(e.clientX, window.innerWidth - menuWidth - 8),
    y: Math.min(e.clientY, window.innerHeight - menuHeight - 8),
    entryId: id,
  }
}

function closeMenu() {
  menu.value = null
}

function menuEdit() {
  if (!menu.value) return
  store.selectEntry(menu.value.entryId)
  store.startEdit()
  closeMenu()
}

function menuCopyPassword() {
  if (!menu.value) return
  store.copyPassword(menu.value.entryId)
  closeMenu()
}

function menuCopyUsername() {
  if (!menu.value) return
  store.copyUsername(menu.value.entryId)
  closeMenu()
}

async function menuOpenUrl() {
  const url = menuEntry.value?.url?.trim()
  closeMenu()
  if (!url) return
  const target = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url
  try {
    await openUrl(target)
  } catch {
    store.showToast('Could not open URL')
  }
}

function menuDelete() {
  store.deleteSelectedEntries()
  closeMenu()
}

function onGlobalKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && menu.value) {
    e.stopPropagation()
    closeMenu()
  }
}

onMounted(() => window.addEventListener('keydown', onGlobalKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKeydown, true))

// keep the selected row in view when navigating with arrows
watch(
  () => store.selectedEntryId,
  async (id) => {
    if (!id) return
    await nextTick()
    document
      .querySelector(`[data-entry-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  },
)
</script>

<template>
  <section class="entry-list">
    <div class="pane-header" data-tauri-drag-region>
      <button v-if="narrow" class="icon-btn" title="Back to groups" @click="emit('back')">
        <ChevronLeft :size="18" />
      </button>
      <span class="pane-title" data-tauri-drag-region>
        {{ store.selectedGroupName || 'Entries' }}
      </span>
      <span class="badge">{{ store.entries.length }}</span>
      <button
        v-if="!store.inTrash"
        class="icon-btn"
        :title="`New entry (${modKey}N)`"
        @click="newEntry"
      >
        <Plus :size="17" />
      </button>
    </div>

    <div class="rows">
      <div v-if="store.entries.length === 0" class="empty">
        <template v-if="store.inTrash">Trash is empty</template>
        <template v-else-if="!store.selectedGroupId">
          <p>No group selected</p>
          <p class="empty-hint"><kbd>{{ modKey }}</kbd><kbd>{{ shiftKey }}</kbd><kbd>N</kbd> for a root group</p>
        </template>
        <template v-else>
          <p>No entries here</p>
          <p class="empty-hint"><kbd>{{ modKey }}</kbd><kbd>N</kbd> to add one</p>
        </template>
      </div>

      <button
        v-for="entry in store.entries"
        :key="entry.id"
        class="row"
        :class="{
          selected: store.selectedEntryIds.has(entry.id),
          primary: entry.id === store.selectedEntryId,
        }"
        :data-entry-id="entry.id"
        @click="onRowClick($event, entry.id)"
        @dblclick="onDblClick(entry.id)"
        @contextmenu.prevent="onRowContext($event, entry.id)"
      >
        <EntryAvatar :title="entry.title || '?'" />
        <span class="meta">
          <span class="title">{{ entry.title || '(untitled)' }}</span>
          <span class="subtitle">{{ entry.username || '—' }}</span>
        </span>
      </button>
    </div>

    <div class="footer">
      <button v-if="store.inTrash" class="btn danger footer-btn" :disabled="store.entries.length === 0" @click="store.emptyTrash()">
        <Trash2 :size="14" />
        Empty Trash
      </button>
      <button v-else class="btn footer-btn" @click="newEntry">
        <Plus :size="15" />
        New Entry
        <span class="kbd-group"><kbd>{{ modKey }}</kbd><kbd>N</kbd></span>
      </button>
    </div>

    <!-- context menu -->
    <Teleport to="body">
      <div v-if="menu" class="menu-backdrop" @mousedown="closeMenu" @contextmenu.prevent="closeMenu" />
      <div v-if="menu" class="menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }">
        <template v-if="!menuMulti">
          <button class="menu-item" @click="menuEdit">
            <Pencil :size="14" />
            Edit
            <span class="menu-kbd"><kbd>{{ modKey }}</kbd><kbd>E</kbd></span>
          </button>
          <button class="menu-item" @click="menuCopyPassword">
            <Copy :size="14" />
            Copy Password
            <span class="menu-kbd"><kbd>{{ modKey }}</kbd><kbd>C</kbd></span>
          </button>
          <button class="menu-item" @click="menuCopyUsername">
            <User :size="14" />
            Copy Username
            <span class="menu-kbd"><kbd>{{ modKey }}</kbd><kbd>B</kbd></span>
          </button>
          <button class="menu-item" :disabled="!menuEntry?.url" @click="menuOpenUrl">
            <ExternalLink :size="14" />
            Open URL
            <span class="menu-kbd"><kbd>{{ modKey }}</kbd><kbd>U</kbd></span>
          </button>
          <div class="menu-sep" />
        </template>
        <button class="menu-item danger" @click="menuDelete">
          <Trash2 :size="14" />
          <template v-if="menuMulti">
            {{ store.inTrash ? `Delete ${store.selectedEntryIds.size} Forever` : `Move ${store.selectedEntryIds.size} to Trash` }}
          </template>
          <template v-else>
            {{ store.inTrash ? 'Delete Forever' : 'Move to Trash' }}
          </template>
          <span class="menu-kbd"><kbd v-if="isMac">⌘</kbd><kbd>{{ deleteKey }}</kbd></span>
        </button>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.entry-list {
  display: flex;
  flex-direction: column;
  background: var(--panel-2);
  border-right: 1px solid var(--border-soft);
  min-height: 0;
}

.pane-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 14px 10px;
  flex-shrink: 0;
}
.pane-title {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rows {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 8px;
  min-height: 0;
}

.row {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  padding: 9px 10px;
  margin-bottom: 2px;
  border-radius: var(--radius);
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-family: var(--sans);
}
.row:hover {
  background: var(--panel-3);
}
.row.selected {
  background: var(--accent-soft);
}
.row.selected.primary {
  border-color: var(--accent-border);
}

.meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 1px;
}
.title {
  color: var(--text);
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.subtitle {
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty {
  padding: 48px 16px;
  text-align: center;
  color: var(--faint);
  font-size: 13px;
}
.empty p {
  margin: 0 0 8px;
}
.empty-hint {
  display: inline-flex;
  gap: 3px;
  align-items: center;
}

.footer {
  padding: 10px;
  border-top: 1px solid var(--border-soft);
  flex-shrink: 0;
}
.footer-btn {
  width: 100%;
  padding: 9px;
}
@media (pointer: coarse) {
  .footer-btn {
    padding: 14px;
    font-size: 15px;
    border-radius: var(--radius);
  }
}
.kbd-group {
  display: inline-flex;
  gap: 3px;
  margin-left: 4px;
  opacity: 0.7;
}

/* ---- context menu ---- */
.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 150;
}
.menu {
  position: fixed;
  z-index: 151;
  min-width: 200px;
  padding: 5px;
  background: var(--panel-3);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow-lg);
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 9px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  font-family: var(--sans);
  cursor: pointer;
  text-align: left;
}
.menu-item:hover:not(:disabled) {
  background: var(--accent-soft);
}
.menu-item:disabled {
  opacity: 0.4;
  cursor: default;
}
.menu-item.danger {
  color: var(--danger);
}
.menu-item.danger:hover {
  background: var(--danger-soft);
}
.menu-kbd {
  margin-left: auto;
  display: inline-flex;
  gap: 3px;
  opacity: 0.6;
}
.menu-sep {
  height: 1px;
  margin: 5px 4px;
  background: var(--border);
}
</style>
