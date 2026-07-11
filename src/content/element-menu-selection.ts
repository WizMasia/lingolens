import type { Settings } from "../shared/settings";
import type { SourceDetection, TranslationEngine } from "./ai-engine";
import type { ElementMenuSelection } from "./element-menu";
import type { ElementRecord, RecordStore } from "./records";
import { sourceDetectionRequest, sourceRecordText } from "./translation-attempt";

export type ElementMenuInspection = Readonly<{
  engine: TranslationEngine;
  record: ElementRecord;
  settings: Settings;
  store: RecordStore;
}>;

type PendingInspection = Readonly<{
  fingerprint: string;
  detection: Promise<SourceDetection>;
}>;

const pendingInspections = new WeakMap<ElementRecord, PendingInspection>();

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
  const existing = pendingInspections.get(record);
  const detectionPromise =
    existing?.fingerprint === fingerprint
      ? existing.detection
      : engine.detectSource(sourceDetectionRequest(record.source, sourceRecordText(record)));
  if (existing?.fingerprint !== fingerprint) {
    pendingInspections.set(record, { fingerprint, detection: detectionPromise });
  }
  let detection: SourceDetection;
  try {
    detection = await detectionPromise;
  } finally {
    if (pendingInspections.get(record)?.detection === detectionPromise) {
      pendingInspections.delete(record);
    }
  }
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
