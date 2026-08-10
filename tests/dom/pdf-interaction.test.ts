import { Window } from "happy-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TranslationResult } from "../../src/content/ai-engine";
import {
  createPdfParagraphInteraction,
  type PdfParagraphTarget,
} from "../../src/pdf/paragraph-interaction";

const testWindow = new Window();
Object.defineProperties(globalThis, {
  Element: { configurable: true, value: testWindow.Element },
  Event: { configurable: true, value: testWindow.Event },
  HTMLElement: { configurable: true, value: testWindow.HTMLElement },
  KeyboardEvent: { configurable: true, value: testWindow.KeyboardEvent },
  Node: { configurable: true, value: testWindow.Node },
  document: { configurable: true, value: testWindow.document },
});

const translated = (text: string): TranslationResult => ({
  kind: "translated",
  text,
  sourceLanguage: "en",
  targetLanguage: "ko",
  provenance: "lang",
});

const target = (id: string, text: string, spans: readonly HTMLElement[]): PdfParagraphTarget => ({
  id,
  text,
  pageNumber: 1,
  spans,
  bodySpans: spans,
});

const requiredElement = (selector: string): HTMLElement => {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) throw new TypeError(`Missing test element: ${selector}`);
  return element;
};

describe("PDF paragraph interaction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="page"><span id="a">first</span><span id="b">line</span><span id="c">other</span></div>`;
  });

  it("waits 200 ms, stays open inside a paragraph, and closes on leave", async () => {
    const translate = vi.fn().mockResolvedValue(translated("첫 문단"));
    const view = {
      showLoading: vi.fn(),
      showResult: vi.fn(),
      showError: vi.fn(),
      close: vi.fn(),
      refresh: vi.fn(),
    };
    const interaction = createPdfParagraphInteraction(document, translate, view);
    const page = requiredElement("#page");
    const a = requiredElement("#a");
    const b = requiredElement("#b");
    interaction.registerPage(page, [target("one", "first line", [a, b])]);

    a.dispatchEvent(new Event("pointerover", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(199);
    expect(translate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(translate).toHaveBeenCalledOnce();
    expect(view.showResult).toHaveBeenCalledOnce();

    b.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(view.close).not.toHaveBeenCalled();
    b.dispatchEvent(new Event("pointerout", { bubbles: true }));
    expect(view.close).toHaveBeenCalledOnce();
  });

  it("does not reopen an overlay after a late result", async () => {
    let finish = (value: TranslationResult): void => {
      throw new Error(`Unexpected result: ${value.kind}`);
    };
    const translate = vi.fn(
      () =>
        new Promise<TranslationResult>((resolve) => {
          finish = resolve;
        }),
    );
    const view = {
      showLoading: vi.fn(),
      showResult: vi.fn(),
      showError: vi.fn(),
      close: vi.fn(),
      refresh: vi.fn(),
    };
    const interaction = createPdfParagraphInteraction(document, translate, view);
    const page = requiredElement("#page");
    const a = requiredElement("#a");
    interaction.registerPage(page, [target("one", "first", [a])]);

    a.dispatchEvent(new Event("pointerover", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(200);
    a.dispatchEvent(new Event("pointerout", { bubbles: true }));
    finish(translated("늦은 결과"));
    await Promise.resolve();

    expect(view.close).toHaveBeenCalledOnce();
    expect(view.showResult).not.toHaveBeenCalled();
  });

  it("cancels pending translation when PDF translation is disabled", async () => {
    const translate = vi.fn().mockResolvedValue(translated("번역"));
    const view = {
      showLoading: vi.fn(),
      showResult: vi.fn(),
      showError: vi.fn(),
      close: vi.fn(),
      refresh: vi.fn(),
    };
    const interaction = createPdfParagraphInteraction(document, translate, view);
    const page = requiredElement("#page");
    const a = requiredElement("#a");
    interaction.registerPage(page, [target("one", "first", [a])]);

    a.dispatchEvent(new Event("pointerover", { bubbles: true }));
    interaction.setEnabled(false);
    await vi.advanceTimersByTimeAsync(200);

    expect(translate).not.toHaveBeenCalled();
    expect(view.close).toHaveBeenCalledOnce();
  });

  it("supports roving keyboard focus, blur cleanup, and Escape", async () => {
    const translate = vi.fn().mockResolvedValue(translated("번역"));
    const view = {
      showLoading: vi.fn(),
      showResult: vi.fn(),
      showError: vi.fn(),
      close: vi.fn(),
      refresh: vi.fn(),
    };
    const interaction = createPdfParagraphInteraction(document, translate, view);
    const page = requiredElement("#page");
    const a = requiredElement("#a");
    const c = requiredElement("#c");
    interaction.registerPage(page, [target("one", "first", [a]), target("two", "other", [c])]);
    const proxies = page.querySelectorAll<HTMLButtonElement>(".lt-pdf-focus-proxy");

    expect([...proxies].map(({ tabIndex }) => tabIndex)).toEqual([0, -1]);
    proxies[0]?.focus();
    await vi.advanceTimersByTimeAsync(200);
    proxies[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(proxies[1]);
    proxies[1]?.blur();
    expect(view.close).toHaveBeenCalled();
    proxies[1]?.focus();
    await vi.advanceTimersByTimeAsync(200);
    proxies[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(view.close).toHaveBeenCalled();
  });
});
