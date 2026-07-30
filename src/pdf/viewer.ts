import { PasswordException } from "pdfjs-dist";
import {
  createTranslationEngine,
  type TranslationEngine,
  TranslationError,
} from "../content/ai-engine";
import { createChromiumAiAdapter } from "../content/chromium-ai-adapter";
import { parseSettings, type Settings } from "../shared/settings";
import { createPdfOverlay } from "./overlay";
import {
  createPdfParagraphInteraction,
  type PdfParagraphInteraction,
  type PdfParagraphTarget,
} from "./paragraph-interaction";
import { createPdfViewerSession, type PdfViewerSession } from "./pdfjs-viewer";
import { loadLocalPdf, loadRemotePdf, type PdfBytes, PdfSourceError, remotePdfUrl } from "./source";

const STORAGE_KEY = "settings";
const OCR_NOTICE =
  "텍스트 PDF만 번역할 수 있습니다. 현재 버전은 스캔 문서와 이미지 PDF의 OCR을 지원하지 않습니다.";
const EMPTY_TEXT =
  "번역할 수 있는 텍스트를 찾지 못했습니다. 이미지로 구성된 PDF일 수 있으며, 현재 버전에서는 OCR을 지원하지 않습니다.";
const DISABLED = "PDF 호버 번역이 설정에서 꺼져 있습니다.";

export async function startPdfViewer(document: Document): Promise<void> {
  const fileInput = required(document, "pdf-file", HTMLInputElement);
  const status = required(document, "pdf-status", HTMLParagraphElement);
  const scope = required(document, "pdf-scope", HTMLParagraphElement);
  const openOptions = required(document, "open-options", HTMLButtonElement);
  let settings = await loadSettings();
  let engine: TranslationEngine | undefined;
  let overlay = createPdfOverlay(document);
  let interaction: PdfParagraphInteraction | undefined;
  let session: PdfViewerSession | undefined;
  let sourceGeneration = 0;

  const createEngine = (): TranslationEngine =>
    createTranslationEngine(
      createChromiumAiAdapter((progress) => {
        status.textContent = `로컬 번역 모델 준비 중: ${Math.round(progress.loaded * 100)}%`;
      }),
    );
  const ensureEngine = (): TranslationEngine => {
    if (engine === undefined) engine = createEngine();
    return engine;
  };
  const translate = (target: PdfParagraphTarget) =>
    ensureEngine().translate({
      text: target.text,
      source: settings.source,
      target:
        settings.target.kind === "fixed"
          ? settings.target.language
          : settings.target.resolvedLanguage,
    });
  const createInteraction = (): PdfParagraphInteraction => {
    const next = createPdfParagraphInteraction(document, translate, overlay);
    next.setEnabled(settings.pdfTranslationEnabled);
    return next;
  };
  const applySettings = (next: Settings): void => {
    settings = next;
    scope.textContent = next.pdfTranslationEnabled ? OCR_NOTICE : DISABLED;
    interaction?.setEnabled(next.pdfTranslationEnabled);
    if (!next.pdfTranslationEnabled) {
      engine?.destroy();
      engine = undefined;
      status.textContent = DISABLED;
    } else if (session !== undefined) {
      status.textContent = `${session.document.numPages}페이지 · 문단을 가리키면 번역합니다.`;
    }
  };
  applySettings(settings);

  const openSource = async (source: PdfBytes): Promise<void> => {
    sourceGeneration += 1;
    const generation = sourceGeneration;
    status.textContent = `${source.name} 여는 중…`;
    await session?.destroy();
    if (generation !== sourceGeneration) return;
    interaction?.destroy();
    overlay.destroy();
    overlay = createPdfOverlay(document);
    interaction = createInteraction();
    required(document, "viewer", HTMLDivElement).replaceChildren();
    try {
      const next = await createPdfViewerSession(document, source, {
        onParagraphs(_pageNumber, layer, targets) {
          if (generation !== sourceGeneration) return;
          interaction?.registerPage(layer, targets);
          if (settings.pdfTranslationEnabled) {
            status.textContent = `${source.name} · 문단을 가리키면 번역합니다.`;
          }
        },
        onEmptyPage(pageNumber) {
          if (generation === sourceGeneration) {
            status.textContent = `${pageNumber}페이지: ${EMPTY_TEXT}`;
          }
        },
        onStatus(message) {
          if (generation === sourceGeneration) status.textContent = message;
        },
        onGeometryChange() {
          interaction?.refresh();
        },
      });
      if (generation !== sourceGeneration) {
        await next.destroy();
        return;
      }
      session = next;
      document.title = `${source.name} · LingoLens PDF`;
      if (!settings.pdfTranslationEnabled) status.textContent = DISABLED;
    } catch (error: unknown) {
      if (generation === sourceGeneration) status.textContent = openError(error);
    }
  };

  fileInput.addEventListener("change", () => {
    const [file] = [...(fileInput.files ?? [])];
    if (file === undefined) return;
    void loadLocalPdf(file).then(openSource, (error: unknown) => {
      status.textContent = openError(error);
    });
    fileInput.value = "";
  });
  openOptions.addEventListener("click", () => void chrome.runtime.openOptionsPage());
  const storageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName,
  ): void => {
    if (area !== "sync" || !(STORAGE_KEY in changes)) return;
    applySettings(parseSettings(changes[STORAGE_KEY]?.newValue, chrome.i18n.getUILanguage()));
  };
  chrome.storage.onChanged.addListener(storageChanged);
  window.addEventListener(
    "beforeunload",
    () => {
      chrome.storage.onChanged.removeListener(storageChanged);
      interaction?.destroy();
      overlay.destroy();
      engine?.destroy();
      void session?.destroy();
    },
    { once: true },
  );

  const remote = remotePdfUrl(location.search);
  if (remote !== undefined) {
    status.textContent = "원격 PDF를 불러오는 중…";
    void loadRemotePdf(remote).then(openSource, (error: unknown) => {
      status.textContent = openError(error);
    });
  } else {
    fileInput.click();
  }
}

const loadSettings = async (): Promise<Settings> => {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  return parseSettings(stored[STORAGE_KEY], chrome.i18n.getUILanguage());
};

const openError = (error: unknown): string => {
  if (error instanceof PasswordException || errorName(error) === "PasswordException") {
    return "암호로 보호된 PDF는 현재 버전에서 지원하지 않습니다.";
  }
  if (error instanceof PdfSourceError) {
    return error.code === "PDF_REMOTE_FETCH"
      ? "보호된 PDF를 불러오지 못했습니다. 파일을 내려받아 내 컴퓨터에서 열어 주세요."
      : "PDF 파일을 확인할 수 없습니다. 올바른 텍스트 PDF를 선택해 주세요.";
  }
  if (error instanceof TranslationError) return "기기 내 번역 기능을 준비하지 못했습니다.";
  return "PDF 문서를 열지 못했습니다. 파일이 손상되었을 수 있습니다.";
};

const errorName = (value: unknown): string | undefined =>
  typeof value === "object" && value !== null && "name" in value && typeof value.name === "string"
    ? value.name
    : undefined;

const required = <ElementType extends Element>(
  document: Document,
  id: string,
  type: { new (): ElementType },
): ElementType => {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new TypeError(`Missing PDF viewer element: ${id}`);
  return element;
};

if (typeof chrome !== "undefined") {
  void startPdfViewer(document);
}
