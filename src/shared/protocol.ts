export type TabState = Readonly<{
  phase: "idle" | "downloading" | "translating" | "complete" | "error";
  completed: number;
  total: number;
  skipped: number;
  failed: number;
  message?: string;
}>;

export type RuntimeMessage =
  | { readonly type: "translate-page" }
  | { readonly type: "restore-page" }
  | { readonly type: "start-live-chat" }
  | { readonly type: "stop-live-chat" }
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
    case "start-live-chat":
      return { type: "start-live-chat" };
    case "stop-live-chat":
      return { type: "stop-live-chat" };
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
