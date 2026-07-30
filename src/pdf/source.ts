export type PdfBytes = Readonly<{
  name: string;
  bytes: Uint8Array;
  sourceUrl?: string;
}>;

export class PdfSourceError extends Error {
  constructor(readonly code: "PDF_REMOTE_FETCH" | "PDF_INVALID") {
    super(code);
    this.name = "PdfSourceError";
  }
}

export function remotePdfUrl(search: string): URL | undefined {
  const value = new URLSearchParams(search).get("url");
  if (value === null) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

export function hasPdfHeader(bytes: Uint8Array): boolean {
  return new TextDecoder("latin1").decode(bytes.subarray(0, 1_024)).includes("%PDF-");
}

export async function loadRemotePdf(url: URL, request: typeof fetch = fetch): Promise<PdfBytes> {
  let response: Response;
  try {
    response = await request(url, { credentials: "include" });
  } catch {
    throw new PdfSourceError("PDF_REMOTE_FETCH");
  }
  if (!response.ok) throw new PdfSourceError("PDF_REMOTE_FETCH");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!hasPdfHeader(bytes)) throw new PdfSourceError("PDF_INVALID");
  return { name: filename(url), bytes, sourceUrl: url.href };
}

export async function loadLocalPdf(file: File): Promise<PdfBytes> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasPdfHeader(bytes)) throw new PdfSourceError("PDF_INVALID");
  return { name: file.name || "document.pdf", bytes };
}

const filename = (url: URL): string => {
  const value = decodeURIComponent(url.pathname.split("/").pop() ?? "");
  return value.length > 0 ? value : "document.pdf";
};
