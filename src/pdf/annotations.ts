import type { PdfTextFragment } from "./paragraphs";

export type AnnotationAssociation = Readonly<{
  bodyIndexes: readonly number[];
  annotationsByAnchor: ReadonlyMap<number, readonly number[]>;
}>;

type FragmentNeighbor = Readonly<{
  index: number;
  fragment: PdfTextFragment;
}>;

export const associateAnnotations = (
  fragments: readonly PdfTextFragment[],
  indexes: readonly number[],
): AnnotationAssociation => {
  const annotationsByAnchor = new Map<number, number[]>();
  const annotationIndexes = new Set<number>();

  for (const [position, candidateIndex] of indexes.entries()) {
    const candidate = requiredAt(fragments, candidateIndex);
    const anchor = nearestBodyNeighbors(fragments, indexes, position, candidate)
      .filter(({ fragment }) => qualifiesAsAnchor(candidate, fragment))
      .sort(
        (left, right) =>
          horizontalGap(candidate, left.fragment) - horizontalGap(candidate, right.fragment),
      )[0];
    if (anchor === undefined) continue;
    const annotations = annotationsByAnchor.get(anchor.index) ?? [];
    annotations.push(candidateIndex);
    annotationsByAnchor.set(anchor.index, annotations);
    annotationIndexes.add(candidateIndex);
  }

  return {
    bodyIndexes: indexes.filter((index) => !annotationIndexes.has(index)),
    annotationsByAnchor,
  };
};

const nearestBodyNeighbors = (
  fragments: readonly PdfTextFragment[],
  indexes: readonly number[],
  position: number,
  candidate: PdfTextFragment,
): readonly FragmentNeighbor[] => {
  const neighbors: FragmentNeighbor[] = [];
  for (const direction of [-1, 1] as const) {
    for (
      let offset = position + direction;
      offset >= 0 && offset < indexes.length;
      offset += direction
    ) {
      const index = requiredAt(indexes, offset);
      const fragment = requiredAt(fragments, index);
      if (fragment.height > candidate.height / 0.75) {
        neighbors.push({ index, fragment });
        break;
      }
    }
  }
  return neighbors;
};

const qualifiesAsAnchor = (candidate: PdfTextFragment, anchor: PdfTextFragment): boolean => {
  const baselineDelta = Math.abs(candidate.y - anchor.y);
  return (
    candidate.height <= anchor.height * 0.75 &&
    baselineDelta >= anchor.height * 0.2 &&
    baselineDelta <= anchor.height * 1.2 &&
    horizontalGap(candidate, anchor) <= anchor.height * 1.5
  );
};

const horizontalGap = (left: PdfTextFragment, right: PdfTextFragment): number =>
  Math.max(0, Math.max(left.x, right.x) - Math.min(left.x + left.width, right.x + right.width));

const requiredAt = <Value>(values: readonly Value[], index: number): Value => {
  const value = values[index];
  if (value === undefined) throw new RangeError(`Missing PDF item at index ${index}`);
  return value;
};
