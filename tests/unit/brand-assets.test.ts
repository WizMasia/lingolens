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

  it("documents the opt-in Nano live-chat limits and pending manual gate", async () => {
    const read = (path: string) => readFile(path, "utf8");
    const [english, korean, privacy, audit] = await Promise.all([
      read("README.md"),
      read("README.ko.md"),
      read("PRIVACY.md"),
      read("docs/verification/2026-07-10-runtime-audit.md"),
    ]);

    expect(english).toContain("Experimental live-chat language assistance is opt-in");
    expect(english).toContain("on-device classifier, not a translator");
    expect(english).toContain("explicitly click Prepare");
    expect(english).toContain("does not guarantee romanized Hindi or Urdu support");
    expect(korean).toContain("실험적 Live Chat 언어 지원은 선택 기능");
    expect(korean).toContain("기기 내 분류기이며 번역기가 아닙니다");
    expect(korean).toContain("명시적으로 눌러야");
    expect(korean).toContain("로마자 표기 힌디어 또는 우르두어 지원을 보장하지 않습니다");
    expect(privacy).toContain(
      "bounded chat-message text and nearby context only to the Chrome-resident Nano model",
    );
    expect(privacy).toContain("not transmitted outside Chrome or retained after the tab session");
    expect(audit).toContain("Nano feasibility gate: pending");
    expect(audit).toContain(
      "Confirm the options status reaches Ready without a network request carrying chat text.",
    );
    expect(audit).toContain(
      "Disable network after preparation and repeat a supported local translation.",
    );
  });
});
