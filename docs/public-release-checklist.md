# Public release checklist

Do not mark a release ready until every applicable item has been checked.

- [ ] Run the full test suite, type check, formatter, and production build.
- [ ] Manually test the unpacked extension in Chrome on ordinary HTTP and HTTPS pages.
- [ ] Confirm Chrome model and source-to-target language-pair availability on the release device.
- [ ] Review requested permissions and host access against the manifest and listing copy.
- [ ] Re-read the privacy copy for accuracy, including Chrome-managed first model acquisition.
- [ ] Confirm the public support route, including security-reporting guidance.
- [ ] Review LingoLens name and trademark usage before publishing.
- [ ] Review the current Chrome Web Store policies before submission.
- [ ] Inspect all icon sizes and the store icon for clarity and ownership.
- [ ] Prepare and review Chrome Web Store listing assets, screenshots, descriptions, and privacy disclosures.
- [ ] Manually verify the included YouTube Live Chat MVP on a public chat: start, incoming messages, hover-only rendering, restore, reload/reconnect, and no console errors. Do not imply support for other chat services.
- [ ] Complete the pending installed-Chrome Nano feasibility gate: explicitly prepare Nano in Options, verify one offscreen structured detection for a supported message, then verify restore/navigation/tab-close clear the Nano session without a new automatic download. Restart the extension worker and confirm Nano stays unavailable until the user explicitly prepares it again.
- [ ] Confirm release copy says manual per-author recovery is limited to Chrome Translator-supported languages; do not claim Romanized Urdu recovery while no Urdu pair is supported.
