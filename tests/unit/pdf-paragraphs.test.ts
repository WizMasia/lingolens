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
});
