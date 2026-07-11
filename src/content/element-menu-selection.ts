import type { Settings } from "../shared/settings";
import type { TranslationEngine } from "./ai-engine";
import type { ElementMenuSelection } from "./element-menu";
import type { ElementRecord, RecordStore } from "./records";
import { sourceDetectionRequest, sourceRecordText } from "./translation-attempt";

export type ElementMenuInspection = Readonly<{
  engine: TranslationEngine;
  record: ElementRecord;
  settings: Settings;
  store: RecordStore;
}>;

export const inspectMenuSelection = (
  inspection: ElementMenuInspection,
): ElementMenuSelection | Promise<ElementMenuSelection> => {
  const { record, settings } = inspection;
  const source = selectedSource(record, settings);
  if (source !== "auto" || record.detection.kind !== "not-detected") {
    return menuSelection(record, settings);
  }

  return inspectAutomaticSource(inspection);
};

const inspectAutomaticSource = async (
  inspection: ElementMenuInspection,
): Promise<ElementMenuSelection> => {
  const { engine, record, settings, store } = inspection;
  const fingerprint = record.source.textContent ?? "";
  const detection = await engine.detectSource(
    sourceDetectionRequest(record.source, sourceRecordText(record)),
  );
  if (
    store.has(record) &&
    record.source.isConnected &&
    record.sourceFingerprint === fingerprint &&
    (record.source.textContent ?? "") === fingerprint &&
    record.detection.kind === "not-detected"
  ) {
    record.setDetection(detection);
  }
  return menuSelection(record, settings);
};

const menuSelection = (record: ElementRecord, settings: Settings): ElementMenuSelection => ({
  source: selectedSource(record, settings),
  target:
    record.languageOverride?.target ??
    record.lastSuccess?.targetLanguage ??
    targetLanguage(settings),
  detection: record.detection,
});

const selectedSource = (record: ElementRecord, settings: Settings): "auto" | string =>
  record.languageOverride?.source ??
  (settings.source.kind === "fixed" ? settings.source.language : "auto");

const targetLanguage = (settings: Settings): string =>
  settings.target.kind === "fixed" ? settings.target.language : settings.target.resolvedLanguage;
