# LingoLens Brand and Private Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Turn the existing extension into the LingoLens-branded, documented, Apache-2.0 private repository ready for verified beta use and later public release.

**Architecture:** Keep the extension runtime dependency-free. Store an original SVG source mark beside checked-in Chrome PNG outputs, validate product metadata and PNG dimensions with Vitest, and retain the build script's responsibility of copying static assets. Treat privacy, licensing, contributor, and future-public-release information as first-class repository documents.

**Tech Stack:** TypeScript 5.9, Vitest 4, Bun, esbuild, Chrome MV3, SVG, PNG, GitHub CLI.

## Global Constraints

- Product name is exactly LingoLens; package and private repository slug are lingolens.
- LingoLens-authored source and original icon assets use Apache-2.0.
- Add no runtime dependency, cloud service, telemetry, remote code, account system, or Chrome Web Store publication.
- The mark is a generic whole apple-shaped glasses frame: no bite mark, Apple Inc. branding, or affiliation claim.
- Lingo is a language word. Its resemblance to Japanese ringo (りんご, apple) is intentional sound wordplay only.
- Preserve four Chrome PNG dimensions: 16, 32, 48, and 128 pixels.
- Create only the private WizMasia/lingolens repository.

---

### Task 1: Add original icon assets and LingoLens metadata

**Files:**
- Create: src/icons/lingolens.svg
- Modify: src/icons/icon-16.png
- Modify: src/icons/icon-32.png
- Modify: src/icons/icon-48.png
- Modify: src/icons/icon-128.png
- Modify: src/manifest.json
- Modify: src/popup/popup.html
- Modify: package.json
- Create: tests/unit/brand-assets.test.ts

**Interfaces:**
- Produces: an editable source mark and four PNG outputs used by the existing manifest paths.
- Consumes: scripts/build.ts static-copy behavior and Chrome MV3 icon conventions.

- [ ] **Step 1: Write the failing static-brand test**

Create tests/unit/brand-assets.test.ts:

