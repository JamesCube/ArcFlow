import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";
export default defineConfig({
  plugins: [
    (typeof uni === "function"
      ? uni
      : (uni as unknown as { default: typeof uni }).default)(),
  ],
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.ARCFLOW_BACKEND_PORT || 8080}`,
        changeOrigin: true,
      },
    },
  },
});
