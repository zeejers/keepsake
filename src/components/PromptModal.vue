<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  title: string
  placeholder?: string
  initial?: string
  confirmLabel?: string
}>()

const emit = defineEmits<{
  submit: [value: string]
  close: []
}>()

const value = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

watch(
  () => props.open,
  async (open) => {
    if (open) {
      value.value = props.initial ?? ''
      await nextTick()
      inputEl.value?.focus()
      inputEl.value?.select()
    }
  },
)

function submit() {
  if (!value.value.trim()) return
  emit('submit', value.value.trim())
  emit('close')
}
</script>

<template>
  <Transition name="fade">
    <div v-if="open" class="overlay centered" @mousedown.self="emit('close')">
      <Transition name="pop" appear>
        <form class="modal prompt" @submit.prevent="submit" @keydown.esc.stop="emit('close')">
          <h3>{{ title }}</h3>
          <input ref="inputEl" v-model="value" class="input" :placeholder="placeholder" />
          <div class="actions">
            <button type="submit" class="btn primary" :disabled="!value.trim()">
              {{ confirmLabel ?? 'Create' }}
            </button>
            <button type="button" class="btn" @click="emit('close')">Cancel</button>
          </div>
        </form>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.centered {
  align-items: center;
  padding-bottom: 16vh;
}

.prompt {
  width: 380px;
  padding: 20px 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
