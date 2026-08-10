import { describe, expect, it } from "vitest";
import { associateAnnotations } from "../../src/pdf/annotations";
import {
  groupPdfParagraphs,
  type PdfStructureBlock,
  type PdfTextFragment,
} from "../../src/pdf/paragraphs";

const fragment = (
  text: string,
  x: number,
  y: number,
  markedContentId?: string,
  height = 10,
): PdfTextFragment => ({
  text,
  x,
  y,
  width: text.length * 6,
  height,
  ...(markedContentId === undefined ? {} : { markedContentId }),
});

describe("PDF paragraph grouping", () => {
  it("uses tagged paragraph blocks before geometric grouping", () => {
    const fragments = [
      fragment("First", 20, 700, "a"),
      fragment("paragraph", 55, 700, "a"),
      fragment("Second", 20, 685, "b"),
    ];
    const blocks: PdfStructureBlock[] = [
      { ids: ["a"], role: "P" },
      { ids: ["b"], role: "H2" },
    ];

    expect(groupPdfParagraphs(1, fragments, blocks).map(({ text }) => text)).toEqual([
      "First paragraph",
      "Second",
    ]);
  });

  it("joins wrapped lines and separates a large vertical gap", () => {
    const paragraphs = groupPdfParagraphs(2, [
      fragment("A wrapped", 20, 700),
      fragment("line.", 20, 686),
      fragment("A new paragraph.", 20, 650),
    ]);

    expect(paragraphs.map(({ text }) => text)).toEqual(["A wrapped line.", "A new paragraph."]);
  });

  it("keeps an untagged heading separate from following body text", () => {
    const paragraphs = groupPdfParagraphs(1, [
      fragment("Heading", 20, 700, undefined, 18),
      fragment("Body paragraph.", 20, 678, undefined, 10),
    ]);

    expect(paragraphs.map(({ text }) => text)).toEqual(["Heading", "Body paragraph."]);
  });

  it("keeps two columns separate even when their baselines match", () => {
    const paragraphs = groupPdfParagraphs(1, [
      fragment("Left one.", 20, 700),
      fragment("Right one.", 320, 700),
      fragment("Left two.", 20, 686),
      fragment("Right two.", 320, 686),
    ]);

    expect(paragraphs.map(({ text }) => text)).toEqual([
      "Left one. Left two.",
      "Right one. Right two.",
    ]);
  });

  it("keeps list items independent and identities stable across geometry changes", () => {
    const first = groupPdfParagraphs(
      3,
      [fragment("Item one", 20, 700, "one"), fragment("Item two", 20, 680, "two")],
      [
        { ids: ["one"], role: "LI" },
        { ids: ["two"], role: "LI" },
      ],
    );
    const zoomed = groupPdfParagraphs(
      3,
      [fragment("Item one", 40, 1_400, "one"), fragment("Item two", 40, 1_360, "two")],
      [
        { ids: ["one"], role: "LI" },
        { ids: ["two"], role: "LI" },
      ],
    );

    expect(first.map(({ text }) => text)).toEqual(["Item one", "Item two"]);
    expect(first.map(({ id }) => id)).toEqual(zoomed.map(({ id }) => id));
  });

  it("places a raised annotation after its anchor as translated parenthetical text", () => {
    const paragraphs = groupPdfParagraphs(1, [
      fragment("Term", 20, 700, undefined, 10),
      fragment("1", 46, 706, undefined, 6),
      fragment("continues", 54, 700, undefined, 10),
    ]);

    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.text).toBe("Term (1) continues");
    expect(paragraphs[0]?.fragmentIndexes).toEqual([0, 1, 2]);
    expect(paragraphs[0]?.bodyFragmentIndexes).toEqual([0, 2]);
  });

  it("keeps multiple raised annotations in source order after one anchor", () => {
    const paragraphs = groupPdfParagraphs(1, [
      fragment("Term", 20, 700, undefined, 10),
      fragment("1", 46, 706, undefined, 6),
      fragment("a", 52, 706, undefined, 6),
      fragment("continues", 100, 700, undefined, 10),
    ]);

    expect(paragraphs[0]?.text).toBe("Term (1) (a) continues");
    expect(paragraphs[0]?.bodyFragmentIndexes).toEqual([0, 3]);
  });

  it.each([
    { position: "raised", firstY: 708, secondY: 706 },
    { position: "lowered", firstY: 692, secondY: 694 },
  ])("keeps unequal-height adjacent $position annotations attached to body text", ({
    firstY,
    secondY,
  }) => {
    const paragraphs = groupPdfParagraphs(1, [
      fragment("Term", 20, 700, undefined, 10),
      fragment("a", 46, firstY, undefined, 4),
      fragment("b", 52, secondY, undefined, 6),
      fragment("continues", 60, 700, undefined, 10),
    ]);

    expect(paragraphs[0]?.text).toBe("Term continues (a) (b)");
    expect(paragraphs[0]?.fragmentIndexes).toHaveLength(4);
    expect([...new Set(paragraphs[0]?.fragmentIndexes)].sort()).toEqual([0, 1, 2, 3]);
    expect(paragraphs[0]?.bodyFragmentIndexes).toEqual([0, 3]);
  });

  it("keeps a uniformly small footnote as ordinary translatable text", () => {
    const paragraphs = groupPdfParagraphs(1, [
      fragment("1.", 20, 100, undefined, 6),
      fragment("Footnote text", 34, 100, undefined, 6),
    ]);

    expect(paragraphs.map(({ text }) => text)).toEqual(["1. Footnote text"]);
    expect(paragraphs[0]?.bodyFragmentIndexes).toEqual([0, 1]);
  });

  it("does not attach a distant small fragment as an inline annotation", () => {
    const paragraphs = groupPdfParagraphs(1, [
      fragment("Body", 20, 700, undefined, 10),
      fragment("1", 20, 100, undefined, 6),
    ]);

    expect(paragraphs.map(({ text }) => text)).toEqual(["Body", "1"]);
  });

  it("normalizes annotations inside tagged paragraph blocks", () => {
    const paragraphs = groupPdfParagraphs(
      1,
      [
        fragment("Term", 20, 700, "term", 10),
        fragment("1", 46, 706, "term", 6),
        fragment("continues", 54, 700, "term", 10),
      ],
      [{ ids: ["term"], role: "P" }],
    );

    expect(paragraphs[0]?.text).toBe("Term (1) continues");
    expect(paragraphs[0]?.bodyFragmentIndexes).toEqual([0, 2]);
  });

  it("normalizes annotations across distinct IDs in one tagged structure block", () => {
    const paragraphs = groupPdfParagraphs(
      1,
      [
        fragment("Term", 20, 700, "body", 10),
        fragment("1", 46, 706, "marker", 6),
        fragment("continues", 54, 700, "tail", 10),
      ],
      [{ ids: ["body", "marker", "tail"], role: "P" }],
    );

    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.text).toBe("Term (1) continues");
    expect(paragraphs[0]?.fragmentIndexes).toEqual([0, 1, 2]);
    expect(paragraphs[0]?.bodyFragmentIndexes).toEqual([0, 2]);
  });

  it("rejects a uniform page without scanning outward from every fragment", () => {
    const fragments = Array.from({ length: 200 }, (_, index) =>
      fragment(String(index), index * 8, 700, undefined, 10),
    );
    let reads = 0;
    const indexes = new Proxy(
      fragments.map((_, index) => index),
      {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/u.test(property)) reads += 1;
          return Reflect.get(target, property, receiver);
        },
      },
    );

    const association = associateAnnotations(fragments, indexes);

    expect(association.bodyIndexes).toHaveLength(200);
    expect(reads).toBeLessThan(1_000);
  });

  it.each([
    { height: 7.49, bodyIndexes: [0] },
    { height: 7.51, bodyIndexes: [0, 1] },
  ])("uses the height threshold for a candidate of $height", ({ height, bodyIndexes }) => {
    const paragraphs = groupPdfParagraphs(1, [
      fragment("Term", 20, 700, undefined, 10),
      fragment("1", 46, 706, undefined, height),
    ]);

    expect(paragraphs.flatMap(({ bodyFragmentIndexes: indexes }) => indexes)).toEqual(bodyIndexes);
  });

  it.each([
    { y: 702, bodyIndexes: [0] },
    { y: 701.9, bodyIndexes: [0, 1] },
    { y: 712, bodyIndexes: [0] },
    { y: 712.1, bodyIndexes: [0, 1] },
  ])("uses the baseline threshold for a candidate at y=$y", ({ y, bodyIndexes }) => {
    const paragraphs = groupPdfParagraphs(1, [
      fragment("Term", 20, 700, undefined, 10),
      fragment("1", 46, y, undefined, 6),
    ]);

    expect(paragraphs.flatMap(({ bodyFragmentIndexes: indexes }) => indexes)).toEqual(bodyIndexes);
  });

  it.each([
    { x: 59, bodyIndexes: [0] },
    { x: 59.1, bodyIndexes: [0, 1] },
  ])("uses the horizontal-gap threshold for a candidate at x=$x", ({ x, bodyIndexes }) => {
    const paragraphs = groupPdfParagraphs(1, [
      fragment("Term", 20, 700, undefined, 10),
      fragment("1", x, 706, undefined, 6),
    ]);

    expect(paragraphs.flatMap(({ bodyFragmentIndexes: indexes }) => indexes)).toEqual(bodyIndexes);
  });
});
