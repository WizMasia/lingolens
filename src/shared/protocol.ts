export type TabState = Readonly<{
  phase: "idle" | "downloading" | "translating" | "complete" | "error";
  completed: number;
  total: number;
  skipped: number;
  failed: number;
  message?: string;
}>;

export const MAX_NANO_TEXT_LENGTH = 1_000;
export const MAX_NANO_CONTEXT_LENGTH = 160;

export type RuntimeMessage =
  | { readonly type: "translate-page" }
  | { readonly type: "restore-page" }
  | { readonly type: "open-pdf-viewer"; readonly source: "current-tab" | "local" }
  | { readonly type: "start-live-chat" }
  | { readonly type: "stop-live-chat" }
  | { readonly type: "nano-session-authorized" }
  | { readonly type: "detect-nano-source"; readonly text: string; readonly context: string }
  | { readonly type: "offscreen-nano-detect"; readonly text: string; readonly context: string }
  | { readonly type: "get-tab-state" }
  | { readonly type: "settings-changed" }
  | { readonly type: "tab-state"; readonly state: TabState };

type TabPhase = TabState["phase"];

function isRecord(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTabPhase(value: unknown): value is TabPhase {
  return (
    value === "idle" ||
    value === "downloading" ||
    value === "translating" ||
    value === "complete" ||
    value === "error"
  );
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseNanoDetectionRequest(
  type: "detect-nano-source" | "offscreen-nano-detect",
  value: object,
): RuntimeMessage | undefined {
  if (!("text" in value) || typeof value.text !== "string") return undefined;
  if (!("context" in value) || typeof value.context !== "string") return undefined;
  if (value.text.length > MAX_NANO_TEXT_LENGTH || value.context.length > MAX_NANO_CONTEXT_LENGTH) {
    return undefined;
  }
  return { type, text: value.text, context: value.context };
}

function parseTabState(value: unknown): TabState | undefined {
  if (
    !isRecord(value) ||
    !("phase" in value) ||
    !isTabPhase(value.phase) ||
    !("completed" in value) ||
    !isCount(value.completed) ||
    !("total" in value) ||
    !isCount(value.total) ||
    !("skipped" in value) ||
    !isCount(value.skipped) ||
    !("failed" in value) ||
    !isCount(value.failed)
  ) {
    return undefined;
  }

  const state = {
    phase: value.phase,
    completed: value.completed,
    total: value.total,
    skipped: value.skipped,
    failed: value.failed,
  };

  if (!("message" in value)) {
    return state;
  }

  return typeof value.message === "string" ? { ...state, message: value.message } : undefined;
}

export function parseMessage(value: unknown): RuntimeMessage | undefined {
  if (!isRecord(value) || !("type" in value)) {
    return undefined;
  }

  switch (value.type) {
    case "translate-page":
      return { type: "translate-page" };
    case "restore-page":
      return { type: "restore-page" };
    case "open-pdf-viewer":
      return "source" in value && (value.source === "current-tab" || value.source === "local")
        ? { type: "open-pdf-viewer", source: value.source }
        : undefined;
    case "start-live-chat":
      return { type: "start-live-chat" };
    case "stop-live-chat":
      return { type: "stop-live-chat" };
    case "nano-session-authorized":
      return { type: "nano-session-authorized" };
    case "detect-nano-source":
      return parseNanoDetectionRequest("detect-nano-source", value);
    case "offscreen-nano-detect":
      return parseNanoDetectionRequest("offscreen-nano-detect", value);
    case "get-tab-state":
      return { type: "get-tab-state" };
    case "settings-changed":
      return { type: "settings-changed" };
    case "tab-state": {
      if (!("state" in value)) {
        return undefined;
      }

      const state = parseTabState(value.state);
      return state === undefined ? undefined : { type: "tab-state", state };
    }
    default:
      return undefined;
  }
}
