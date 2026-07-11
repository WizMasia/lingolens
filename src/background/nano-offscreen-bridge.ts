import type { NanoLanguageDecision } from "../content/nano-language-detector";
import {
  MAX_NANO_CONTEXT_LENGTH,
  MAX_NANO_TEXT_LENGTH,
  type RuntimeMessage,
} from "../shared/protocol";

const MAX_NANO_LANGUAGE_LENGTH = 35;

export type NanoDetectRequest = Readonly<{ text: string; context: string }>;
export type NanoDetectResponse = NanoLanguageDecision;

export type NanoOffscreenBridge = Readonly<{
  detect(request: NanoDetectRequest): Promise<NanoDetectResponse>;
  close(): Promise<void>;
}>;

export type NanoOffscreenDocument = Readonly<{
  createDocument(options: {
    url: string;
    reasons: "DOM_SCRAPING"[];
    justification: string;
  }): Promise<void>;
  closeDocument(): Promise<void>;
}>;

export type NanoRuntime = Readonly<{
  sendMessage(message: RuntimeMessage): Promise<unknown>;
  hasOffscreenDocument?(): Promise<boolean>;
}>;

const unavailable = (): NanoLanguageDecision => ({ kind: "unavailable" });

export const createNanoOffscreenBridge = (
  offscreen: NanoOffscreenDocument,
  runtime: NanoRuntime,
): NanoOffscreenBridge => {
  let creating: Promise<void> | undefined;
  let operationQueue: Promise<void> = Promise.resolve();

  const queueOperation = <Result>(work: () => Promise<Result>): Promise<Result> => {
    const queued = operationQueue.then(work, work);
    operationQueue = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  };

  const ensureDocument = async (): Promise<void> => {
    if (creating === undefined) {
      creating = createOrReuseDocument().catch((error: unknown) => {
        creating = undefined;
        throw error;
      });
    }
    await creating;
  };

  const createOrReuseDocument = async (): Promise<void> => {
    const exists = (await runtime.hasOffscreenDocument?.()) ?? false;
    if (exists) return;
    await offscreen.createDocument({
      url: "nano-offscreen.html",
      reasons: ["DOM_SCRAPING"],
      justification: "Run an on-device language classification session",
    });
  };

  return {
    detect(request) {
      return queueOperation(async () => {
        try {
          await ensureDocument();
          const response = await runtime.sendMessage({
            type: "offscreen-nano-detect",
            text: request.text.slice(0, MAX_NANO_TEXT_LENGTH),
            context: request.context.slice(0, MAX_NANO_CONTEXT_LENGTH),
          });
          return parseNanoResponse(response);
        } catch {
          return unavailable();
        }
      });
    },
    close() {
      return queueOperation(async () => {
        await creating?.catch(() => undefined);
        await offscreen.closeDocument().catch(() => undefined);
        creating = undefined;
      });
    },
  };
};

const parseNanoResponse = (value: unknown): NanoLanguageDecision => {
  if (!isRecord(value) || !("kind" in value)) return unavailable();

  switch (value.kind) {
    case "unavailable":
      return unavailable();
    case "detected":
      return isDetectedDecision(value) ? value : unavailable();
    default:
      return unavailable();
  }
};

type NanoResponseRecord = Readonly<{
  kind?: unknown;
  language?: unknown;
  confidence?: unknown;
}>;

const isRecord = (value: unknown): value is NanoResponseRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isDetectedDecision = (value: NanoResponseRecord): value is NanoLanguageDecision =>
  Object.keys(value).length === 3 &&
  typeof value.language === "string" &&
  value.language.length > 0 &&
  value.language.length <= MAX_NANO_LANGUAGE_LENGTH &&
  typeof value.confidence === "number" &&
  Number.isFinite(value.confidence) &&
  value.confidence >= 0 &&
  value.confidence <= 1;
