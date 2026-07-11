# LingoLens release preparation and live-chat support

## Purpose

Prepare the private GitHub project that will eventually become the public LingoLens browser extension, while adding a narrowly scoped, reliable live-chat translation capability.

## Decisions

- Product name: **LingoLens**.
- Repository: private `WizMasia/lingolens`, with public release as the eventual goal.
- Root license: Apache-2.0.
- Icon: an original, generic unbitten apple-shaped glasses frame (the selected Apple Frames direction). It must not reproduce Apple Inc.'s logo, branding, or a bite-mark silhouette.
- Name note: “Lingo” refers to language; its sound also intentionally echoes the Japanese word for apple, `ringo` (`りんご`). This is a light wordplay, not a claim that “lingo” means apple in Japanese.
- Live-chat MVP: YouTube Live Chat only. Other real-time chat services are future adapters, not implied support.

## Product and assets

1. Rename the extension and package-facing metadata from Local Page Translator to LingoLens.
2. Create the icon as an editable source mark, then produce Chrome PNG sizes: 16, 32, 48, and 128 pixels.
3. Keep the existing calm paper, ink, and moss visual language. The icon must remain legible at 16 pixels.
4. Preserve the default hover display mode. It replaces text only while the pointer is over the translated element and inserts no element into the host page.

## Repository and documentation

The first private repository contains the source, tests, and generated unpacked-extension instructions. It does not publish to the Chrome Web Store.

Required documents:

- `README.md`: product overview, requirements, installation, quick use, limitations, privacy summary, and the `lingo`/`ringo` naming note.
- `README.ko.md`: Korean quick manual.
- `LICENSE`: Apache-2.0 text.
- `THIRD_PARTY_NOTICES.md`: build and test dependencies with license metadata.
- `PRIVACY.md`: no LingoLens server, analytics, or account; translation inference uses Chrome's on-device AI APIs, whose model availability and initial acquisition are controlled by Chrome.
- `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and GitHub issue/PR templates for the later public project.
- `CHANGELOG.md` and a public-release checklist.

LingoLens-authored source and original icon assets use Apache-2.0. The built extension currently bundles LingoLens source only; its listed packages are build and test tools. Their separate licenses are disclosed for transparency.

Before a public release, the project must complete a jurisdiction-appropriate trademark review for “LingoLens” and a fresh Chrome Web Store policy review. This document is not legal clearance.

## YouTube Live Chat behavior

When the user starts full-page translation from a YouTube watch page or standalone live-chat page:

1. Translate eligible messages already visible in the chat.
2. Start observing the YouTube chat message list.
3. Queue later eligible message elements once, with bounded serial processing so model creation and page responsiveness remain stable.
4. Skip chat composition controls, buttons, member/payment controls, hidden content, extension UI, and duplicate/recycled message elements.
5. In live chat, always use the hover view even if the global display setting is inline. This protects chat layout from inserted sibling elements.
6. When the user restores the page, restore translated views and stop the incoming-message observer and queue.

The implementation must use a YouTube-specific adapter and must not place a permanent generic whole-document observer on ordinary web pages. The adapter is active only in the YouTube Live Chat document/frame.

## Frame delivery

YouTube may render live chat in a separate frame. Content scripts must therefore be available in relevant frames. Rather than adding a broad frame-enumeration permission, each injected content script registers a runtime port with the service worker. The service worker forwards a start/restore live-chat command only to the registered YouTube Live Chat frame in the active tab.

The normal top-level page translation behavior remains unchanged on non-YouTube pages.

## Verification and release gates

Automated coverage must include:

- incoming-message discovery, deduplication, queueing, stop/restore, and hover-only rendering;
- a frame-command routing unit test;
- existing translation, language-detection, and page-structure preservation behavior.

Manual Chrome verification must cover a real YouTube Live Chat with newly arriving messages, restore behavior, repeated/virtualized message nodes, input exclusion, no page-layout shift, and runtime error/console review. The existing native Chrome AI language-pair limitation must be recorded when a pair cannot be provisioned by the browser.

The private GitHub repository is created and pushed only after the implementation passes its tests, build, and Chrome manual verification.
