# Privacy policy

## Summary

**No analytics.** LingoLens does not include analytics or telemetry.

**No LingoLens account.** You do not create or sign in to an account for LingoLens.

**No LingoLens server receives page text.** The extension does not operate a translation endpoint or send page text to one.

## What the extension accesses

LingoLens reads eligible text in HTTP and HTTPS pages only when it needs to translate or restore page content. It uses the `storage` permission to keep its settings in Chrome storage. During an enabled YouTube Live Chat session, it also keeps one session-only boolean keyed to the tab identifier so a Chrome MV3 worker restart can reconnect that same chat; it does not store chat text. The flag is cleared when translation is restored, the tab starts navigating, the tab closes, or the browser session ends. It asks for HTTP and HTTPS page access so its page and element controls can work on those pages.

The extension does not request a separate translation-service host permission, load remote code, or include an analytics service. Its all-frame content-script setting loads the extension runtime in matching HTTP and HTTPS frames so a YouTube `/live_chat` frame can receive its commands. Ordinary child frames do not install page translation controls or have their text translated; only the YouTube `/live_chat` path observes eligible live-message text.

## Chrome-managed models

Chrome itself determines whether on-device language detection and translation models are available and manages the first acquisition of a required model or language pair. That Chrome-managed process may require a network connection. LingoLens does not control model availability or acquisition and does not promise that every device or pair works offline.

Optional experimental Live Chat language assistance can pass bounded chat-message text and nearby context only to the Chrome-resident Nano model. Nano prompts stay inside Chrome: this bounded text and context are not transmitted outside Chrome or retained after the tab session. User-triggered preparation may download a Chrome-managed model; LingoLens does not control that download.

## Changes

Material changes to this policy will be recorded in [CHANGELOG.md](CHANGELOG.md).
