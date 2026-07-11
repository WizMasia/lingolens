import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const pngSize = async (path: string): Promise<readonly [number, number]> => {
  const bytes = await readFile(path);
  expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(new TextDecoder().decode(bytes.subarray(12, 16))).toBe("IHDR");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
};

describe("LingoLens static assets", () => {
  it("uses LingoLens metadata and four Chrome icon sizes", async () => {
    const manifest = JSON.parse(await readFile("src/manifest.json", "utf8")) as {
      name: string;
      action: { default_title: string };
    };
    expect(manifest.name).toBe("LingoLens");
    expect(manifest.action.default_title).toBe("LingoLens");
    await expect(readFile("src/icons/lingolens.svg", "utf8")).resolves.toContain("<svg");
    const options = await readFile("src/options/options.html", "utf8");
    expect(options).toContain("LingoLens");
    expect(options).not.toContain("Local Page Translator");
    await expect(pngSize("src/icons/icon-16.png")).resolves.toEqual([16, 16]);
    await expect(pngSize("src/icons/icon-32.png")).resolves.toEqual([32, 32]);
    await expect(pngSize("src/icons/icon-48.png")).resolves.toEqual([48, 48]);
    await expect(pngSize("src/icons/icon-128.png")).resolves.toEqual([128, 128]);
  });

  it("contains the required user and policy documents", async () => {
    const read = (path: string) => readFile(path, "utf8");
    await expect(read("README.md")).resolves.toContain("LingoLens");
    await expect(read("README.md")).resolves.toContain("ringo");
    await expect(read("README.ko.md")).resolves.toContain("LingoLens");
    await expect(read("LICENSE")).resolves.toContain("Apache License");
    await expect(read("PRIVACY.md")).resolves.toContain("No analytics");
    await expect(read("THIRD_PARTY_NOTICES.md")).resolves.toContain("esbuild");
  });
});
