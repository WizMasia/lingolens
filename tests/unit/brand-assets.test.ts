import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const pngSize = async (path: string): Promise<readonly [number, number]> => {
  const bytes = await readFile(path);
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
    await expect(pngSize("src/icons/icon-16.png")).resolves.toEqual([16, 16]);
    await expect(pngSize("src/icons/icon-32.png")).resolves.toEqual([32, 32]);
    await expect(pngSize("src/icons/icon-48.png")).resolves.toEqual([48, 48]);
    await expect(pngSize("src/icons/icon-128.png")).resolves.toEqual([128, 128]);
  });
});
