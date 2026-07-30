# Changelog

All notable changes to LingoLens are documented here.

## Unreleased

- Add an optional text-PDF viewer with paragraph-level hover and keyboard translation overlays.
- Keep page navigation, zoom, fit, search, rotation, download, and print available in the PDF surface.
- Explicitly defer OCR for scanned documents, image-only PDFs, and web-page images.

## 0.1.2

- Translate the browser tab title together with readable page content.
- Restore the latest page-owned title when translation stops or the source title changes.
- Preserve site updates by releasing translated-title ownership when the page changes the title.

## 0.1.1

- Preserve inline code-like literals in their original order and spacing during translation.
- Keep inline emphasis and link text translated without removing their source markup.
- Limit hover and shortcut targets to readable units instead of multi-paragraph containers.
- Exclude hidden and unsafe inline literal content from translated output.

## 0.1.0

- Added public-facing user, license, privacy, security, contribution, conduct, and release-readiness documentation.
- Branded the extension as LingoLens.
- Added experimental YouTube Live Chat translation with YouTube-frame routing, hover-only rendering, dynamic-message observation, and MV3 restart/race handling.
- Hardened experimental Nano chat-language assistance: it is restricted to normal YouTube chat messages, requires a successful explicit preparation in the current extension session, validates Translator-pair availability, and clears its offscreen session on restoration and navigation.
- Nano installed-Chrome feasibility remains a pending manual release gate; it is not yet a public availability claim.

- Initial local page translation release.
