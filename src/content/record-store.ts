import { ElementRecord, type RecordStore } from "./records";

export const createRecordStore = (): RecordStore => {
  let records = new WeakMap<HTMLElement, ElementRecord>();
  const active = new Set<ElementRecord>();
  const onPhaseChange = (record: ElementRecord): void => {
    if (record.lastSuccess !== null || record.phase === "translated") active.add(record);
  };

  return {
    active,
    getOrCreate(source) {
      const existing = records.get(source);
      if (existing !== undefined) return existing;
      const record = new ElementRecord(source, onPhaseChange);
      records.set(source, record);
      return record;
    },
    has(record) {
      return records.get(record.source) === record;
    },
    markStale(record) {
      record.restoreView("stale");
      if (record.phase !== "stale") record.transition("stale");
    },
    restoreTranslation(source) {
      const record = records.get(source);
      if (record === undefined) return;
      record.deactivateTranslation();
      active.delete(record);
    },
    restoreAllTranslations() {
      for (const record of [...active]) record.deactivateTranslation();
      active.clear();
    },
    remove(source) {
      const record = records.get(source);
      if (record === undefined) return;
      record.restoreView("remove");
      active.delete(record);
      records.delete(source);
    },
    clear() {
      for (const record of active) record.restoreView("clear");
      active.clear();
      records = new WeakMap<HTMLElement, ElementRecord>();
    },
  };
};
