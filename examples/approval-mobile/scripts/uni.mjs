import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// Upstream's documented-in-code CI path disables compiler update/usage reporting.
// Keep local builds deterministic and avoid optional machine-identifier collection.
const cli = fileURLToPath(
  new URL(
    "../node_modules/@dcloudio/vite-plugin-uni/bin/uni.js",
    import.meta.url,
  ),
);
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, CI: "1" },
});
if (result.error) {
  console.error("Unable to start the installed uni-app compiler.");
  process.exit(1);
}
process.exit(result.status ?? 1);
