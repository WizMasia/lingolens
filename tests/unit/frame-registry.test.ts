import { describe, expect, it, vi } from "vitest";
import type { FrameEndpoint } from "../../src/frame-registry";
import { createFrameRegistry } from "../../src/frame-registry";

const endpoint = (tabId: number, frameId: number, url: string): FrameEndpoint => ({
  tabId,
  frameId,
  url,
  post: vi.fn(),
});

describe("frame registry", () => {
  it("sends live chat commands only to matching live chat frames", () => {
    const registry = createFrameRegistry();
    const liveChat = endpoint(7, 2, "https://www.youtube.com/live_chat?v=fixture");
    const watchFrame = endpoint(7, 0, "https://www.youtube.com/watch?v=fixture");
    const evilFrame = endpoint(7, 3, "https://evil-youtube.com/live_chat?v=fixture");
    const invalidFrame = endpoint(7, 4, "not a URL");
    const otherTab = endpoint(8, 0, "https://www.youtube.com/live_chat?v=fixture");
    registry.add(liveChat);
    registry.add(watchFrame);
    registry.add(evilFrame);
    registry.add(invalidFrame);
    registry.add(otherTab);

    registry.sendToLiveChat(7, { type: "start-live-chat" });

    expect(liveChat.post).toHaveBeenCalledWith({ type: "start-live-chat" });
    expect(watchFrame.post).not.toHaveBeenCalled();
    expect(evilFrame.post).not.toHaveBeenCalled();
    expect(invalidFrame.post).not.toHaveBeenCalled();
    expect(otherTab.post).not.toHaveBeenCalled();
  });

  it("recognizes only a top-level live chat frame", () => {
    const registry = createFrameRegistry();
    registry.add(endpoint(7, 2, "https://www.youtube.com/live_chat?v=fixture"));

    expect(registry.hasTopLiveChat(7)).toBe(false);

    registry.add(endpoint(7, 0, "https://www.youtube.com/live_chat?v=fixture"));
    expect(registry.hasTopLiveChat(7)).toBe(true);
  });

  it("recognizes an exact registered live chat endpoint", () => {
    // Given
    const registry = createFrameRegistry();
    registry.add(endpoint(7, 2, "https://www.youtube.com/live_chat?v=fixture"));
    registry.add(endpoint(7, 3, "https://www.youtube.com/watch?v=fixture"));

    // When / Then
    expect(registry.hasLiveChatEndpoint(7, 2)).toBe(true);
    expect(registry.hasLiveChatEndpoint(7, 3)).toBe(false);
    expect(registry.hasLiveChatEndpoint(7, 4)).toBe(false);
  });

  it("broadcasts settings only to registered frames", () => {
    const registry = createFrameRegistry();
    const registered = endpoint(7, 0, "https://www.youtube.com/watch?v=fixture");
    const unregistered = endpoint(7, 1, "https://www.youtube.com/live_chat?v=fixture");
    registry.add(registered);

    registry.broadcast({ type: "settings-changed" });
    registry.broadcast({ type: "start-live-chat" });

    expect(registered.post).toHaveBeenCalledOnce();
    expect(registered.post).toHaveBeenCalledWith({ type: "settings-changed" });
    expect(unregistered.post).not.toHaveBeenCalled();
  });
});
