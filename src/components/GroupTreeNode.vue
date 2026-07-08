<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRight, Folder, FolderOpen, Pencil, Trash2 } from 'lucide-vue-next'
import type { GroupNode } from '../lib/types'
import { useVaultStore } from '../stores/vault'

const props = defineProps<{ node: GroupNode }>()
const emit = defineEmits<{
  rename: [id: string, name: string]
  menu: [id: string, name: string, x: number, y: number]
}>()

const store = useVaultStore()

const isSelected = computed(() => store.selectedGroupId === props.node.id)
const isExpanded = computed(() => store.expandedGroups.has(props.node.id))
const hasChildren = computed(() => props.node.children.length > 0)
const isRoot = computed(() => props.node.id === store.rootGroupId)

function select() {
  store.selectGroup(props.node.id)
}

function toggle(e: MouseEvent) {
  e.stopPropagation()
  store.toggleGroupExpanded(props.node.id)
}

function requestRename(e: MouseEvent) {
  e.stopPropagation()
  emit('rename', props.node.id, props.node.name)
}

function requestDelete(e: MouseEvent) {
  e.stopPropagation()
  store.deleteGroup(props.node.id)
}

function onContext(e: MouseEvent) {
  store.selectGroup(props.node.id)
  emit('menu', props.node.id, props.node.name, e.clientX, e.clientY)
}
</script>

<template>
  <div>
    <div
      class="row"
      :class="{ selected: isSelected }"
      :style="{ paddingLeft: 10 + node.depth * 16 + 'px' }"
      @click="select"
      @dblclick="requestRename"
      @contextmenu.prevent.stop="onContext"
    >
      <button v-if="hasChildren" class="chevron" :class="{ open: isExpanded }" @click="toggle">
        <ChevronRight :size="13" />
      </button>
      <span v-else class="chevron-spacer" />
      <component :is="isSelected ? FolderOpen : Folder" :size="15" class="folder" />
      <span class="name">{{ node.name || '(unnamed)' }}</span>
      <span class="actions" v-if="!isRoot">
        <button class="icon-btn mini" title="Rename" @click="requestRename">
          <Pencil :size="12" />
        </button>
        <button class="icon-btn mini danger" title="Move to trash" @click="requestDelete">
          <Trash2 :size="12" />
        </button>
      </span>
      <span v-if="node.entryCount > 0" class="count">{{ node.entryCount }}</span>
    </div>
    <template v-if="isExpanded">
      <GroupTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        @rename="(id, name) => emit('rename', id, name)"
        @menu="(id, name, x, y) => emit('menu', id, name, x, y)"
      />
    </template>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding-right: 8px;
  margin: 1px 8px;
  border-radius: var(--radius-sm);
  color: var(--text-soft);
  cursor: pointer;
  position: relative;
}
.row:hover {
  background: var(--panel-2);
  color: var(--text);
}
.row.selected {
  background: var(--accent-soft);
  color: var(--text);
}
.row.selected .folder {
  color: var(--accent);
}

.chevron {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  background: none;
  border: none;
  color: var(--faint);
  cursor: pointer;
  padding: 0;
  border-radius: 4px;
  transition: transform 0.13s ease;
}
.chevron:hover {
  color: var(--text);
}
.chevron.open {
  transform: rotate(90deg);
}
.chevron-spacer {
  width: 16px;
  flex-shrink: 0;
}

.folder {
  flex-shrink: 0;
  color: var(--muted);
}

.name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
}

.count {
  font-size: 11px;
  color: var(--faint);
  font-variant-numeric: tabular-nums;
}

.actions {
  display: none;
  gap: 2px;
}
.row:hover .actions {
  display: inline-flex;
}
.row:hover .count {
  display: none;
}
.icon-btn.mini {
  width: 22px;
  height: 22px;
}
</style>
