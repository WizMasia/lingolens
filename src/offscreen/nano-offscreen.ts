import type { NanoLanguageDecision } from "../content/nano-language-detector";
import { parseMessage } from "../shared/protocol";

const RESPONSE_CONSTRAINT = {
  type: "object",
  properties: {
    language: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["language", "confidence"],
  additionalProperties: false,
} as const;

const MAX_NANO_LANGUAGE_LENGTH = 35;

const unavailable = (): NanoLanguageDecision => ({ kind: "unavailable" });

export type NanoMessageSender = Readonly<{ url?: string }>;

export type NanoOffscreenMessageHandler = (
  value: unknown,
  sender: NanoMessageSender,
) => Promise<NanoLanguageDecision> | undefined;

export type NanoOffscreenMessageHandlerDependencies = Readonly<{
  detect(text: string, context: string): Promise<NanoLanguageDecision>;
  isBackgroundSender(sender: NanoMessageSender): boolean;
}>;

let session: Promise<LanguageModel> | undefined;

const detect = async (text: string, context: string): Promise<NanoLanguageDecision> => {
  try {
    const model = await getSession();
    const response = await model.prompt(promptFor(text, context), {
      responseConstraint: RESPONSE_CONSTRAINT,
    });
    return parseNanoOffscreenResponse(response);
  } catch {
    session = undefined;
    return unavailable();
  }
};

const getSession = async (): Promise<LanguageModel> => {
  if (session === undefined) session = createSession();
  return session;
};

const createSession = async (): Promise<LanguageModel> => {
  if (!("LanguageModel" in globalThis)) throw new TypeError("LanguageModel is unavailable");
  if ((await LanguageModel.availability()) !== "available") {
    throw new TypeError("LanguageModel model is unavailable");
  }
  return LanguageModel.create({ samplingMode: "most-predictable" });
};

const promptFor = (text: string, context: string): string =>
  [
    "Identify the source language of the message. Do not translate or repeat its content.",
    `Message: ${text}`,
    `Nearby chat context: ${context}`,
    "Respond only with the constrained JSON object.",
  ].join("\n");

export const createNanoOffscreenMessageHandler =
  (dependencies: NanoOffscreenMessageHandlerDependencies): NanoOffscreenMessageHandler =>
  (value, sender) => {
    const message = parseMessage(value);
    if (message?.type !== "offscreen-nano-detect" || !dependencies.isBackgroundSender(sender)) {
      return undefined;
    }
    return dependencies.detect(message.text, message.context);
  };

export const parseNanoOffscreenResponse = (response: string): NanoLanguageDecision => {
  try {
    const value: unknown = JSON.parse(response);
    if (!isDecision(value)) return unavailable();
    return { kind: "detected", language: value.language, confidence: value.confidence };
  } catch {
    return unavailable();
  }
};

type NanoResponseRecord = Readonly<{
  language?: unknown;
  confidence?: unknown;
}>;

type NanoDetectedResponse = Readonly<{ language: string; confidence: number }>;

const isDecision = (value: unknown): value is NanoDetectedResponse =>
  isRecord(value) &&
  Object.keys(value).length === 2 &&
  typeof value.language === "string" &&
  value.language.length > 0 &&
  value.language.length <= MAX_NANO_LANGUAGE_LENGTH &&
  typeof value.confidence === "number" &&
  Number.isFinite(value.confidence) &&
  value.confidence >= 0 &&
  value.confidence <= 1;

const isRecord = (value: unknown): value is NanoResponseRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

if (typeof chrome !== "undefined") {
  const handleMessage = createNanoOffscreenMessageHandler({
    detect,
    isBackgroundSender: (sender) => sender.url === chrome.runtime.getURL("background.js"),
  });
  chrome.runtime.onMessage.addListener((value: unknown, sender) => handleMessage(value, sender));
}
