# Live Chat Language Recovery Design

## Purpose

Improve LingoLens's experimental YouTube Live Chat translation when the normal on-device language detection pipeline cannot confidently determine a message's source language. The feature keeps all text on the device and must not alter chat layout.

## Scope and constraints

- Keep the existing automatic pipeline first: element `lang`, `LanguageDetector`, contextual detector retry, `chrome.i18n.detectLanguage`, then deterministic script inference.
- Use Gemini Nano only after that pipeline returns `needs-confirmation`.
- Gemini Nano is an opt-in experimental aid, disabled by default. Enabling it must show its separate model requirement and never download a model without an explicit user gesture.
- No page text, author identity, result, or telemetry leaves Chrome. Session-only state is removed on page navigation, restoration, and tab close.
- Continue to render translated live-chat text only while hovered; do not add inline cards or page-layout elements.
- Do not claim that Gemini Nano reliably identifies every language. Chrome currently documents expected Prompt API text inputs only for English, Japanese, Spanish, German, and French. Romanized Hindi, Urdu, and other unsupported languages need manual recovery.
- Do not invoke the Prompt API from a page frame. All Nano requests run in an extension-owned document, so a host page's iframe Permissions Policy cannot grant or deny model access.

## User experience

### Options

Add an **Experimental live-chat language assistance** setting, disabled by default. Its explanatory copy states that it runs Gemini Nano locally after normal detection fails, requires a separately downloaded model on supported hardware, and cannot guarantee recognition of romanized or unsupported languages.

The setting exposes a preparation action in the options page. That explicit click checks `LanguageModel.availability()` and, when permitted, creates a short-lived session in that user-activated extension page so Chrome can download the model. The UI reports unsupported, downloadable, downloading, and ready states. Automatic chat processing never initiates a Gemini Nano download.

### Automatic recovery

For a normal YouTube Live Chat text message:

1. Run the existing automatic detector unchanged.
2. If it returns a source language, translate with Chrome's Translator API unchanged.
3. If it returns `needs-confirmation`, and the experimental option is enabled with a prepared Nano model, send one structured source-language request from the bounded message text plus safe nearby chat context to an extension-owned offscreen document.
4. Accept a result only when it is a normalized LingoLens-supported language and `Translator.availability(source, target)` is not unavailable. Persist the result only for the current message and mark its provenance `gemini-nano`.
5. If Nano is unavailable, declines, gives invalid structured output, returns low confidence, or identifies an unavailable translation pair, leave the message untranslated and expose the existing manual recovery flow.

Nano is never used to translate text. Chrome's dedicated Translator API remains the only translator.

### Manual per-author recovery

Add the existing fixed-position language menu to the live-chat frame for the configured **menu shortcut** only. It remains an overlay and does not inject a layout element.

When a user chooses a source language for a normal live-chat message:

- retranslate that message immediately;
- remember the selected source for the message author's stable channel ID for the current tab session;
- apply that source only to later messages by the same author;
- never apply it to other authors, other tabs, or a later navigation;
- allow the same menu to replace or clear the author choice.

This is the reliable recovery for mixed chats and for romanized languages outside Gemini Nano's documented support.

## Architecture

### New boundaries

- `nano-language-detector.ts`: typed adapter around `LanguageModel`; owns feature detection, availability interpretation, deterministic offscreen-session lifecycle, structured-output parsing, and confidence validation. It never mutates DOM or settings.
- `nano-offscreen.ts` and a minimal extension-owned HTML document: hold the active Prompt API session and serve typed detection requests from the background coordinator. This avoids page iframe Permissions Policy and keeps the model outside the Manifest V3 service worker, where the Prompt API is unavailable.
- `live-chat-language-memory.ts`: maps an author channel ID to a user-selected normalized language for one live-chat tab. It exposes `get`, `set`, `clear`, and `destroy`.
- `youtube-live-chat.ts`: extracts the stable author channel ID and passes a small typed source-preference override to its existing translation callback. It continues to queue only normal `yt-live-chat-text-message-renderer #message` nodes.

The content controller asks the background coordinator for a Nano result only when the experimental option is enabled and prepared. The background uses Chrome's `offscreen` permission to create the extension document on demand and forwards the typed request. If an offscreen session cannot be created without user activation even after preparation, the feature is reported unavailable and falls back to manual recovery. A user language choice has higher precedence than Nano and carries `user` provenance.

### Structured Nano result

Nano is requested in a supported prompt language and returns constrained JSON:

```json
{
  "language": "es",
  "confidence": 0.0
}
```

The runtime independently parses the JSON, normalizes `language` against LingoLens's language list, bounds `confidence` to 0–1, and requires a conservative threshold. Invalid, unsupported, or low-confidence output is equivalent to no result. The prompt contains only the current message plus at most 160 characters of nearby visible chat context; it instructs Nano not to translate or copy the text.

## Error handling and performance

- A missing Prompt API, unmet hardware requirements, unavailable Permissions Policy, or unavailable model causes a no-op fallback to manual recovery. It does not block normal chat translation.
- Download preparation is user-triggered and reports progress in extension UI. Failure leaves the setting enabled but the helper unavailable, with a clear retry action.
- A feasibility gate runs before the feature ships: the installed extension must successfully prepare Nano from the options page and complete one offscreen structured detection request. If Chrome rejects this extension-context flow, Nano assistance is not shipped; per-author manual recovery remains independently usable.
- The live-chat queue prioritizes newly received messages over pre-existing backlog, so a current message is not delayed behind historical chat entries. Translator calls remain serial because Chrome processes Translator API requests sequentially.
- Each Nano request is rate-limited to one in flight per chat tab. Detection results are cached by unchanged message text and are never shared outside the tab.

## Verification

- Unit tests cover Nano availability, structured-result parsing, confidence threshold, invalid language rejection, and no-op error paths.
- DOM tests cover a user-selected author language overriding automatic/Nano detection, author isolation, clear/reselect behavior, and zero inline cards.
- Queue tests verify that a newly added live message is serviced ahead of the historical backlog without parallel Translator calls.
- Manual Chrome acceptance checks: English, Japanese, Arabic, a Spanish message, an ambiguous short Latin message, a romanized Hindi/Urdu message with per-author manual selection, hover restoration, popup restoration, and disabled-network operation after model preparation.

## Non-goals

- Cloud language detection or cloud translation.
- A claim of universal Nano detection for romanized languages.
- Translation of pinned chat banners, paid messages, membership events, composer text, or arbitrary live-chat providers.
- Persisting author-language choices after navigation or across devices.
