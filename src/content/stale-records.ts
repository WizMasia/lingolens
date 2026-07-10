import type { ElementRecord, RecordStore } from "./records";

export type ActiveRecordObserver = Readonly<{
  sync(): void;
  disconnect(): void;
}>;

const UI_SELECTOR = "[data-local-translator-ui]";

export const createActiveRecordObserver = (
  document: Document,
  store: RecordStore,
  onStale: (record: ElementRecord) => void,
): ActiveRecordObserver => {
  let observer: MutationObserver | null = null;
  let observedRoots = new Set<ShadowRoot>();

  const sync = (): void => {
    removeDisconnected(store);
    if (store.active.size === 0) {
      observer?.disconnect();
      observer = null;
      observedRoots = new Set<ShadowRoot>();
      return;
    }
    if (observer === null) {
      const Observer = document.defaultView?.MutationObserver;
      if (Observer === undefined) return;
      observer = new Observer((mutations) => inspectMutations(mutations, store, onStale, sync));
      observer.observe(document, OBSERVER_OPTIONS);
    }
    observeActiveShadowRoots(observer, store, observedRoots);
  };

  return {
    sync,
    disconnect() {
      observer?.disconnect();
      observer = null;
      observedRoots = new Set<ShadowRoot>();
    },
  };
};

const OBSERVER_OPTIONS: MutationObserverInit = {
  subtree: true,
  childList: true,
  characterData: true,
};

const observeActiveShadowRoots = (
  observer: MutationObserver,
  store: RecordStore,
  observedRoots: Set<ShadowRoot>,
): void => {
  for (const record of store.active) {
    const root = record.source.getRootNode();
    if (!(root instanceof ShadowRoot) || observedRoots.has(root)) continue;
    observer.observe(root, OBSERVER_OPTIONS);
    observedRoots.add(root);
  }
};

const inspectMutations = (
  mutations: readonly MutationRecord[],
  store: RecordStore,
  onStale: (record: ElementRecord) => void,
  sync: () => void,
): void => {
  removeDisconnected(store);
  const changed = new Set<ElementRecord>();
  for (const mutation of mutations) {
    if (isExtensionMutation(mutation)) continue;
    const record = nearestRecordContaining(store.active, mutation.target);
    if (record === null) continue;
    if (
      mutation.type === "characterData" &&
      mutation.target instanceof Text &&
      record.isViewMutation(mutation.target)
    ) {
      continue;
    }
    changed.add(record);
  }
  for (const record of changed) {
    record.restoreView("inspect");
    if (!record.source.isConnected) store.remove(record.source);
    else if ((record.source.textContent ?? "") !== record.sourceFingerprint) {
      store.markStale(record);
      onStale(record);
    }
  }
  sync();
};

const nearestRecordContaining = (
  records: ReadonlySet<ElementRecord>,
  node: Node,
): ElementRecord | null => {
  let nearest: ElementRecord | null = null;
  for (const record of records) {
    if (record.source !== node && !record.source.contains(node)) continue;
    if (nearest === null || nearest.source.contains(record.source)) nearest = record;
  }
  return nearest;
};

const removeDisconnected = (store: RecordStore): void => {
  for (const record of [...store.active]) {
    if (!record.source.isConnected) store.remove(record.source);
  }
};

const isExtensionMutation = (mutation: MutationRecord): boolean => {
  if (insideExtensionUi(mutation.target)) return true;
  if (mutation.type !== "childList") return false;
  const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
  return changedNodes.length > 0 && changedNodes.every(insideExtensionUi);
};

const insideExtensionUi = (node: Node): boolean => {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest(UI_SELECTOR) !== null && element?.closest(UI_SELECTOR) !== undefined;
};
