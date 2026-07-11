# Third-party notices

LingoLens uses the following direct dependencies during development, testing, or builds.

| Package | Use | License |
| --- | --- | --- |
| esbuild 0.28.1 | Development bundling | MIT |
| @biomejs/biome 2.5.3 | Development linting/formatting | MIT OR Apache-2.0 |
| @types/chrome 0.2.2 | Development type checking | MIT |
| @types/dom-chromium-ai 0.0.17 | Development type checking | MIT |
| happy-dom 20.10.6 | Tests only | MIT |
| TypeScript 5.9.3 | Development type checking | Apache-2.0 |
| Vitest 4.1.10 | Tests only | MIT |

No listed package code is bundled in the checked-in extension output. The generated extension bundles LingoLens source; development and test dependencies remain outside that checked-in output.
