import { cp, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await build({
  entryPoints: {
    background: "src/background.ts",
    content: "src/content/index.ts",
    popup: "src/popup/popup.ts",
    options: "src/options/options.ts",
  },
  bundle: true,
  outdir: "dist",
  format: "iife",
  target: "chrome138",
  sourcemap: true,
});
await Promise.all([
  cp("src/manifest.json", "dist/manifest.json"),
  cp("src/popup/popup.html", "dist/popup.html"),
  cp("src/options/options.html", "dist/options.html"),
  cp("src/styles", "dist/styles", { recursive: true }),
  cp("src/icons", "dist/icons", { recursive: true }),
]);
