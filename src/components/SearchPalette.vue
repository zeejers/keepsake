<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Folder, Search, X } from 'lucide-vue-next'
import EntryAvatar from './EntryAvatar.vue'
import { fuzzyScore } from '../lib/fuzzy'
import { useVaultStore } from '../stores/vault'
import type { SearchItem } from '../lib/types'

const store = useVaultStore()

const query = ref('')
const activeIndex = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)

const results = computed<SearchItem[]>(() => {
  const q = query.value.trim()
  const items = store.searchItems
  if (!q) {
    // no query: show entries first, then groups, alphabetical
    return [...items]
      .sort((a, b) =>
        a.kind === b.kind ? a.title.localeCompare(b.title) : a.kind === 'entry' ? -1 : 1,
      )
      .slice(0, 10)
  }
  return items
    .map((item) => {
      const haystacks = [item.title, item.subtitle, item.path, item.notes, item.url]
      let best = -1
      for (const h of haystacks) {
        const s = fuzzyScore(q, h)
        if (s > best) best = s
      }
      // title matches outrank path/username matches
      const titleScore = fuzzyScore(q, item.title)
      if (titleScore > 0) best = titleScore + 500
      return { item, score: best }
    })
    .filter((r) => r.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((r) => r.item)
})

watch(results, () => (activeIndex.value = 0))

watch(
  () => store.searchOpen,
  async (open) => {
    if (open) {
      query.value = ''
      activeIndex.value = 0
      await nextTick()
      inputEl.value?.focus()
    }
  },
)

function choose(item: SearchItem) {
  if (item.kind === 'entry') store.revealEntry(item.id)
  else store.selectGroup(item.id)
  store.searchOpen = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = Math.min(activeIndex.value + 1, results.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const item = results.value[activeIndex.value]
    if (item) choose(item)
  } else if (e.key === 'Escape') {
    store.searchOpen = false
  }
}
</script>

<template>
  <Transition name="fade">
    <div v-if="store.searchOpen" class="overlay" @mousedown.self="store.searchOpen = false">
      <Transition name="pop" appear>
        <div class="modal palette" @keydown="onKeydown">
          <div class="search-row">
            <Search :size="17" class="search-icon" />
            <input
              ref="inputEl"
              v-model="query"
              class="search-input"
              placeholder="Search entries and groups…"
              spellcheck="false"
            />
            <kbd>esc</kbd>
            <button class="close-btn" @click="store.searchOpen = false">
              <X :size="18" />
            </button>
          </div>

          <div class="results" v-if="results.length">
            <button
              v-for="(item, i) in results"
              :key="item.kind + item.id"
              class="result"
              :class="{ active: i === activeIndex }"
              @click="choose(item)"
              @mousemove="activeIndex = i"
            >
              <Folder v-if="item.kind === 'group'" :size="16" class="result-folder" />
              <EntryAvatar v-else :title="item.title" :size="26" />
              <span class="result-meta">
                <span class="result-title">{{ item.title }}</span>
                <span class="result-sub" v-if="item.subtitle">{{ item.subtitle }}</span>
              </span>
              <span class="result-path">{{ item.path }}</span>
            </button>
          </div>
          <div v-else class="no-results">No matches for “{{ query }}”</div>

          <div class="palette-foot">
            <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
            <span><kbd>↵</kbd> open</span>
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.overlay {
  padding-top: 12vh;
}

.palette {
  width: 560px;
  max-width: calc(100vw - 48px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.search-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-soft);
}
.search-icon {
  color: var(--muted);
  flex-shrink: 0;
}
.search-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--text);
  font-size: 15px;
}
.search-input::placeholder {
  color: var(--faint);
}

/* touch-only dismiss affordance; desktop uses esc */
.close-btn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--panel-3);
  color: var(--muted);
  cursor: pointer;
  flex-shrink: 0;
}
@media (hover: none) {
  .close-btn {
    display: inline-flex;
  }
}

.results {
  max-height: 380px;
  overflow-y: auto;
  padding: 6px;
}

.result {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-family: var(--sans);
}
.result.active {
  background: var(--accent-soft);
}

.result-folder {
  color: var(--muted);
  flex-shrink: 0;
  width: 26px;
}

.result-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.result-title {
  color: var(--text);
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.result-sub {
  color: var(--muted);
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.result-path {
  color: var(--faint);
  font-size: 11px;
  flex-shrink: 0;
  max-width: 160px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.no-results {
  padding: 28px;
  text-align: center;
  color: var(--faint);
  font-size: 13px;
}

.palette-foot {
  display: flex;
  gap: 16px;
  padding: 9px 16px;
  border-top: 1px solid var(--border-soft);
  color: var(--faint);
  font-size: 11.5px;
}
.palette-foot span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* phone: sit near the top so the on-screen keyboard doesn't cover results */
@media (max-width: 700px) {
  .overlay {
    padding-top: 10px;
  }
  .palette {
    max-width: calc(100vw - 20px);
  }
  .results {
    max-height: 45vh;
  }
  .search-input {
    font-size: 16px;
  }
}

@media (pointer: coarse) {
  .result {
    padding: 12px 10px;
  }
}

/* the footer only explains keyboard navigation — noise on touch */
@media (hover: none) {
  .palette-foot {
    display: none;
  }
}
</style>
