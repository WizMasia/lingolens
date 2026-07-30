import type { PdfStructureBlock } from "./paragraphs";

type PdfStructureNode = Readonly<{
  role: string;
  children: readonly (PdfStructureNode | PdfStructureContent)[];
}>;

type PdfStructureContent = Readonly<{
  type: string;
  id: string;
}>;

export function pdfStructureBlocks(root: PdfStructureNode | null | undefined): PdfStructureBlock[] {
  if (root == null) return [];
  const result: PdfStructureBlock[] = [];
  const visit = (node: PdfStructureNode, inheritedRole?: string): void => {
    const role = node.role || inheritedRole;
    for (const child of node.children) {
      if ("children" in child) visit(child, role);
      else if (role !== undefined && child.type === "content") result.push({ id: child.id, role });
    }
  };
  visit(root);
  return result;
}
