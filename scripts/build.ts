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
    "pdf-viewer": "src/pdf/viewer.ts",
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
  cp("src/pdf/viewer.html", "dist/pdf-viewer.html"),
  cp("src/offscreen/nano-offscreen.html", "dist/nano-offscreen.html"),
  cp("src/styles", "dist/styles", { recursive: true }),
  cp("node_modules/pdfjs-dist/web/pdf_viewer.css", "dist/styles/pdfjs-viewer.css"),
  cp("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "dist/pdf.worker.min.mjs"),
  cp("node_modules/pdfjs-dist/cmaps", "dist/pdfjs/cmaps", { recursive: true }),
  cp("node_modules/pdfjs-dist/standard_fonts", "dist/pdfjs/standard_fonts", { recursive: true }),
  cp("node_modules/pdfjs-dist/wasm", "dist/pdfjs/wasm", { recursive: true }),
  cp("node_modules/pdfjs-dist/iccs", "dist/pdfjs/iccs", { recursive: true }),
  cp("node_modules/pdfjs-dist/image_decoders", "dist/pdfjs/image_decoders", { recursive: true }),
  cp("node_modules/pdfjs-dist/web/images", "dist/styles/images", { recursive: true }),
];
const iconCopies = existsSync("src/icons")
  ? [cp("src/icons", "dist/icons", { recursive: true })]
  : [];

await Promise.all([...staticCopies, ...iconCopies]);
