import { describe, expect, it } from "vitest";
import { pdfTextFragments } from "../../src/pdf/text-items";

describe("PDF text items", () => {
  it("omits empty layout-only items so fragments stay aligned with visible spans", () => {
    const fragments = pdfTextFragments([
      {
        str: "Visible",
        transform: [1, 0, 0, 10, 20, 700],
        width: 40,
        height: 10,
      },
      {
        str: "",
        transform: [1, 0, 0, 10, 60, 700],
        width: 0,
        height: 0,
      },
      {
        str: "Text",
        transform: [1, 0, 0, 10, 20, 680],
        width: 24,
        height: 10,
      },
    ]);

    expect(fragments.map(({ text }) => text)).toEqual(["Visible", "Text"]);
  });

  it("retains the nearest marked-content identifier", () => {
    const fragments = pdfTextFragments([
      { type: "beginMarkedContentProps", id: "paragraph-1" },
      {
        str: "Tagged",
        transform: [1, 0, 0, 10, 20, 700],
        width: 40,
        height: 10,
      },
      { type: "endMarkedContent", id: "" },
    ]);

    expect(fragments[0]?.markedContentId).toBe("paragraph-1");
  });
});
