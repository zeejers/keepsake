<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ title: string; size?: number }>()

const letter = computed(() => (props.title.trim()[0] ?? '•').toUpperCase())

const hue = computed(() => {
  let h = 0
  for (const ch of props.title.toLowerCase()) {
    h = (h * 31 + ch.charCodeAt(0)) % 360
  }
  return h
})

const style = computed(() => {
  const s = props.size ?? 34
  return {
    width: s + 'px',
    height: s + 'px',
    fontSize: Math.round(s * 0.42) + 'px',
    background: `linear-gradient(135deg, hsl(${hue.value} 45% 38%), hsl(${(hue.value + 40) % 360} 50% 26%))`,
  }
})
</script>

<template>
  <span class="avatar" :style="style">{{ letter }}</span>
</template>

<style scoped>
.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  color: rgba(255, 255, 255, 0.92);
  font-weight: 700;
  flex-shrink: 0;
  letter-spacing: 0.5px;
}
</style>
