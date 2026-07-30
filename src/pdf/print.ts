type PrintableViewport = Readonly<{ width: number; height: number }>;

type PrintablePage<Viewport extends PrintableViewport> = Readonly<{
  getViewport(options: Readonly<{ scale: number }>): Viewport;
  render(
    options: Readonly<{
      canvas: HTMLCanvasElement;
      viewport: Viewport;
      intent: "print";
    }>,
  ): Readonly<{ promise: Promise<void> }>;
}>;

export type PrintablePdfDocument<Viewport extends PrintableViewport = PrintableViewport> =
  Readonly<{
    numPages: number;
    getPage(pageNumber: number): Promise<PrintablePage<Viewport>>;
  }>;

type PrintWindow = Readonly<{
  print(): void;
  addEventListener(
    type: "afterprint",
    listener: () => void,
    options: Readonly<{ once: true }>,
  ): void;
}>;

export async function printPdf<Viewport extends PrintableViewport>(
  pdf: PrintablePdfDocument<Viewport>,
  container: HTMLElement,
  host: PrintWindow = window,
): Promise<void> {
  container.replaceChildren();
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 150 / 72 });
    const canvas = container.ownerDocument.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    container.append(canvas);
    await page.render({ canvas, viewport, intent: "print" }).promise;
  }
  host.addEventListener("afterprint", () => container.replaceChildren(), { once: true });
  host.print();
}
