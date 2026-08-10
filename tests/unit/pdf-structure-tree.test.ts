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
    ).toEqual([{ ids: ["mc1"], role: "P" }]);
  });

  it("keeps distinct content identifiers in one inherited semantic block", () => {
    expect(
      pdfStructureBlocks({
        role: "Root",
        children: [
          {
            role: "P",
            children: [
              {
                role: "NonStruct",
                children: [
                  { type: "content", id: "body" },
                  { type: "content", id: "marker" },
                  { type: "content", id: "tail" },
                ],
              },
            ],
          },
        ],
      }),
    ).toEqual([{ ids: ["body", "marker", "tail"], role: "P" }]);
  });
});