~~~ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const pngSize = async (path: string): Promise<readonly [number, number]> => {
  const bytes = await readFile(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
};

describe("LingoLens static assets", () => {
  it("uses LingoLens metadata and four Chrome icon sizes", async () => {
    const manifest = JSON.parse(await readFile("src/manifest.json", "utf8")) as {
      name: string;
      action: { default_title: string };
    };
    expect(manifest.name).toBe("LingoLens");
    expect(manifest.action.default_title).toBe("LingoLens");
    await expect(pngSize("src/icons/icon-16.png")).resolves.toEqual([16, 16]);
    await expect(pngSize("src/icons/icon-32.png")).resolves.toEqual([32, 32]);
    await expect(pngSize("src/icons/icon-48.png")).resolves.toEqual([48, 48]);
    await expect(pngSize("src/icons/icon-128.png")).resolves.toEqual([128, 128]);
  });
});
~~~

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: bun test tests/unit/brand-assets.test.ts

Expected: FAIL because the manifest still says Local Page Translator.

- [ ] **Step 3: Create the selected Apple Frames mark and replace generated assets**

Create src/icons/lingolens.svg with a square 512 viewBox, a paper #f7f4ec rounded-square background, ink #17201b strokes, a moss #2f6d4f leaf/accent, two symmetric apple-contour lens frames, and a simple bridge. Include no text, linked asset, raster image, bite mark, or Apple Inc. reference. Leave at least 10% outer padding around the stroke.

Rasterize the source locally and inspect dimensions before replacing the current PNGs:

~~~bash
for size in 16 32 48 128; do
  sips -z "$size" "$size" src/icons/lingolens.svg --out "src/icons/icon-$size.png"
done
file src/icons/icon-16.png src/icons/icon-32.png src/icons/icon-48.png src/icons/icon-128.png
~~~

Set metadata to these values while retaining the existing version, permissions, entrypoints, and icon paths:

~~~json
{
  "name": "LingoLens",
  "description": "Private, on-device page translation for Chrome.",
  "action": { "default_title": "LingoLens" }
}
~~~

Set package.json name to lingolens while retaining private: true. Set the popup document title and visible heading to LingoLens without changing Korean interaction labels.

- [ ] **Step 4: Build, test, and visually inspect the actual extension icon**

Run:

~~~bash
bun test tests/unit/brand-assets.test.ts
bun run build
~~~

Expected: PASS and four PNGs copied to dist/icons. Reload the unpacked dist extension in Chrome. Inspect its toolbar icon at 16px, extension card icon at 128px, and popup heading; the apple lenses, bridge, and leaf must remain recognizable.

- [ ] **Step 5: Commit the atomic brand change**

~~~bash
git add package.json src/manifest.json src/popup/popup.html src/icons tests/unit/brand-assets.test.ts
git commit -m "feat: brand extension as LingoLens"
~~~

---

### Task 2: Add the user guide, license, policy, and release documents

**Files:**
- Modify: README.md
- Create: README.ko.md
- Create: LICENSE
- Create: THIRD_PARTY_NOTICES.md
- Create: PRIVACY.md
- Create: SECURITY.md
- Create: CONTRIBUTING.md
- Create: CODE_OF_CONDUCT.md
- Create: CHANGELOG.md
- Create: docs/public-release-checklist.md
- Modify: tests/unit/brand-assets.test.ts

**Interfaces:**
- Produces: GitHub-ready installation, privacy, license, security, contributor, and public-release guidance.
- Consumes: the actual manifest permissions (storage and HTTP/S page access), Chrome 138 minimum, and Chrome-managed on-device models.

- [ ] **Step 1: Extend the failing document contract test**

Append this test to tests/unit/brand-assets.test.ts:

~~~ts
it("contains the required user and policy documents", async () => {
  const read = (path: string) => readFile(path, "utf8");
  await expect(read("README.md")).resolves.toContain("LingoLens");
  await expect(read("README.md")).resolves.toContain("ringo");
  await expect(read("README.ko.md")).resolves.toContain("LingoLens");
  await expect(read("LICENSE")).resolves.toContain("Apache License");
  await expect(read("PRIVACY.md")).resolves.toContain("No analytics");
  await expect(read("THIRD_PARTY_NOTICES.md")).resolves.toContain("esbuild");
});
~~~

- [ ] **Step 2: Run the document contract and confirm it fails**

Run: bun test tests/unit/brand-assets.test.ts

Expected: FAIL because the Korean README and policy documents do not exist.

- [ ] **Step 3: Write accurate, original documentation**

Write README.md in concise English. Include: what LingoLens does; Chrome 138 and device/model prerequisites; unpacked installation; full-page, element, retranslation, language-menu, hover, and inline usage; YouTube Live Chat MVP status; known browser model/pair limitations; and links to every policy document. Include this exact naming paragraph:

~~~md
**Why LingoLens?** “Lingo” evokes language. It also deliberately echoes *ringo* (りんご), the Japanese word for apple, matching the apple-frame icon. “Lingo” itself does not mean apple in Japanese.
~~~

Write README.ko.md as a Korean quick manual with the same functional claims and UI labels copied verbatim from the popup/options source.

Copy the canonical Apache License 2.0 text into LICENSE. Write THIRD_PARTY_NOTICES.md containing this direct-dependency table and the statement that no listed package code is bundled in the checked-in extension output:

~~~md
| Package | Use | License |
| --- | --- | --- |
| esbuild 0.28.1 | Development bundling | MIT |
| @biomejs/biome 2.5.3 | Development linting/formatting | MIT OR Apache-2.0 |
| @types/chrome 0.2.2 | Development type checking | MIT |
| @types/dom-chromium-ai 0.0.17 | Development type checking | MIT |
| happy-dom 20.10.6 | Tests only | MIT |
| TypeScript 5.9.3 | Development type checking | Apache-2.0 |
| Vitest 4.1.10 | Tests only | MIT |
~~~

Write PRIVACY.md containing the exact statements No analytics, No LingoLens account, and No LingoLens server receives page text. Explain that Chrome itself manages local model availability and the first model acquisition. Write short original SECURITY, CONTRIBUTING, CODE_OF_CONDUCT, and CHANGELOG documents. Security reporting must direct reports to private GitHub reporting or the owner profile and must not invent an email address. Create docs/public-release-checklist.md with items for test/build, Chrome manual QA, model/pair availability, permissions, privacy copy, support route, trademark review, current Chrome Web Store policy review, icon review, and listing assets.

- [ ] **Step 4: Validate documents and static claims**

Run:

~~~bash
bun test tests/unit/brand-assets.test.ts
git diff --check
~~~

Expected: PASS with no whitespace errors. Re-read README.md, README.ko.md, and PRIVACY.md against src/manifest.json; do not claim offline availability before Chrome has acquired a needed model and do not claim all chat services are supported.

- [ ] **Step 5: Commit the documentation package**

~~~bash
git add README.md README.ko.md LICENSE THIRD_PARTY_NOTICES.md PRIVACY.md SECURITY.md CONTRIBUTING.md CODE_OF_CONDUCT.md CHANGELOG.md docs/public-release-checklist.md tests/unit/brand-assets.test.ts
git commit -m "docs: add LingoLens release materials"
~~~

---

### Task 3: Add GitHub collaboration templates and prepare the private remote

**Files:**
- Create: .github/ISSUE_TEMPLATE/bug_report.md
- Create: .github/ISSUE_TEMPLATE/feature_request.md
- Create: .github/PULL_REQUEST_TEMPLATE.md
- Modify: .gitignore

**Interfaces:**
- Produces: private-repository collaboration defaults and a verified command sequence for creating origin after the live-chat branch is merged and manually verified.
- Consumes: the authenticated WizMasia GitHub CLI session and all local commits from both implementation branches.

- [ ] **Step 1: Create original GitHub templates and ignore visual brainstorming state**

Create a bug report template requesting Chrome version, OS, on-device model availability, redacted page URL, exact shortcut/display mode, expected behavior, actual behavior, and console errors. Create a feature template requesting user problem, proposed behavior, privacy impact, and alternatives. Create a PR template containing behavior, automated tests, build, manual QA, privacy/permission impact, visual evidence, and release-note checkboxes.

Add the exact ignore entry if absent:

~~~gitignore
.superpowers/
~~~

- [ ] **Step 2: Run full local quality gates**

Run:

~~~bash
bun test
bunx tsc --noEmit
bunx biome check src tests scripts vitest.config.ts
bun run build
git diff --check
git status --short
~~~

Expected: all quality commands PASS, dist remains ignored, and only intended template/ignore changes are left before commit.

- [ ] **Step 3: Commit collaboration files**

~~~bash
git add .github .gitignore
git commit -m "chore: add GitHub collaboration templates"
git log -3 --oneline
~~~

- [ ] **Step 4: Create and push the private repository after cross-branch integration**

Run this step only after the YouTube Live Chat branch is merged, its real-Chrome manual test has passed, and the final root quality gate is green. It is intentionally an integration step because publishing immediately after the branding branch would violate the approved release gate.

Confirm the name is still unused, then create and push only a private remote:

~~~bash
gh api repos/WizMasia/lingolens --silent >/dev/null 2>&1 && exit 1 || true
gh repo create WizMasia/lingolens --private --source=. --remote=origin --push
git remote -v
git status --short
~~~

Expected: origin is https://github.com/WizMasia/lingolens.git, main is pushed, and the worktree is clean. Do not alter repository visibility or create a Chrome Web Store listing.
