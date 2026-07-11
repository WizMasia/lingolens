# Offline Language Detection Fallback Design

## Goal

Reduce avoidable `Unknown` source-language results while preserving the extension's offline-only and privacy-first behavior. Distinguish a source that has not been inspected yet from a source that remains uncertain after all automatic detection stages.

## Detection States

Each element exposes one of four detection states:

- `not-detected`: no automatic detection attempt has completed;
- `detected`: a detector selected a normalized source language with sufficient evidence;
- `user-selected`: the user explicitly chose the source language;
- `needs-confirmation`: all automatic stages completed without sufficient evidence.

The floating menu displays these states as `Not detected yet`, the language and detection method, the language marked as user-selected, or `Needs confirmation`. It no longer labels an untouched element as `Unknown`.

## Offline Detection Pipeline

Automatic detection runs per element in this order:

1. Use a valid `lang` attribute on the element or its nearest content ancestor. The root `html` and `body` language defaults do not override per-element detection on multilingual pages.
2. Run Chrome's `LanguageDetector` on the element text. Accept the top normalized candidate when its confidence is at least `0.6`.
3. When the first result is uncertain, retry `LanguageDetector` with bounded nearby context. The retry input includes the element text and nearby visible text but never changes the text sent to the translator.
4. Run `chrome.i18n.detectLanguage()` on the same bounded context. Ignore `und`. Accept the top normalized language when Chrome reports the result as reliable. For an unreliable result, accept it only when its percentage is at least `80` and it agrees with a candidate returned by `LanguageDetector`.
5. Apply deterministic Unicode-script inference only for scripts that identify a supported language without guessing: Hangul to Korean, Hiragana or Katakana to Japanese, and the Arabic script to Arabic. Latin, Cyrillic, and Han-only text remain unresolved because each can represent multiple languages.
6. Return `needs-confirmation` and keep the existing per-element source-language selector available.

All stages execute locally. The pipeline does not call a remote service, load remote code, or send page text outside Chrome.

## Gemini Nano Decision

Gemini Nano through the Prompt API is not part of the automatic MVP fallback. It requires a substantially larger separately managed model, stricter device requirements, and currently supports a narrower declared language set than the translation extension needs. Free-form output also requires validation and is less deterministic than the dedicated detectors.

The architecture may add Gemini Nano later as an opt-in experimental detector, but absence of the Prompt API or its model must never reduce the baseline detection behavior defined above.

## Components and Data Flow

- The Chromium adapter exposes two detection methods: the existing `LanguageDetector` candidates and a typed wrapper around `chrome.i18n.detectLanguage()`.
- The translation engine owns ordering, thresholds, normalization, agreement checks, and script inference.
- A successful translation record stores the chosen source language plus its provenance: `lang`, `language-detector`, `context-detector`, `chrome-i18n`, `script`, or `user`.
- The floating menu reads the current detection state and provenance directly from the element record. Opening the menu may request detection for an untouched element so the display can move from `not-detected` to a result without translating it.
- Detection and translation caches remain separate. A detected source can be reused for the same unchanged element even when the user restores its translated text.

## Error Handling

Failure or unavailability of the secondary `chrome.i18n` detector does not fail translation immediately; the pipeline continues to script inference and manual confirmation. Unsupported or malformed detector language codes are ignored. An element is never translated using a guessed source when the evidence rules do not pass.

If the user chooses a source language, that override wins for the next translation attempt and is shown as user-selected. Returning the selector to automatic mode clears the override and reruns the pipeline.

## Verification

- Unit tests cover confidence boundaries, context retry, CLD reliability, candidate agreement, `und`, language normalization, script inference, and detector failures.
- Controller and menu tests distinguish `not-detected` from `needs-confirmation`, show provenance after success, and confirm manual selection wins.
- Runtime acceptance uses the installed extension on long English text, ambiguous short Latin text, Hangul, Japanese kana, Arabic text, and an unresolved value such as a proper name.
- Runtime acceptance confirms that detection and translation continue after the network is disabled once Chrome's required models are downloaded.
