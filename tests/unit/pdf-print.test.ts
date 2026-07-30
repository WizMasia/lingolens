import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import { type PrintablePdfDocument, printPdf } from "../../src/pdf/print";

describe("PDF printing", () => {
  it("renders every page before printing and clears canvases after print", async () => {
    const testWindow = new Window();
    const order: number[] = [];
    const pdf: PrintablePdfDocument = {
      numPages: 2,
      async getPage(pageNumber) {
        return {
          getViewport: () => ({ width: 600, height: 800 }),
          render: () => ({
            promise: Promise.resolve().then(() => {
              order.push(pageNumber);
            }),
          }),
        };
      },
    };
    const print = vi.fn();
    let afterprint = (): void => undefined;
    const host = {
      print,
      addEventListener(_type: "afterprint", listener: () => void) {
        afterprint = listener;
      },
    };
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: testWindow.document,
    });
    const container = document.createElement("div");

    await printPdf(pdf, container, host);

    expect(order).toEqual([1, 2]);
    expect(container.querySelectorAll("canvas")).toHaveLength(2);
    expect(print).toHaveBeenCalledOnce();
    afterprint();
    expect(container.children).toHaveLength(0);
  });
});
