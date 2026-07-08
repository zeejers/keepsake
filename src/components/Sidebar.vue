<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { FolderPlus, Pencil, Trash2 } from 'lucide-vue-next'
import GroupTreeNode from './GroupTreeNode.vue'
import { useVaultStore } from '../stores/vault'
import { modKey, shiftKey } from '../lib/platform'

const store = useVaultStore()

const emit = defineEmits<{
  newGroup: [parentId?: string]
  renameGroup: [id: string, name: string]
}>()

const menu = ref<{ x: number; y: number; groupId: string | null; groupName: string } | null>(null)

const totalGroups = computed(() => {
  let n = 0
  const walk = (nodes: typeof store.tree) => {
    for (const node of nodes) {
      n++
      walk(node.children)
    }
  }
  walk(store.tree)
  return n
})

const trashSelected = computed(
  () => store.recycleBinId !== null && store.selectedGroupId === store.recycleBinId,
)

function selectTrash() {
  if (store.recycleBinId) store.selectGroup(store.recycleBinId)
}

/** Clicking blank tree space deselects every group (new groups then go to the root). */
function deselectAll() {
  store.selectGroup(null)
}

function clampMenu(x: number, y: number) {
  return {
    x: Math.min(x, window.innerWidth - 210),
    y: Math.min(y, window.innerHeight - 160),
  }
}

function onGroupMenu(id: string, name: string, x: number, y: number) {
  menu.value = { ...clampMenu(x, y), groupId: id, groupName: name }
}

function onBlankContext(e: MouseEvent) {
  menu.value = { ...clampMenu(e.clientX, e.clientY), groupId: null, groupName: '' }
}

function closeMenu() {
  menu.value = null
}

function menuNewGroup() {
  if (!menu.value) return
  // blank-space menu creates at the root; group menu creates a subgroup
  emit('newGroup', menu.value.groupId ?? store.rootGroupId ?? undefined)
  closeMenu()
}

function menuRename() {
  if (!menu.value?.groupId) return
  emit('renameGroup', menu.value.groupId, menu.value.groupName)
  closeMenu()
}

function menuDelete() {
  if (!menu.value?.groupId) return
  store.deleteGroup(menu.value.groupId)
  closeMenu()
}

const menuIsGroup = computed(() => !!menu.value?.groupId)
const menuIsRoot = computed(() => menu.value?.groupId === store.rootGroupId)

function onGlobalKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && menu.value) {
    e.stopPropagation()
    closeMenu()
  }
}

onMounted(() => window.addEventListener('keydown', onGlobalKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKeydown, true))
</script>

<template>
  <aside class="sidebar">
    <div class="pane-header" data-tauri-drag-region>
      <span class="pane-title" data-tauri-drag-region>Groups</span>
      <span class="badge">{{ totalGroups }}</span>
      <button class="icon-btn" :title="`New group (${modKey}${shiftKey}N)`" @click="emit('newGroup')">
        <FolderPlus :size="16" />
      </button>
    </div>

    <div
      class="tree"
      @click.self="deselectAll"
      @contextmenu.prevent.self="onBlankContext"
    >
      <GroupTreeNode
        v-for="node in store.tree"
        :key="node.id"
        :node="node"
        @rename="(id, name) => emit('renameGroup', id, name)"
        @menu="onGroupMenu"
      />
      <div
        class="tree-filler"
        @click="deselectAll"
        @contextmenu.prevent="onBlankContext"
      />
    </div>

    <button
      v-if="store.recycleBinId"
      class="trash-row"
      :class="{ selected: trashSelected }"
      @click="selectTrash"
    >
      <Trash2 :size="15" />
      <span class="trash-label">Trash</span>
      <span class="badge">{{ store.trashCount }}</span>
    </button>

    <!-- context menu -->
    <Teleport to="body">
      <div v-if="menu" class="menu-backdrop" @mousedown="closeMenu" @contextmenu.prevent="closeMenu" />
      <div v-if="menu" class="menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }">
        <button class="menu-item" @click="menuNewGroup">
          <FolderPlus :size="14" />
          {{ menuIsGroup ? 'New Subgroup' : 'New Group' }}
        </button>
        <template v-if="menuIsGroup && !menuIsRoot">
          <button class="menu-item" @click="menuRename">
            <Pencil :size="14" />
            Rename
          </button>
          <div class="menu-sep" />
          <button class="menu-item danger" @click="menuDelete">
            <Trash2 :size="14" />
            Move to Trash
          </button>
        </template>
      </div>
    </Teleport>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  background: var(--panel);
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
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.2px;
}

.tree {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 8px;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.tree > :first-child {
  flex-shrink: 0;
}
.tree-filler {
  flex: 1;
  min-height: 40px;
}

.trash-row {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 8px;
  padding: 9px 10px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 13px;
  font-family: var(--sans);
  cursor: pointer;
  flex-shrink: 0;
}
.trash-row:hover {
  background: var(--panel-2);
  color: var(--text);
}
.trash-row.selected {
  background: var(--accent-soft);
  color: var(--text);
}
.trash-label {
  flex: 1;
  text-align: left;
}

@media (pointer: coarse) {
  .trash-row {
    padding: 13px 12px;
    font-size: 15px;
  }
}

/* ---- context menu (matches EntryList's) ---- */
.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 150;
}
.menu {
  position: fixed;
  z-index: 151;
  min-width: 180px;
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
.menu-item:hover {
  background: var(--accent-soft);
}
.menu-item.danger {
  color: var(--danger);
}
.menu-item.danger:hover {
  background: var(--danger-soft);
}
.menu-sep {
  height: 1px;
  margin: 5px 4px;
  background: var(--border);
}
</style>
