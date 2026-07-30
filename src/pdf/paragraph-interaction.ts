import type { TranslationResult } from "../content/ai-engine";

export type PdfParagraphTarget = Readonly<{
  id: string;
  text: string;
  pageNumber: number;
  spans: readonly HTMLElement[];
}>;

export type PdfParagraphView = Readonly<{
  showLoading(target: PdfParagraphTarget): void;
  showResult(target: PdfParagraphTarget, result: TranslationResult): void;
  showError(target: PdfParagraphTarget, error: unknown): void;
  close(): void;
  refresh(target: PdfParagraphTarget): void;
}>;

export type PdfParagraphInteraction = Readonly<{
  registerPage(page: HTMLElement, targets: readonly PdfParagraphTarget[]): void;
  setEnabled(enabled: boolean): void;
  refresh(): void;
  destroy(): void;
}>;

export function createPdfParagraphInteraction(
  document: Document,
  translate: (target: PdfParagraphTarget) => Promise<TranslationResult>,
  view: PdfParagraphView,
): PdfParagraphInteraction {
  const targetsByElement = new WeakMap<Element, PdfParagraphTarget>();
  const removers: (() => void)[] = [];
  const proxies: HTMLButtonElement[] = [];
  let enabled = true;
  let active: PdfParagraphTarget | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;

  const close = (): void => {
    const hadActiveTarget = active !== undefined || timer !== undefined;
    generation += 1;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    active = undefined;
    if (hadActiveTarget) view.close();
  };
  const activate = (target: PdfParagraphTarget): void => {
    if (!enabled || active?.id === target.id) return;
    close();
    active = target;
    const requestGeneration = generation;
    timer = setTimeout(() => {
      timer = undefined;
      if (!enabled || active?.id !== target.id || requestGeneration !== generation) return;
      view.showLoading(target);
      void translate(target).then(
        (result) => {
          if (enabled && active?.id === target.id && requestGeneration === generation) {
            view.showResult(target, result);
          }
        },
        (error: unknown) => {
          if (enabled && active?.id === target.id && requestGeneration === generation) {
            view.showError(target, error);
          }
        },
      );
    }, 200);
  };

  const registerPage = (page: HTMLElement, targets: readonly PdfParagraphTarget[]): void => {
    const pageTargets = [...targets];
    for (const target of pageTargets) {
      for (const span of target.spans) targetsByElement.set(span, target);
      const proxy = document.createElement("button");
      proxy.type = "button";
      proxy.className = "lt-pdf-focus-proxy";
      proxy.tabIndex = proxies.length === 0 ? 0 : -1;
      proxy.setAttribute("aria-label", `${target.pageNumber}페이지 문단 번역: ${target.text}`);
      targetsByElement.set(proxy, target);
      page.append(proxy);
      proxies.push(proxy);
    }

    const pointerOver = (event: Event): void => {
      const target =
        event.target instanceof Element ? targetsByElement.get(event.target) : undefined;
      if (target !== undefined) activate(target);
    };
    const pointerOut = (event: Event): void => {
      const pointer = event as PointerEvent;
      const next =
        pointer.relatedTarget instanceof Element
          ? targetsByElement.get(pointer.relatedTarget)
          : undefined;
      if (next?.id !== active?.id) close();
    };
    const focusIn = (event: FocusEvent): void => {
      const target =
        event.target instanceof Element ? targetsByElement.get(event.target) : undefined;
      if (target !== undefined) activate(target);
    };
    const focusOut = (event: FocusEvent): void => {
      const next =
        event.relatedTarget instanceof Element
          ? targetsByElement.get(event.relatedTarget)
          : undefined;
      if (next?.id !== active?.id) close();
    };
    const keyDown = (event: KeyboardEvent): void => {
      const index = event.target instanceof HTMLButtonElement ? proxies.indexOf(event.target) : -1;
      if (index < 0) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        page.focus();
        return;
      }
      const offset = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (offset === 0) return;
      event.preventDefault();
      const next = Math.min(Math.max(index + offset, 0), proxies.length - 1);
      const currentProxy = proxies[index];
      const nextProxy = proxies[next];
      if (currentProxy === undefined || nextProxy === undefined) return;
      currentProxy.tabIndex = -1;
      nextProxy.tabIndex = 0;
      nextProxy.focus();
    };

    page.addEventListener("pointerover", pointerOver);
    page.addEventListener("pointerout", pointerOut);
    page.addEventListener("focusin", focusIn);
    page.addEventListener("focusout", focusOut);
    page.addEventListener("keydown", keyDown);
    removers.push(() => {
      page.removeEventListener("pointerover", pointerOver);
      page.removeEventListener("pointerout", pointerOut);
      page.removeEventListener("focusin", focusIn);
      page.removeEventListener("focusout", focusOut);
      page.removeEventListener("keydown", keyDown);
    });
  };

  return {
    registerPage,
    setEnabled(next) {
      enabled = next;
      if (!next) close();
    },
    refresh() {
      if (active !== undefined) view.refresh(active);
    },
    destroy() {
      close();
      for (const remove of removers) remove();
      for (const proxy of proxies) proxy.remove();
      removers.length = 0;
      proxies.length = 0;
    },
  };
}
