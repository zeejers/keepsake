<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import { useVaultStore } from '../stores/vault'

const store = useVaultStore()
</script>

<template>
  <Transition name="toast">
    <div v-if="store.toast" :key="store.toast.id" class="toast">
      <Check :size="14" class="toast-icon" />
      {{ store.toast.message }}
    </div>
  </Transition>
</template>

<style scoped>
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  border-radius: 999px;
  background: var(--panel-3);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  box-shadow: var(--shadow-lg);
  z-index: 200;
  white-space: nowrap;
}
.toast-icon {
  color: var(--accent);
}

.toast-enter-active {
  transition: opacity 0.18s ease, transform 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.3);
}
.toast-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
}
</style>
