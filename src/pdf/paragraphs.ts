export type PdfTextFragment = Readonly<{
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  markedContentId?: string;
}>;

export type PdfStructureBlock = Readonly<{
  id: string;
  role: string;
}>;

export type PdfParagraph = Readonly<{
  id: string;
  pageNumber: number;
  text: string;
  fragmentIndexes: readonly number[];
}>;

type Line = Readonly<{
  x: number;
  y: number;
  height: number;
  fragmentIndexes: readonly number[];
}>;

const PARAGRAPH_ROLES = new Set([
  "P",
  "L",
  "LI",
  "LBODY",
  "CAPTION",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
]);

export function groupPdfParagraphs(
  pageNumber: number,
  fragments: readonly PdfTextFragment[],
  structure: readonly PdfStructureBlock[] = [],
): readonly PdfParagraph[] {
  const usable = fragments
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.text.trim().length > 0);
  const roles = new Map(
    structure
      .filter(({ role }) => PARAGRAPH_ROLES.has(role.toLocaleUpperCase("en-US")))
      .map(({ id, role }) => [id, role]),
  );
  const tagged = new Map<string, number[]>();
  const untagged: number[] = [];

  for (const { item, index } of usable) {
    const markedId = item.markedContentId;
    if (markedId !== undefined && roles.has(markedId)) {
      const indexes = tagged.get(markedId) ?? [];
      indexes.push(index);
      tagged.set(markedId, indexes);
    } else {
      untagged.push(index);
    }
  }

  const grouped = [...tagged.values()].map((indexes) => paragraph(pageNumber, fragments, indexes));
  const fallback = geometricParagraphs(pageNumber, fragments, untagged);
  return [...grouped, ...fallback].sort(
    (left, right) => requiredAt(left.fragmentIndexes, 0) - requiredAt(right.fragmentIndexes, 0),
  );
}

const geometricParagraphs = (
  pageNumber: number,
  fragments: readonly PdfTextFragment[],
  indexes: readonly number[],
): PdfParagraph[] => {
  const baselines: number[][] = [];
  for (const index of [...indexes].sort(
    (left, right) => requiredAt(fragments, right).y - requiredAt(fragments, left).y,
  )) {
    const item = requiredAt(fragments, index);
    const line = baselines.find((candidate) => {
      const first = requiredAt(fragments, requiredAt(candidate, 0));
      return Math.abs(first.y - item.y) <= Math.max(first.height, item.height) * 0.35;
    });
    if (line === undefined) baselines.push([index]);
    else line.push(index);
  }

  const lines: Line[] = baselines.flatMap((baseline) => {
    const sorted = baseline.sort(
      (left, right) => requiredAt(fragments, left).x - requiredAt(fragments, right).x,
    );
    const parts: number[][] = [];
    for (const index of sorted) {
      const previousPart = parts.at(-1);
      const previousIndex = previousPart?.at(-1);
      const previous = previousIndex === undefined ? undefined : fragments[previousIndex];
      const current = requiredAt(fragments, index);
      if (
        previous === undefined ||
        current.x - (previous.x + previous.width) > Math.max(48, current.height * 8)
      ) {
        parts.push([index]);
      } else if (previousPart !== undefined) {
        previousPart.push(index);
      }
    }
    return parts.map((part) => {
      const first = requiredAt(fragments, requiredAt(part, 0));
      return {
        x: first.x,
        y: first.y,
        height: Math.max(...part.map((index) => requiredAt(fragments, index).height)),
        fragmentIndexes: part,
      };
    });
  });

  const columns: Line[][] = [];
  for (const line of lines.sort((left, right) => left.x - right.x || right.y - left.y)) {
    const column = columns.find((candidate) => {
      const anchor = requiredAt(candidate, 0);
      return Math.abs(anchor.x - line.x) <= Math.max(50, line.height * 5);
    });
    if (column === undefined) columns.push([line]);
    else column.push(line);
  }

  return columns.flatMap((column) => {
    const paragraphs: number[][] = [];
    let previous: Line | undefined;
    for (const line of column.sort((left, right) => right.y - left.y)) {
      const verticalGap = previous === undefined ? Number.POSITIVE_INFINITY : previous.y - line.y;
      const continues =
        previous !== undefined &&
        verticalGap <= Math.max(previous.height, line.height) * 1.8 &&
        Math.max(previous.height, line.height) / Math.min(previous.height, line.height) <= 1.2 &&
        Math.abs(previous.x - line.x) <= Math.max(24, line.height * 1.5);
      if (!continues) paragraphs.push([...line.fragmentIndexes]);
      else requiredAt(paragraphs, paragraphs.length - 1).push(...line.fragmentIndexes);
      previous = line;
    }
    return paragraphs.map((fragmentIndexes) => paragraph(pageNumber, fragments, fragmentIndexes));
  });
};

const paragraph = (
  pageNumber: number,
  fragments: readonly PdfTextFragment[],
  fragmentIndexes: readonly number[],
): PdfParagraph => {
  const text = fragmentIndexes
    .map((index) => requiredAt(fragments, index).text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
  return {
    id: `${pageNumber}:${fragmentIndexes.join(",")}:${hash(text)}`,
    pageNumber,
    text,
    fragmentIndexes,
  };
};

const requiredAt = <Value>(values: readonly Value[], index: number): Value => {
  const value = values[index];
  if (value === undefined) throw new RangeError(`Missing PDF item at index ${index}`);
  return value;
};

const hash = (value: string): string => {
  let result = 2_166_136_261;
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0;
    result = Math.imul(result, 16_777_619);
  }
  return (result >>> 0).toString(36);
};
