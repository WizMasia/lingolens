// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

describe("PDF viewer bootstrap", () => {
  it("loads safely outside the extension and exposes an initialized entry point", async () => {
    const { startPdfViewer } = await import("../../src/pdf/viewer");

    await expect(startPdfViewer(document)).rejects.toThrow("Missing PDF viewer element");
  });
});
