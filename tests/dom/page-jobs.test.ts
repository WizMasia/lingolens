import { Window } from "happy-dom";
import { beforeEach, describe, expect, it } from "vitest";

import type {
  TranslationEngine,
  TranslationRequest,
  TranslationResult,
} from "../../src/content/ai-engine";
import { TranslationError } from "../../src/content/ai-engine";
import { createTranslationController } from "../../src/content/controller";
import { type PageJobOutcome, runPageJob } from "../../src/content/jobs";
import type { Settings } from "../../src/shared/settings";

const testWindow = new Window();
Object.defineProperties(globalThis, {
  DOMRect: { configurable: true, value: testWindow.DOMRect },
  Element: { configurable: true, value: testWindow.Element },
  Event: { configurable: true, value: testWindow.Event },
  HTMLElement: { configurable: true, value: testWindow.HTMLElement },
  Node: { configurable: true, value: testWindow.Node },
  NodeFilter: { configurable: true, value: testWindow.NodeFilter },
  ShadowRoot: { configurable: true, value: testWindow.ShadowRoot },
  Text: { configurable: true, value: testWindow.Text },
  document: { configurable: true, value: testWindow.document },
  window: { configurable: true, value: testWindow },
});

Object.defineProperty(testWindow.HTMLElement.prototype, "getClientRects", {
  configurable: true,
  value: () => [new testWindow.DOMRect(0, 0, 100, 20)],
});

const SETTINGS: Settings = {
  displayMode: "inline",
  source: { kind: "auto" },
  target: { kind: "browser", resolvedLanguage: "ko" },
  trigger: { key: "Control", ctrl: false, alt: false, meta: false, shift: false },
};

const translated = (text: string): TranslationResult => ({
  kind: "translated",
  text,
  sourceLanguage: "en",
  targetLanguage: "ko",
});

const deferred = <T>(): Readonly<{
  promise: Promise<T>;
  resolve(value: T): void;
}> => {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value);
    },
  };
};

const addSources = (...texts: readonly string[]): readonly HTMLElement[] =>
  texts.map((text) => {
    const source = document.createElement("p");
    source.textContent = text;
    document.body.append(source);
    return source;
  });

