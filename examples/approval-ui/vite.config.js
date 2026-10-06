import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
export default defineConfig({ plugins: [vue()], server: { port: 5173, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${process.env.ARCFLOW_BACKEND_PORT || 8080}`, changeOrigin: true } } }, test: { environment: 'jsdom', include: ['src/**/*.test.js'], alias: { '@/api/arcflow/approval': fileURLToPath(new URL('../ruoyi-vue3/frontend/src/api/arcflow/approval.js', import.meta.url)) } } })
