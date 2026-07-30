# LingoLens

LingoLens is a Chrome extension for translating ordinary HTTP and HTTPS web-page text and text-based PDFs with Chrome-managed, on-device language detection and translation models. It keeps translation work in the browser rather than sending page text to a LingoLens translation service.

**Why LingoLens?** “Lingo” evokes language. It also deliberately echoes *ringo* (りんご), the Japanese word for apple, matching the apple-frame icon. “Lingo” itself does not mean apple in Japanese.

한국어 빠른 사용법은 [README.ko.md](README.ko.md)에서 볼 수 있습니다.

## Requirements

- Chrome 138 or later on desktop.
- A Chrome installation and device for which Chrome makes the Language Detector and Translator APIs available.
- Network access when Chrome needs to acquire a detector or language-pair model for the first time. Chrome manages availability and acquisition; LingoLens cannot make an unavailable model or pair available.

After Chrome has acquired a needed model, translation may work without a network connection. This is not a promise that every device, language pair, or browser installation is available offline.

## Install an unpacked build

```bash
bun install
bun test
bun run check
bun run build
```

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose the generated `dist` directory.
4. Pin **LingoLens** if you want the page controls readily available.

## Use LingoLens

- **Full page:** open the toolbar popup and choose **페이지 전체 번역** to translate eligible page text and the browser-tab title. Use **원문 복원** to remove translations made by LingoLens.
- **An element:** by default, press `Ctrl` while text is selected or while the pointer is over a text element. Use the same trigger again to restore that element.
- **Retranslation and language menu:** press the language-menu trigger (`Ctrl + Shift` by default) over an eligible element. The floating menu lets you choose source and target languages, shows the detected source, and offers **Translate again** or restore.
- **Inline or hover display:** open **설정** and choose **원문 아래 표시** to add a translation after the source text, or **호버 시 교체** to show the translation while the element is hovered or focused.
- **A text PDF:** enable **PDF hover translation** in Settings, then use **현재 PDF 열기** or **내 컴퓨터에서 열기** in the popup. LingoLens opens its own lightweight viewer; hover or focus a detected paragraph to show its translation. The viewer retains page navigation, zoom, fit, search, rotation, download, and print controls.
- **Language and shortcut settings:** in **번역 설정**, choose **입력 언어**, **도착 언어**, **번역 토글 키**, and **언어 메뉴 키**, then select **설정 저장**.

Automatic detection can be uncertain for short text. If LingoLens asks for a language or chooses poorly, open the element language menu and select an explicit source language.

LingoLens does not inject into Chrome's built-in PDF viewer. It translates extractable text only after a PDF is opened in the LingoLens viewer. The current version does not use OCR, so scanned documents, image-only PDFs, and text embedded in web-page images are not translated.

LingoLens does not run on other browser-internal pages, the Chrome Web Store, images, video subtitles, code blocks, editable fields, or ordinary cross-origin iframe content. The only iframe exception is the dedicated YouTube Live Chat path below.

## YouTube Live Chat status

LingoLens includes an experimental, YouTube-only Live Chat MVP. When you use **페이지 전체 번역** on a YouTube watch page or its `/live_chat` pop-out, LingoLens can observe eligible ordinary chat-message text in YouTube's Live Chat frame and translate it with the same on-device model. Live Chat always uses temporary hover replacement, even if the page display setting is inline; it does not add translation cards to the chat layout.

Only YouTube `live_chat` frames are handled. The extension does not claim support for other live-chat services, chat composer text, paid/membership UI, or non-message page content. This experimental path still requires final manual acceptance on a real public chat before a public release.

### Experimental live-chat language assistance

Experimental live-chat language assistance is opt-in and disabled by default. It is an on-device classifier, not a translator: it can help choose a likely source language for eligible normal YouTube Live Chat messages, while LingoLens still uses Chrome's translation model for translation. Enable **Gemini Nano language assistance** in Settings, save the setting, and explicitly click Prepare before it can be used in the current extension session; Chrome may download its Chrome-managed model during preparation.

The preparation authorization is intentionally session-only. After the extension worker restarts, click Prepare again before Nano assistance can run; LingoLens never starts a new model download automatically.

Nano prompts stay inside Chrome. The assistance is experimental, can be unavailable or inaccurate, and does not guarantee romanized Hindi. Use the configured language-menu shortcut to choose Hindi or another Chrome Translator-supported source language for an author when automatic assistance is uncertain. Romanized Urdu cannot be recovered while Chrome Translator has no supported Urdu pair.

## Model and language-pair limits

Chrome decides whether its on-device AI APIs and a requested source-to-target pair are available, downloadable, downloading, or unavailable. A supported Chrome version alone does not guarantee a model or pair. If a model cannot initialize, update Chrome, check device eligibility, allow Chrome to complete any required acquisition, and inspect `chrome://on-device-internals` where available.

## Release and project documents

- [License](LICENSE)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [Privacy policy](PRIVACY.md)
- [Security policy](SECURITY.md)
- [Contributing guide](CONTRIBUTING.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Changelog](CHANGELOG.md)
- [Public release checklist](docs/public-release-checklist.md)
