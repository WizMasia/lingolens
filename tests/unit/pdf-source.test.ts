import { describe, expect, it, vi } from "vitest";
import { hasPdfHeader, loadLocalPdf, loadRemotePdf, remotePdfUrl } from "../../src/pdf/source";

const pdfBytes = (prefix = ""): Uint8Array =>
  new TextEncoder().encode(`${prefix}%PDF-1.7\nfixture`);
const pdfBuffer = (): ArrayBuffer => {
  const bytes = pdfBytes();
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

describe("PDF sources", () => {
  it("accepts only encoded HTTP and HTTPS viewer URLs", () => {
    expect(remotePdfUrl("?url=https%3A%2F%2Fexample.com%2Freport.pdf")?.href).toBe(
      "https://example.com/report.pdf",
    );
    expect(remotePdfUrl("?url=http%3A%2F%2Flocalhost%3A8080%2Freport")?.protocol).toBe("http:");
    expect(remotePdfUrl("?url=file%3A%2F%2F%2Ftmp%2Freport.pdf")).toBeUndefined();
    expect(remotePdfUrl("?url=not-a-url")).toBeUndefined();
  });

  it("recognizes a PDF header within the first 1,024 bytes", () => {
    expect(hasPdfHeader(pdfBytes())).toBe(true);
    expect(hasPdfHeader(pdfBytes(" ".repeat(1_019)))).toBe(true);
    expect(hasPdfHeader(pdfBytes(" ".repeat(1_020)))).toBe(false);
    expect(hasPdfHeader(new TextEncoder().encode("not a PDF"))).toBe(false);
  });

  it("loads a local PDF without persisting its bytes", async () => {
    const source = await loadLocalPdf(
      new File([pdfBuffer()], "manual.pdf", { type: "application/pdf" }),
    );
    expect(source.name).toBe("manual.pdf");
    expect(source.bytes).toEqual(pdfBytes());
    expect(source.sourceUrl).toBeUndefined();
  });

  it("loads a remote PDF and derives its filename", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(pdfBuffer(), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    );
    const url = new URL("https://example.com/files/report.pdf?download=1");

    const source = await loadRemotePdf(url, request);

    expect(request).toHaveBeenCalledWith(url, { credentials: "include" });
    expect(source.name).toBe("report.pdf");
    expect(source.sourceUrl).toBe(url.href);
  });

  it("rejects failed requests and non-PDF bytes", async () => {
    await expect(
      loadRemotePdf(
        new URL("https://example.com/protected.pdf"),
        vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 403 })),
      ),
    ).rejects.toThrow("PDF_REMOTE_FETCH");
    await expect(
      loadRemotePdf(
        new URL("https://example.com/not-pdf"),
        vi.fn<typeof fetch>().mockResolvedValue(new Response("html", { status: 200 })),
      ),
    ).rejects.toThrow("PDF_INVALID");
  });
});
