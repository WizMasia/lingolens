import { TranslationError } from "../content/ai-engine";
import type { PdfParagraphTarget, PdfParagraphView } from "./paragraph-interaction";

export function createPdfOverlay(
  document: Document,
): PdfParagraphView & Readonly<{ destroy(): void }> {
  const overlay = document.createElement("aside");
  overlay.className = "lt-pdf-translation-overlay";
  overlay.hidden = true;
  overlay.setAttribute("aria-live", "polite");
  document.body.append(overlay);
  let active: PdfParagraphTarget | undefined;

  const position = (target: PdfParagraphTarget): void => {
    const rects = target.spans.flatMap((span) => [...span.getClientRects()]);
    if (rects.length === 0) return;
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.right));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    const margin = 8;
    const width = Math.min(Math.max(right - left, 240), 640, window.innerWidth - margin * 2);
    const x = Math.min(Math.max(left, margin), window.innerWidth - width - margin);
    overlay.style.inlineSize = `${width}px`;
    overlay.style.insetInlineStart = `${x}px`;
    overlay.style.insetBlockStart = `${margin}px`;
    overlay.style.minBlockSize = `${Math.min(Math.max(bottom - top, 48), window.innerHeight - margin * 2)}px`;
    const height = overlay.getBoundingClientRect().height;
    const y =
      top + height <= window.innerHeight - margin
        ? Math.max(top, margin)
        : Math.max(margin, bottom - height);
    overlay.style.insetBlockStart = `${y}px`;
  };
  const show = (target: PdfParagraphTarget, text: string): void => {
    active = target;
    overlay.textContent = text;
    overlay.hidden = false;
    position(target);
  };

  return {
    showLoading(target) {
      show(target, "문단을 번역하는 중입니다…");
      overlay.removeAttribute("lang");
      overlay.removeAttribute("dir");
    },
    showResult(target, result) {
      if (result.kind === "translated") {
        show(target, result.text);
        overlay.lang = result.targetLanguage;
        overlay.dir = isRtl(result.targetLanguage) ? "rtl" : "ltr";
        return;
      }
      show(
        target,
        result.kind === "skipped"
          ? "원문과 도착 언어가 같아 번역하지 않았습니다."
          : "입력 언어를 확인하지 못했습니다. 설정에서 입력 언어를 지정해 주세요.",
      );
    },
    showError(target, error) {
      show(target, errorMessage(error));
    },
    close() {
      active = undefined;
      overlay.hidden = true;
      overlay.textContent = "";
    },
    refresh(target) {
      if (active?.id === target.id && !overlay.hidden) position(target);
    },
    destroy() {
      active = undefined;
      overlay.remove();
    },
  };
}

const isRtl = (language: string): boolean => /^(ar|fa|he|ur)(-|$)/u.test(language);

const errorMessage = (error: unknown): string => {
  if (error instanceof TranslationError) {
    switch (error.code) {
      case "api-unavailable":
        return "이 Chrome에서는 기기 내 번역 API를 사용할 수 없습니다.";
      case "pair-unavailable":
        return "이 언어 조합의 로컬 번역 모델을 사용할 수 없습니다.";
      case "translation-failed":
        return "문단을 번역하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    }
  }
  return "문단을 번역하지 못했습니다.";
};
