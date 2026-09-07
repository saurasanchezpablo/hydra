# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Hydra Launcher: an Electron desktop app (Node.js/TypeScript + React) for managing a game library, with a native Rust addon and a Python RPC sidecar for torrenting. This repo is a **fork** of [hydralauncher/hydra](https://github.com/hydralauncher/hydra) that adds a self-hosted backend ([entitybtw/hydra-selfhosted](https://github.com/entitybtw/hydra-selfhosted)): self-hosted accounts/auth, self-hosted cloud saves (v1 legacy + v2 sync flow, selectable in Settings → Integrations → Cloud Saves), public profile pages, and SteamGridDB artwork integration. When working on auth, cloud saves, or profile/artwork features, keep in mind the code may need to support both the Hydra Cloud (upstream) and self-hosted backends.

## Commands

Package manager is **yarn** (npm is blocked via `engines`/`.npmrc`).

- `yarn dev` — run the app in development (electron-vite dev)
- `yarn build` — typecheck + electron-vite build
- `yarn typecheck` — runs `typecheck:node` (src/main, src/preload) and `typecheck:web` (src/renderer, src/big-picture) separately, since they're different TS project configs
- `yarn lint` — eslint --fix
- `yarn format` / `yarn format-check` — prettier
- `yarn test` — runs `src/**/*.test.ts` with the native Node test runner (`node --test`). Run a single file directly, e.g. `node --import ./scripts/register-ts-node.mjs --test src/main/services/game-running-state.test.ts`
- `yarn build:native` — builds the Rust native addon (`native/hydra-native`, NAPI-based) required for cloud saves; runs automatically via `postinstall`
- `yarn build:python-rpc` — builds the Python RPC sidecar (`python_rpc/`, used for torrent downloading)
- `yarn build:linux` / `build:win` / `build:mac` — full platform builds via electron-builder (build native addon + python-rpc + electron-vite build + electron-builder)

Git hooks (husky): pre-commit runs `yarn format`, pre-push runs `yarn lint` && `yarn typecheck`. Commit messages must follow Conventional Commits (`commitlint.config.js` extends `@commitlint/config-conventional`).

## Architecture

**Process split** (electron-vite, configured in `electron.vite.config.ts`): three build targets — `main`, `preload`, `renderer` — plus a fourth standalone Vite root `src/big-picture` (a separate mini React app for a controller-friendly "big picture" UI, built to `out/big-picture`).

Path aliases (different per tsconfig, see `tsconfig.node.json` / `tsconfig.web.json`):

- `@main/*` → `src/main/*` (main process only)
- `@renderer/*` → `src/renderer/src/*`
- `@shared` → `src/shared/index.ts` — code shared between main and renderer
- `@types` → `src/types/index.ts`
- `@locales` → `src/locales/index.ts`

**Main process** (`src/main`):

- `main.ts` / `index.ts` — entrypoint, window bootstrap
- `events/` — one subfolder per feature area (auth, cloud-save, catalogue, download-sources, friends, library, retroarch, user, etc.), each registering IPC handlers via `registerEvent()` (`src/main/events/register-event.ts`), which wraps `ipcMain.handle` and JSON-round-trips the return value. This is the main↔renderer IPC boundary — the preload script (`src/preload/index.ts`) exposes matching methods on `window` via `contextBridge`.
- `services/` — business logic, one subfolder per domain (cloud-save, download, emulators, achievements, hosters, library-sync, retro-achievements, retroarch, sse, user) plus flat service files (steam.ts, ludusavi.ts, python-rpc.ts, native-addon.ts, hydra-api.ts, window-manager.ts, download-orchestrator.ts, etc.)
- `level/` — local persistence via `classic-level` (LevelDB). `level/sublevels/` has one sublevel per data domain (games, downloads, cloud-save-\*, emulators, themes, etc.) — this is the local DB schema; check here before adding new persisted state.
- `services/native-addon.ts` — the Node ↔ Rust FFI bridge (loads the compiled NAPI addon, typed via `@types`). The Rust side lives in `native/hydra-native/src/cloud_save/` (save_scanner, pipeline, restore, path_resolution, upload, local_snapshot, manifest, identity, hashing, custom_path_overlap) — cloud save scanning/hashing/upload/restore is implemented in Rust for performance, called from `services/cloud-save/`.
- `services/python-rpc.ts` — talks to the `python_rpc/` sidecar process (torrent downloading via libtorrent-style RPC).

**Renderer process** (`src/renderer/src`): React app — `pages/`, `features/`, `components/`, `context/`, `hooks/`, `services/` (renderer-side wrappers around the `window.electron`-exposed IPC calls), `store.ts` (Redux Toolkit).

**i18n**: `src/locales/<lang>/translation.json`, driven by i18next; `en` is the source of truth for new keys.

## Conventions (from prior Cursor rules)

- **Logging**: never use `console.*`. Use `logger` from `@main/services` (main process) or `@renderer/logger` (renderer). Map `console.log/error/warn/info/debug` → `logger.log/error/warn/info/debug`.
- **i18n**: no hardcoded user-facing strings (including placeholders) — always go through `useTranslation`/`t()`, with new keys added to `src/locales/en/translation.json`.
- Use `T[]` array syntax, never `Array<T>`.
- Prefer named exports over default exports for utilities/services.
- Prefer async/await over raw promise chains.
- Fix ESLint errors properly (fix the code, or use minimal compliant markup like `<track kind="captions" />`) rather than disabling rules; if a rule must be disabled, comment why.
