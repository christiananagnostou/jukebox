# AGENTS

Guidance for automated coding agents working in this repo.

## Repo Overview

- Desktop app: Tauri v2 + Qwik frontend.
- Frontend: Vite SSR dev server.
- Node: 22.12.0+ (package.json engines).
- Rust: 1.93+ (src-tauri/Cargo.toml rust-version).
- Frontend lives in src/; Tauri backend in src-tauri/.

## Commands

Install dependencies:

- npm install

Frontend dev (SSR):

- npm run dev

Desktop dev:

- npm run tauri dev

Frontend build:

- npm run build
- npm run build.client # used by qwik build
- npm run build.server # used by qwik build
- npm run build.mobile # statically rendered private PWA embedded by Rust

Typecheck:

- npm run build.types

Public-source portability:

- npm run check:public-source

Built-bundle portability:

- npm run check:bundle-portability -- src-tauri/target/release/Jukebox src-tauri/target/release/bundle

Lint:

- npm run lint

Format:

- npm run fmt
- npm run fmt.check

Local pre-push gate:

- npm run pre-push
- npm run check:rust # Rust-only format, tests, and Clippy

Desktop bundle:

- npm run tauri build

Rust only:

- npm run build.mobile # required before direct Cargo commands on a clean checkout
- cd src-tauri && cargo build

## Tests

- npm test # Vitest unit, controller, component, and service-worker tests
- npx vitest run path/to/file.test.ts # one test file
- npx playwright install chromium webkit # compiled mobile browser prerequisites
- npm run test.mobile # synthetic-library playback/offline tests in both engines
- npm run check:rust # builds mobile assets, then Rust format/tests/Clippy

## CI Parity (GitHub Actions)

- npm ci
- npm run fmt.check
- npm run check:public-source
- npm run lint
- npm run build.types
- npm run build
- npm run test.mobile (Web job, Chromium + WebKit)
- npm run build.mobile before direct Cargo tests or lint
- npm run tauri build (Ubuntu + macOS + Windows)

## Code Style

- Prettier is the formatter (.prettierrc, no semicolons, single quotes).
- ESLint is configured via eslint.config.cjs (ESLint 9 + typescript-eslint).
- Keep changes small and focused; avoid large refactors.
- Prefer ASCII unless the file already uses Unicode.

## TypeScript / Qwik

- Use component$ and hooks from @builder.io/qwik.
- Avoid async useComputed$ (deprecated). Use useTask$ or useResource$.
- Prefer useVisibleTask$ for browser-only logic.
- Keep types explicit; strict mode is enabled.
- Prefer type-only imports (eslint warns for consistency).

## Imports

- Use ~/\* alias for src/ (see tsconfig paths).
- Group imports: external, internal, relative.
- Remove unused imports to satisfy lint.

## Naming

- Components: PascalCase.
- Hooks: useX naming.
- Types/interfaces: PascalCase.
- Variables/functions: camelCase.
- Constants: UPPER_SNAKE_CASE for true constants.

## Error Handling

- Avoid silent failures.
- Rust: propagate Result for recoverable errors; avoid panics.
- TS: guard null/undefined in async or optional data.

## Tauri v2 Notes

- JS core: @tauri-apps/api/core, path, event, webviewWindow.
- Dialog/SQL are plugins (@tauri-apps/plugin-\*).
- Rust path APIs: tauri::Manager::path.
- Asset protocol is enabled in src-tauri/tauri.conf.json.
- convertFileSrc requires asset protocol scope to include the path.

## Tauri Plugins Used

- tauri-plugin-dialog
- tauri-plugin-sql (sqlite)

## Rust Conventions

- Edition: 2021.
- rustfmt enforced in CI (cargo fmt -- --check).
- Keep command signatures stable; frontend invokes depend on them.

## Styling / Tailwind

- Tailwind v4 is used.
- src/global.css uses @import "tailwindcss" and @config.
- postcss.config.js uses @tailwindcss/postcss.
- Tailwind config: tailwind.config.js

## Data Paths

- Album art cache stored in app local data dir.
- Location resolved via app_handle.path().app_local_data_dir().
- Music library paths can be outside app dir; use convertFileSrc.

## Repo Hygiene

- Generated schemas live in src-tauri/gen/ and are committed.
- Do not edit generated schema files manually.
- Treat every tracked file as public distribution material. Never commit developer usernames, home-directory paths, LAN or tailnet hostnames, or names of unrelated applications.
- Machine-specific paths and URLs may exist only as runtime-selected user data. Canonical repository URLs and clearly synthetic test fixtures are allowed.
- Run `npm run check:public-source` before a PR. It rejects committed macOS, Linux, Windows, and shell home-directory layouts.
- Build releases through `npm run tauri build`; its wrapper remaps checkout, toolchain, home, and temporary paths before Rust compilation.
- Run `npm run check:bundle-portability -- <bundle paths>` after packaging. It rejects builder paths embedded in distributable files.

## PR / Commit Expectations

- Keep commits focused and descriptive.
- Run lint + typecheck before pushing when possible.
- Update docs if tooling/commands change.

## Cursor / Copilot Rules

- No .cursor/rules, .cursorrules, or .github/copilot-instructions.md found.
- If added later, update this section.

## Troubleshooting

- Linux build needs WebKitGTK 4.1 dependencies.
- If media URLs fail, check asset protocol enable + scope.
- If Tailwind styles disappear, verify global CSS import.

## Useful Links

- Tauri v2 migration: https://v2.tauri.app/start/migrate/from-tauri-1/
- Qwik docs: https://qwik.dev/
- Tailwind v4 docs: https://tailwindcss.com
