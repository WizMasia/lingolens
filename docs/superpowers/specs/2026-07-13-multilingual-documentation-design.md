# Multilingual Documentation Design

## Goal

Make LingoLens's public documentation readable in English and Korean from the
repository itself, without introducing a documentation-site dependency. Leave a
clear path for future locales.

## Scope

Translate public user, contributor, and release documents. Do not translate
internal design plans or verification records.

The initial supported locales are English (`en`) and Korean (`ko`). English
remains the source-language version of every document.

## File convention

Use the existing root-document pattern:

- English: `README.md`, `PRIVACY.md`
- Korean: `README.ko.md`, `PRIVACY.ko.md`

For files in `docs/`, append the locale before the extension in the same way:
`docs/public-release-checklist.ko.md`. A future locale follows the same
pattern, for example `README.ja.md`.

## Reader experience

Every translated public document begins with an inline language switcher that
links to its English and Korean counterparts. The two README files link to one
another at the same prominent location.

Add `docs/README.md` as the public documentation hub. It lists each public
document once with English and Korean links, so readers can select a language
before opening a document. The root README files also link to this hub.

## Documents to cover

The implementation adds Korean counterparts for these public root documents:

- `CHANGELOG.md`
- `CODE_OF_CONDUCT.md`
- `CONTRIBUTING.md`
- `PRIVACY.md`
- `SECURITY.md`
- `THIRD_PARTY_NOTICES.md`

It also adds a Korean counterpart for `docs/public-release-checklist.md` and
updates the existing `docs/install-unpacked.ko.md` so that it participates in
the same language-switching pattern. `README.md` and `README.ko.md` are updated
to use a consistent switcher and to link to the documentation hub.

## Translation and maintenance rules

- Preserve code blocks, commands, filenames, URLs, version numbers, and legal
  names verbatim unless a target-language convention requires otherwise.
- Keep links local and relative, pointing to the equivalent locale when it
  exists.
- When an English public document changes, update its Korean counterpart in the
  same pull request or clearly label it as awaiting translation.
- A new locale is added only when it includes the hub entry and language
  switcher links for the public documents it translates.

## Validation

Review the rendered Markdown links in GitHub or a Markdown preview and check:

1. Each language switcher reaches the correct counterpart.
2. The documentation hub has no broken links.
3. Commands and technical identifiers are unchanged from their English source.
4. Korean links in the root README lead to Korean documents where available.
