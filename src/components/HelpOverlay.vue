<script setup lang="ts">
import { useVaultStore } from '../stores/vault'
import { modKey as mod, shiftKey, deleteKey } from '../lib/platform'

const store = useVaultStore()

const sections = [
  {
    title: 'Navigate',
    items: [
      { keys: [mod, 'K'], label: 'Search everything' },
      { keys: ['↑', '↓'], label: 'Move between entries' },
      { keys: [mod, '1-9'], label: 'Switch vault tab' },
      { keys: [mod, 'O'], label: 'Open another vault' },
      { keys: [mod, 'K'], label: 'Unlock default vault (lock screen)' },
      { keys: ['esc'], label: 'Close / deselect' },
    ],
  },
  {
    title: 'Act on entries',
    items: [
      { keys: [mod, 'C'], label: 'Copy password' },
      { keys: [mod, 'B'], label: 'Copy username' },
      { keys: [mod, 'U'], label: 'Open URL in browser' },
      { keys: [mod, 'E'], label: 'Edit entry' },
      { keys: [mod, deleteKey], label: 'Move selection to trash' },
      { keys: ['Right', 'Click'], label: 'Entry actions menu' },
    ],
  },
  {
    title: 'Select & create',
    items: [
      { keys: [mod, 'Click'], label: 'Add/remove from selection' },
      { keys: [shiftKey, 'Click'], label: 'Select a range' },
      { keys: [mod, 'A'], label: 'Select all in group' },
      { keys: [mod, 'N'], label: 'New entry in current group' },
      { keys: [mod, shiftKey, 'N'], label: 'New group' },
      { keys: [mod, '↵'], label: 'Save entry (while editing)' },
      { keys: [mod, 'L'], label: 'Close current vault' },
    ],
  },
]
</script>

<template>
  <Transition name="fade">
    <div v-if="store.helpOpen" class="overlay centered" @mousedown.self="store.helpOpen = false">
      <Transition name="pop" appear>
        <div class="modal help">
          <div class="help-head">
            <h3>Keyboard Shortcuts</h3>
            <kbd>esc</kbd>
          </div>
          <div class="columns">
            <div v-for="section in sections" :key="section.title" class="col">
              <h4>{{ section.title }}</h4>
              <div v-for="item in section.items" :key="item.label" class="shortcut">
                <span class="keys">
                  <kbd v-for="k in item.keys" :key="k">{{ k }}</kbd>
                </span>
                <span class="desc">{{ item.label }}</span>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.centered {
  align-items: center;
  padding-bottom: 8vh;
}

.help {
  width: 720px;
  max-width: calc(100vw - 48px);
  padding: 22px 26px 24px;
}

.help-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}
h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.2px;
}

.columns {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 26px;
}

h4 {
  margin: 0 0 10px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.7px;
  color: var(--muted);
}

.shortcut {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.keys {
  display: inline-flex;
  gap: 3px;
  min-width: 74px;
}
.desc {
  font-size: 12.5px;
  color: var(--text-soft);
}
</style>
