import type { PdfTextFragment } from "./paragraphs";

type PdfStringItem = Readonly<{
  str: string;
  transform: readonly unknown[];
  width: number;
  height: number;
}>;

type PdfMarkedItem = Readonly<{
  type: string;
  id?: string;
}>;

export function pdfTextFragments(
  items: readonly (PdfStringItem | PdfMarkedItem)[],
): PdfTextFragment[] {
  const fragments: PdfTextFragment[] = [];
  const markedStack: (string | undefined)[] = [];
  for (const item of items) {
    if ("str" in item) {
      if (item.str.length === 0) continue;
      const markedContentId = [...markedStack].reverse().find((value) => value !== undefined);
      fragments.push({
        text: item.str,
        x: numberAt(item.transform, 4),
        y: numberAt(item.transform, 5),
        width: item.width,
        height: item.height || Math.hypot(numberAt(item.transform, 2), numberAt(item.transform, 3)),
        ...(markedContentId === undefined ? {} : { markedContentId }),
      });
    } else if (item.type === "endMarkedContent") {
      markedStack.pop();
    } else {
      markedStack.push(item.type === "beginMarkedContentProps" ? item.id : undefined);
    }
  }
  return fragments;
}

const numberAt = (values: readonly unknown[], index: number): number => {
  const value = values[index];
  return typeof value === "number" ? value : 0;
};
