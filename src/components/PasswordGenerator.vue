<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Dices, RefreshCw } from 'lucide-vue-next'
import { DEFAULT_SYMBOLS, generatePassword } from '../lib/fuzzy'

const emit = defineEmits<{ use: [password: string] }>()

const STORE_KEY = 'keepsake:pwgen'

const opts = reactive({
  length: 20,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  symbolSet: DEFAULT_SYMBOLS,
})
try {
  Object.assign(opts, JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}'))
} catch {
  // corrupted settings: fall back to defaults
}

const open = ref(false)
const preview = ref('')

// a class only counts if it can contribute characters
const enabledClasses = computed(
  () =>
    [opts.lower, opts.upper, opts.digits, opts.symbols && !!opts.symbolSet.trim()].filter(Boolean)
      .length,
)
const lastClass = (on: boolean) => on && enabledClasses.value === 1

function regen() {
  preview.value = generatePassword(opts.length, opts)
}

watch(opts, () => {
  localStorage.setItem(STORE_KEY, JSON.stringify(opts))
  if (open.value) regen()
})

function toggle() {
  open.value = !open.value
  if (open.value) regen()
}

function usePassword() {
  emit('use', preview.value)
  open.value = false
}
</script>

<template>
  <span class="pwgen">
    <button type="button" class="icon-btn" title="Generate password" @click="toggle">
      <Dices :size="15" />
    </button>

    <template v-if="open">
      <div class="pwgen-backdrop" @click="open = false" />
      <div class="pwgen-pop">
        <div class="pwgen-preview">
          <span class="pwgen-pw">{{ preview }}</span>
          <button type="button" class="icon-btn" title="Regenerate" @click="regen">
            <RefreshCw :size="13" />
          </button>
        </div>

        <label class="pwgen-len">
          <span class="pwgen-label">Length</span>
          <input v-model.number="opts.length" type="range" min="8" max="64" step="1" />
          <span class="pwgen-count">{{ opts.length }}</span>
        </label>

        <div class="pwgen-toggles">
          <label :class="{ locked: lastClass(opts.lower) }">
            <input v-model="opts.lower" type="checkbox" :disabled="lastClass(opts.lower)" />
            abc
          </label>
          <label :class="{ locked: lastClass(opts.upper) }">
            <input v-model="opts.upper" type="checkbox" :disabled="lastClass(opts.upper)" />
            ABC
          </label>
          <label :class="{ locked: lastClass(opts.digits) }">
            <input v-model="opts.digits" type="checkbox" :disabled="lastClass(opts.digits)" />
            123
          </label>
          <label :class="{ locked: lastClass(opts.symbols && !!opts.symbolSet.trim()) }">
            <input
              v-model="opts.symbols"
              type="checkbox"
              :disabled="lastClass(opts.symbols && !!opts.symbolSet.trim())"
            />
            #$&amp;
          </label>
        </div>

        <label v-if="opts.symbols" class="pwgen-symbols">
          <span class="pwgen-label">Symbols to use</span>
          <input v-model="opts.symbolSet" class="input" spellcheck="false" autocomplete="off" />
        </label>

        <button type="button" class="btn primary pwgen-use" @click="usePassword">
          Use password
        </button>
      </div>
    </template>
  </span>
</template>

<style scoped>
.pwgen {
  position: relative;
  display: inline-flex;
}

.pwgen-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
}

.pwgen-pop {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 41;
  width: 300px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
}

.pwgen-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-soft);
  background: var(--panel);
}
.pwgen-pw {
  flex: 1;
  min-width: 0;
  font-family: var(--mono);
  font-size: 12.5px;
  word-break: break-all;
  user-select: text;
}

.pwgen-label {
  color: var(--muted);
  font-size: 11.5px;
  font-weight: 600;
}

.pwgen-len {
  display: flex;
  align-items: center;
  gap: 10px;
}
.pwgen-len input[type='range'] {
  flex: 1;
  accent-color: var(--accent);
}
.pwgen-count {
  min-width: 22px;
  text-align: right;
  font-family: var(--mono);
  font-size: 12.5px;
  color: var(--text-soft);
}

.pwgen-toggles {
  display: flex;
  gap: 4px;
}
.pwgen-toggles label {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 4px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-soft);
  background: var(--panel);
  color: var(--text-soft);
  font-family: var(--mono);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}
.pwgen-toggles label.locked {
  cursor: default;
  opacity: 0.7;
}
.pwgen-toggles input {
  accent-color: var(--accent);
  margin: 0;
}

.pwgen-symbols {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pwgen-symbols .input {
  font-family: var(--mono);
  font-size: 12.5px;
}

.pwgen-use {
  padding: 8px;
}
</style>
