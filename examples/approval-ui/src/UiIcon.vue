<script setup>
defineProps({ name: { type: String, required: true } })
const paths = {
  requests: ['M6 3h12v18H6z', 'M9 8h6M9 12h6M9 16h4'],
  review: ['M12 8v4l3 2', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0'],
  process: ['M9 3h6v5H9zM3 16h6v5H3zM15 16h6v5h-6z', 'M12 8v4M6 16v-4h12v4'],
  logout: ['M9 4H4v16h5M14 8l4 4-4 4M8 12h10'],
  arrow: ['M6 18 18 6M6 6h12v12'],
  settings: ['M4 7h16M4 17h16M9 4v6M15 14v6'],
  undo: ['M8 4 3 9l5 5M3 9h10a7 7 0 0 1 7 7v4'],
  redo: ['m16 4 5 5-5 5M21 9H11a7 7 0 0 0-7 7v4'],
}
</script>

<template>
  <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path v-for="(path, index) in paths[name] || paths.requests" :key="index" :d="path" />
  </svg>
</template>
