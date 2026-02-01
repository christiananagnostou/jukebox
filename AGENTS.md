# AGENTS

This file is for automated coding agents working in this repo.
It captures how to build, lint, and follow conventions for Jukebox.

## Repo Overview

- App: Tauri v2 desktop app + Qwik frontend (Vite SSR dev server).
- Node: 22.12.0+ (see package.json engines).
- Rust: 1.93+ (see src-tauri/Cargo.toml rust-version).
- Frontend lives in src/; Tauri backend in src-tauri/.

## Commands (Local)

Install dependencies:

- npm install

Frontend dev (SSR):

- npm run dev

Tauri dev (desktop app):

- npm run tauri dev

Frontend builds:

- npm run build # qwik build
- npm run build.client # vite build
- npm run build.server # adapter build
- npm run build.preview # preview build

Typecheck:

- npm run build.types

Lint:

- npm run lint

Format:

- npm run fmt
- npm run fmt.check

Tauri build (bundles):

- npm run tauri build

Rust (Tauri) build only:

- cd src-tauri && cargo build

## Tests

- There are no explicit test commands in package.json.
- If tests are added later, document them here and in CI.

Single test:

- Not currently supported (no test runner configured).

## CI Parity

CI runs on PRs and master:

- npm ci
- npm run lint
- npm run build.types
- npm run build
- npm run tauri build (Ubuntu + macOS)

## Code Style (General)

- Prettier is the formatter; run npm run fmt.
- Prettier config: .prettierrc (2-space, single quotes, no semicolons).
- ESLint config: eslint.config.cjs (ESLint 9 + typescript-eslint).
- Prefer small, readable changes; avoid sweeping refactors.
- Keep ASCII in source unless existing files use Unicode.

## TypeScript / Qwik Conventions

- Use component$ and hooks from @builder.io/qwik.
- Avoid async useComputed$ (deprecated). Use useTask$ or useResource$.
- Prefer useVisibleTask$ for browser-only logic.
- Maintain strict typing (tsconfig strict = true).
- Prefer type imports when possible (see eslint rule).
- Use functional updates and local stores for reactive state.

## Imports

- Use path aliases ~/\* for src/ (see tsconfig paths).
- Keep imports grouped: external, internal, relative.
- Avoid unused imports; lint will fail.

## Naming

- Components: PascalCase (files and exports).
- Hooks: useX naming.
- Types/interfaces: PascalCase.
- Variables/functions: camelCase.
- Constants: UPPER_SNAKE_CASE when truly constant.

## Error Handling

- Prefer explicit errors over silent failures.
- In Rust, use Result and propagate errors unless truly fatal.
- In TS, guard against undefined/null for async data.
- When interacting with the filesystem, validate paths and existence.

## Tauri v2 Notes

- JS core APIs: @tauri-apps/api/core, path, event, webviewWindow.
- Former v1 APIs moved to plugins (dialog/fs/sql).
- Rust path API: tauri::Manager::path (not tauri::api::path).
- Asset protocol is enabled in src-tauri/tauri.conf.json.
- When using convertFileSrc, ensure asset protocol scope allows the path.

## Tauri Plugins Used

- tauri-plugin-dialog
- tauri-plugin-fs
- tauri-plugin-sql (sqlite)

## Rust Conventions

- Edition: 2021
- rustfmt enforced in CI (cargo fmt -- --check).
- Avoid panics for recoverable errors.
- Keep Tauri command signatures stable; changes can affect frontend invokes.

## Styling / Tailwind

- Tailwind v4 is used; global CSS imports via @import "tailwindcss".
- Tailwind config file: tailwind.config.js
- PostCSS config: postcss.config.js with @tailwindcss/postcss plugin.

## Paths and Data

- App local data directory is used for album art cache.
- Location: app_handle.path().app_local_data_dir()
- Music library paths can be outside app dir; use convertFileSrc.

## Repo Hygiene

- Generated Tauri schema files live in src-tauri/gen/ and are committed.
- Do not edit generated schema files manually.
- Keep .gitignore consistent with build outputs.

## PR / Commit Expectations

- Keep commits focused and descriptive.
- Run lint and typecheck before pushing when possible.
- Update docs when changing commands or tooling.

## Cursor / Copilot Rules

- No .cursor/rules, .cursorrules, or .github/copilot-instructions.md present.
- If these files are added later, update this section.

## Troubleshooting

- If Tauri build fails on Linux, install WebKitGTK 4.1 deps.
- If audio/image paths fail, verify asset protocol enable + scope.
- If styling is missing, ensure Tailwind v4 import is present in src/global.css.

## Useful Links

- Tauri v2 migration guide: https://v2.tauri.app/start/migrate/from-tauri-1/
- Qwik docs: https://qwik.dev/
- Tailwind v4 docs: https://tailwindcss.com
