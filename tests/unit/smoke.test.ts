import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

describe("toolchain", () => {
  it("provides a queryable happy-dom document", () => {
    const window = new Window();
    const status = window.document.createElement("p");
    status.setAttribute("data-test-id", "translator-status");
    status.textContent = "On-device translation ready";
    window.document.body.append(status);

    const renderedStatus = window.document.querySelector('[data-test-id="translator-status"]');

    expect(renderedStatus?.textContent).toBe("On-device translation ready");
  });
});
