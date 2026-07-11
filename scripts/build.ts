import { existsSync } from "node:fs";
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
    "nano-offscreen": "src/offscreen/nano-offscreen.ts",
  },
  bundle: true,
  outdir: "dist",
  format: "iife",
  target: "chrome138",
  sourcemap: true,
});
const staticCopies = [
  cp("src/manifest.json", "dist/manifest.json"),
  cp("src/popup/popup.html", "dist/popup.html"),
  cp("src/options/options.html", "dist/options.html"),
  cp("src/offscreen/nano-offscreen.html", "dist/nano-offscreen.html"),
  cp("src/styles", "dist/styles", { recursive: true }),
];
const iconCopies = existsSync("src/icons")
  ? [cp("src/icons", "dist/icons", { recursive: true })]
  : [];

await Promise.all([...staticCopies, ...iconCopies]);
