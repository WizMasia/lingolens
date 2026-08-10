import { describe, expect, it } from "vitest";
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
      { id: "a", role: "P" },
      { id: "b", role: "H2" },
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
        { id: "one", role: "LI" },
        { id: "two", role: "LI" },
      ],
    );
    const zoomed = groupPdfParagraphs(
      3,
      [fragment("Item one", 40, 1_400, "one"), fragment("Item two", 40, 1_360, "two")],
      [
        { id: "one", role: "LI" },
        { id: "two", role: "LI" },
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
});
