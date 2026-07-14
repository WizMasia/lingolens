import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type TranslationEngine,
  TranslationError,
  type TranslationResult,
} from "../../src/content/ai-engine";
import { createTranslationController } from "../../src/content/controller";
import type { Settings } from "../../src/shared/settings";

const SETTINGS: Settings = {
  displayMode: "inline",
  source: { kind: "auto" },
  target: { kind: "browser", resolvedLanguage: "ko" },
  liveChatNanoEnabled: false,
  trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
  menuTrigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: true },
};

class FixtureRectList implements DOMRectList {
  readonly [index: number]: DOMRect;
  readonly 0 = new DOMRect(0, 0, 100, 20);
  readonly length = 1;

  item(index: number): DOMRect | null {
    return index === 0 ? this[0] : null;
  }

  [Symbol.iterator](): ArrayIterator<DOMRect> {
    return [this[0]][Symbol.iterator]();
  }
}

type TranslateText = (text: string) => string | Promise<string>;

const engineThatTranslates = (translateText: TranslateText): TranslationEngine => ({
  async detectSource() {
    return { kind: "detected", language: "en", provenance: "language-detector" };
  },
  async translate(request): Promise<TranslationResult> {
    return {
      kind: "translated",
      text: await translateText(request.text),
      sourceLanguage: "en",
      targetLanguage: request.target,
      provenance: "language-detector",
    };
  },
  async availability() {
    return "available";
  },
  destroy() {},
});

beforeEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue(new FixtureRectList());
});

describe("document title page integration", () => {
  it("translates the title and a heading in one page job, then restores both", async () => {
    document.title = "Article title";
    const heading = document.createElement("h1");
    heading.textContent = "Visible heading";
    document.body.append(heading);
    const engine = engineThatTranslates((text) => `ko:${text}`);
    const controller = createTranslationController({ document, engine, settings: SETTINGS });

    await controller.translatePage();

    expect(document.title).toBe("ko:Article title");
    expect(controller.getState()).toMatchObject({ phase: "complete", completed: 2, total: 2 });
    expect(document.querySelectorAll('[data-local-translator-ui="inline"]')).toHaveLength(1);

    controller.restorePage();
    expect(document.title).toBe("Article title");
    expect(document.querySelector('[data-local-translator-ui="inline"]')).toBeNull();
    controller.destroy();
  });

  it("counts a title failure without stopping body translation", async () => {
    document.title = "Broken title";
    const paragraph = document.createElement("p");
    paragraph.textContent = "Working body";
    document.body.append(paragraph);
    const engine = engineThatTranslates((text) => {
      if (text === "Broken title") {
        return Promise.reject(new TranslationError("translation-failed", "fixture title failure"));
      }
      return Promise.resolve(`ko:${text}`);
    });
    const controller = createTranslationController({ document, engine, settings: SETTINGS });

    await controller.translatePage();

    expect(document.title).toBe("Broken title");
    expect(controller.getState()).toMatchObject({
      phase: "complete",
      completed: 2,
      total: 2,
      failed: 1,
    });
    expect(document.querySelectorAll('[data-local-translator-ui="inline"]')).toHaveLength(1);
    controller.destroy();
  });

  it("keeps targeted translation element-only", async () => {
    document.title = "Article title";
    const heading = document.createElement("h1");
    heading.textContent = "Visible heading";
    document.body.append(heading);
    const requests: string[] = [];
    const engine = engineThatTranslates((text) => {
      requests.push(text);
      return `ko:${text}`;
    });
    const controller = createTranslationController({ document, engine, settings: SETTINGS });

    await controller.translateTarget(heading);

    expect(requests).toEqual(["Visible heading"]);
    expect(document.title).toBe("Article title");
    controller.destroy();
  });
});
