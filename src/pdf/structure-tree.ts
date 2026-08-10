import type { PdfStructureBlock } from "./paragraphs";

type PdfStructureNode = Readonly<{
  role: string;
  children: readonly (PdfStructureNode | PdfStructureContent)[];
}>;

type PdfStructureContent = Readonly<{
  type: string;
  id: string;
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

export function pdfStructureBlocks(root: PdfStructureNode | null | undefined): PdfStructureBlock[] {
  if (root == null) return [];
  const result: Array<{ role: string; ids: string[] }> = [];
  const visit = (
    node: PdfStructureNode,
    inheritedBlock?: { role: string; ids: string[] },
  ): void => {
    const block = PARAGRAPH_ROLES.has(node.role.toLocaleUpperCase("en-US"))
      ? { role: node.role, ids: [] }
      : inheritedBlock;
    if (block !== inheritedBlock && block !== undefined) result.push(block);
    for (const child of node.children) {
      if ("children" in child) visit(child, block);
      else if (block !== undefined && child.type === "content") block.ids.push(child.id);
    }
  };
  visit(root);
  return result.filter(({ ids }) => ids.length > 0);
}