describe("bounded page jobs", () => {
  beforeEach(() => document.body.replaceChildren());

  it("never runs more than three workers concurrently", async () => {
    // Given
    const gates = Array.from({ length: 5 }, () => deferred<PageJobOutcome>());
    let active = 0;
    let peak = 0;
    const job = runPageJob(
      gates,
      async (gate) => {
        active += 1;
        peak = Math.max(peak, active);
        const outcome = await gate.promise;
        active -= 1;
        return outcome;
      },
      () => undefined,
      new AbortController().signal,
    );
    await Promise.resolve();

    // When
    for (const gate of gates) gate.resolve("translated");
    await job;

    // Then
    expect(peak).toBe(3);
  });

  it("caps an explicit concurrency request above three", async () => {
    // Given
    const gates = Array.from({ length: 5 }, () => deferred<PageJobOutcome>());
    let active = 0;
    let peak = 0;
    const job = runPageJob(
      gates,
      async (gate) => {
        active += 1;
        peak = Math.max(peak, active);
        const outcome = await gate.promise;
        active -= 1;
        return outcome;
      },
      () => undefined,
      new AbortController().signal,
      4,
    );
    await Promise.resolve();

    // When
    for (const gate of gates) gate.resolve("translated");
    await job;

    // Then
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("counts every terminal outcome and reports progress after each element", async () => {
    // Given
    const progress: number[] = [];
    const outcomes = ["translated", "skipped", "failed", "translated"] as const;

    // When
    const summary = await runPageJob(
      outcomes,
      async (outcome) => outcome,
      (current) => progress.push(current.translated + current.skipped + current.failed),
      new AbortController().signal,
    );

    // Then
    expect(summary).toEqual({ translated: 2, skipped: 1, failed: 1, total: 4 });
    expect(progress).toHaveLength(4);
    expect(progress.at(-1)).toBe(4);
  });

  it("counts a rejected element as failed without aborting peers", async () => {
    // Given
    const visited: number[] = [];

    // When
    const summary = await runPageJob(
      [1, 2, 3],
      async (value) => {
        visited.push(value);
        if (value === 2) throw new TranslationError("translation-failed", "fixture");
        return "translated";
      },
      () => undefined,
      new AbortController().signal,
    );

    // Then
    expect(summary).toEqual({ translated: 2, skipped: 0, failed: 1, total: 3 });
    expect(visited).toHaveLength(3);
  });

  it("does not claim queued elements after cancellation", async () => {
    // Given
    const firstWave = deferred<PageJobOutcome>();
    const controller = new AbortController();
    const started: number[] = [];
    const pending = runPageJob(
      [0, 1, 2, 3, 4],
      async (value) => {
        started.push(value);
        return firstWave.promise;
      },
      () => undefined,
      controller.signal,
    );
    await Promise.resolve();

    // When
    controller.abort();
    firstWave.resolve("translated");
    await pending;

    // Then
    expect(started).toEqual([0, 1, 2]);
  });
});

describe("full-page controller", () => {
  beforeEach(() => document.body.replaceChildren());

  it("reports partial failure while allowing successful peers to finish", async () => {
    // Given
    addSources("First", "Broken", "Third");
    const engine: TranslationEngine = {
      async translate(request) {
        if (request.text === "Broken") {
          throw new TranslationError("translation-failed", "fixture");
        }
        return translated(`번역:${request.text}`);
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, settings: SETTINGS });

    // When
    await controller.translatePage();

    // Then
    expect(controller.getState()).toEqual({
      phase: "complete",
      completed: 3,
      total: 3,
      skipped: 0,
      failed: 1,
    });
    expect(document.querySelectorAll('[data-local-translator-ui="inline"]')).toHaveLength(2);
  });

  it("cancels a prior run before its queued elements start", async () => {
    // Given
    addSources("One", "Two", "Three", "Four");
    const gate = deferred<TranslationResult>();
    const requests: TranslationRequest[] = [];
    const engine: TranslationEngine = {
      translate(request) {
        requests.push(request);
        return requests.length <= 3 ? gate.promise : Promise.resolve(translated(request.text));
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, settings: SETTINGS });
    const first = controller.translatePage();
    await Promise.resolve();

    // When
    const second = controller.translatePage();
    gate.resolve(translated("old"));
    await Promise.all([first, second]);

    // Then
    expect(requests.map(({ text }) => text)).toEqual([
      "One",
      "Two",
      "Three",
      "One",
      "Two",
      "Three",
      "Four",
    ]);
    expect(controller.getState().phase).toBe("complete");
  });

  it("restores synchronously and prevents an active translation from rendering later", async () => {
    // Given
    addSources("One");
    const gate = deferred<TranslationResult>();
    const engine: TranslationEngine = {
      translate: () => gate.promise,
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, settings: SETTINGS });
    const pending = controller.translatePage();
    await Promise.resolve();

    // When
    controller.restorePage();

    // Then
    expect(controller.getState().phase).toBe("idle");
    expect(document.querySelector('[data-local-translator-ui="inline"]')).toBeNull();
    gate.resolve(translated("late"));
    await pending;
    expect(document.querySelector('[data-local-translator-ui="inline"]')).toBeNull();
  });

  it("does not resurrect a pending retranslation after page restoration", async () => {
    // Given
    const [source] = addSources("One");
    if (source === undefined) throw new Error("fixture source missing");
    const gate = deferred<TranslationResult>();
    let calls = 0;
    const engine: TranslationEngine = {
      translate(request) {
        calls += 1;
        return calls === 1 ? Promise.resolve(translated(request.text)) : gate.promise;
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, settings: SETTINGS });
    await controller.translateTarget(source);
    const pending = controller.retranslate(source, { source: "auto", target: "ko" });
    await Promise.resolve();

    // When
    controller.restorePage();
    gate.resolve(translated("late"));
    await pending;

    // Then
    expect(controller.store.active).toHaveLength(0);
    expect(document.querySelector('[data-local-translator-ui="inline"]')).toBeNull();
    source.textContent = "Updated after restore";
    await Promise.resolve();
    expect(controller.store.active).toHaveLength(0);
  });

  it("updates existing blocks without duplication and captures new content on only the next run", async () => {
    // Given
    addSources("First");
    let pass = 0;
    const requests: string[] = [];
    const engine: TranslationEngine = {
      async translate(request) {
        requests.push(request.text);
        return translated(`${pass}:${request.text}`);
      },
      async availability() {
        return "available";
      },
      destroy() {},
    };
    const controller = createTranslationController({ document, engine, settings: SETTINGS });
    await controller.translatePage();
    const added = addSources("Added")[0];
    if (added === undefined) throw new Error("fixture source missing");

    // When
    pass = 1;
    await controller.translatePage();

    // Then
    expect(requests).toEqual(["First", "First", "Added"]);
    expect(document.querySelectorAll('[data-local-translator-ui="inline"]')).toHaveLength(2);
  });
});
