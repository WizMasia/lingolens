import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

describe("PDF viewer shell", () => {
  it("provides the div container and main document region required by PDF.js", async () => {
    const window = new Window();
    window.document.documentElement.innerHTML = await readFile("src/pdf/viewer.html", "utf8");
    const container = window.document.querySelector("#viewerContainer");
    expect(container).toBeInstanceOf(window.HTMLDivElement);
    if (!(container instanceof window.HTMLDivElement)) {
      throw new TypeError("Missing PDF viewer container");
    }
    expect(container.closest("main")).toBeInstanceOf(window.HTMLElement);
  });
});
