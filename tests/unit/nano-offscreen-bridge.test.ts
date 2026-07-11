import { describe, expect, it, vi } from "vitest";
import {
  createNanoOffscreenBridge,
  type NanoOffscreenDocument,
  type NanoRuntime,
} from "../../src/background/nano-offscreen-bridge";

const createOffscreen = (): NanoOffscreenDocument => ({
  createDocument: vi.fn(async () => undefined),
  closeDocument: vi.fn(async () => undefined),
});

const createRuntime = (response: unknown): NanoRuntime => ({
  sendMessage: vi.fn(async () => response),
});

describe("Nano offscreen bridge", () => {
  it("creates one offscreen document and forwards a bounded Nano request", async () => {
    // Given
    const offscreen = createOffscreen();
    const runtime = createRuntime({ kind: "detected", language: "es", confidence: 0.9 });
    const bridge = createNanoOffscreenBridge(offscreen, runtime);
    const context = "a".repeat(161);

    // When
    const result = await bridge.detect({ text: "hola", context });

    // Then
    expect(result).toEqual({ kind: "detected", language: "es", confidence: 0.9 });
    expect(offscreen.createDocument).toHaveBeenCalledOnce();
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      type: "offscreen-nano-detect",
      text: "hola",
      context: "a".repeat(160),
    });
  });

  it("returns unavailable when the offscreen response is malformed", async () => {
    // Given
    const bridge = createNanoOffscreenBridge(
      createOffscreen(),
      createRuntime({ kind: "detected" }),
    );

    // When
    const result = await bridge.detect({ text: "hola", context: "buenos días" });

    // Then
    expect(result).toEqual({ kind: "unavailable" });
  });

  it("returns unavailable when the offscreen response has an out-of-range confidence", async () => {
    // Given
    const bridge = createNanoOffscreenBridge(
      createOffscreen(),
      createRuntime({ kind: "detected", language: "es", confidence: 2 }),
    );

    // When
    const result = await bridge.detect({ text: "hola", context: "buenos días" });

    // Then
    expect(result).toEqual({ kind: "unavailable" });
  });

  it("reuses the existing offscreen document after a worker restart", async () => {
    // Given
    const offscreen = createOffscreen();
    const runtime = {
      sendMessage: vi.fn(async () => ({ kind: "unavailable" })),
      hasOffscreenDocument: vi.fn(async () => true),
    };
    const bridge = createNanoOffscreenBridge(offscreen, runtime);

    // When
    await bridge.detect({ text: "hola", context: "buenos días" });

    // Then
    expect(offscreen.createDocument).not.toHaveBeenCalled();
    expect(runtime.sendMessage).toHaveBeenCalledOnce();
  });

  it("waits for document creation before closing", async () => {
    // Given
    let releaseCreate: (() => void) | undefined;
    let signalCreateStarted: (() => void) | undefined;
    const createStarted = new Promise<void>((resolve) => {
      signalCreateStarted = resolve;
    });
    const offscreen: NanoOffscreenDocument = {
      createDocument: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            signalCreateStarted?.();
            releaseCreate = resolve;
          }),
      ),
      closeDocument: vi.fn(async () => undefined),
    };
    const bridge = createNanoOffscreenBridge(offscreen, createRuntime({ kind: "unavailable" }));
    const detection = bridge.detect({ text: "hola", context: "buenos días" });
    await createStarted;

    // When
    const closing = bridge.close();
    await Promise.resolve();
    await Promise.resolve();

    // Then
    expect(offscreen.closeDocument).not.toHaveBeenCalled();
    releaseCreate?.();
    await closing;
    await detection;
    expect(offscreen.closeDocument).toHaveBeenCalledOnce();
  });

  it("waits for an active Nano request before closing", async () => {
    // Given
    let releaseResponse: (() => void) | undefined;
    let signalRequestStarted: (() => void) | undefined;
    const requestStarted = new Promise<void>((resolve) => {
      signalRequestStarted = resolve;
    });
    const runtime: NanoRuntime = {
      sendMessage: vi.fn(
        () =>
          new Promise((resolve) => {
            signalRequestStarted?.();
            releaseResponse = () => resolve({ kind: "unavailable" });
          }),
      ),
    };
    const offscreen = createOffscreen();
    const bridge = createNanoOffscreenBridge(offscreen, runtime);
    const detection = bridge.detect({ text: "hola", context: "buenos días" });
    await requestStarted;

    // When
    const closing = bridge.close();
    await Promise.resolve();
    await Promise.resolve();

    // Then
    expect(offscreen.closeDocument).not.toHaveBeenCalled();
    releaseResponse?.();
    await detection;
    await closing;
    expect(offscreen.closeDocument).toHaveBeenCalledOnce();
  });

  it("closes the offscreen document", async () => {
    // Given
    const offscreen = createOffscreen();
    const bridge = createNanoOffscreenBridge(offscreen, createRuntime({ kind: "unavailable" }));

    // When
    await bridge.close();

    // Then
    expect(offscreen.closeDocument).toHaveBeenCalledOnce();
  });
});
