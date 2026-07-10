# Local Page Translator

Local Page Translator is a Chrome extension that translates ordinary web-page text with Chrome's on-device Language Detector and Translator APIs. Page text is not sent by this extension to a cloud translation service.

## Requirements

- Chrome 138 or newer on desktop.
- A device and Chrome installation eligible for the built-in AI APIs.
- An unmetered connection for the first download of the language detector or a language-pair model. After the required models are present, translation can run offline.

The extension does not support Chrome mobile, browser-internal pages, the Chrome Web Store, PDF viewer internals, cross-origin iframe contents, images, video subtitles, code blocks, or editable fields.

## Build and install

```bash
bun install
bun test
bun run check
bun run build
```

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select the generated `dist` directory.
4. Pin **Local Page Translator** if you want the page controls always visible.

## Use

- Open the toolbar popup and select **페이지 전체 번역** to translate the current page.
- Select **원문 복원** to remove every translation created by the extension.
- By default, press `Ctrl` while text is selected or while the pointer is over a text element to translate that element.
- Press the trigger again on an already translated element to restore its original text. Press `Alt` plus the trigger to select explicit source and target languages; the floating menu also shows the language detected for that element.
- Open **설정** to choose inline or hover replacement display, a fixed source or automatic per-element detection, a browser-default or fixed target, and a custom trigger.

Automatic detection is less reliable for single words. The extension uses an explicit `lang` attribute and nearby text as hints; when confidence is still low, choose the source language from the element menu.

## Privacy and permissions

The extension requests access to HTTP and HTTPS pages because the configurable element trigger must work before the toolbar is clicked. It also requests `storage` to synchronize settings. It requests no translation-service host permission, injects no remote code, and includes no analytics or telemetry.

Chrome manages the local detector and translation models. Use `chrome://on-device-internals` to inspect on-device model status when a model does not download or initialize.

## Acceptance fixture

Serve the repository so Chrome treats the fixture as an ordinary page:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173/tests/fixtures/mixed-language.html`. The page contains mixed languages, RTL text, nested markup, excluded editable/code content, source mutation, and appended content for manual verification.

## Troubleshooting

- **Unsupported page:** navigate to an ordinary `http://` or `https://` page; Chrome blocks content scripts on protected pages.
- **Model unavailable:** update Chrome, confirm hardware eligibility in `chrome://on-device-internals`, and allow the first model download on an unmetered connection.
- **Short text asks for a language:** choose an explicit source language from the translated element's language control.
- **A site consumes the trigger:** select another combination in settings or use the popup's full-page action.
