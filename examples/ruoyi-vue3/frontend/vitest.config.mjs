import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: {
    '@/api/arcflow/approval': fileURLToPath(new URL('./src/api/arcflow/approval.js', import.meta.url)),
    '@/store/modules/user': fileURLToPath(new URL('../tests/user-store.stub.js', import.meta.url))
  } },
  test: { environment: 'jsdom', include: ['tests/**/*.test.js'] }
})
