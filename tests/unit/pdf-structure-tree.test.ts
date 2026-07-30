import { describe, expect, it } from "vitest";
import { pdfStructureBlocks } from "../../src/pdf/structure-tree";

describe("PDF structure tree", () => {
  it("accepts the null tree returned by untagged PDFs", () => {
    expect(pdfStructureBlocks(null)).toEqual([]);
  });

  it("maps content identifiers to their nearest structural role", () => {
    expect(
      pdfStructureBlocks({
        role: "Root",
        children: [
          {
            role: "P",
            children: [{ type: "content", id: "mc1" }],
          },
        ],
      }),
    ).toEqual([{ id: "mc1", role: "P" }]);
  });
});
