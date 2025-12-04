# Poker RNG Notes

## What's here
- Windows Electron app that scans poker table windows (`node-window-manager`) and shows an always-on-top RNG overlay per table.
- Overlays include: main RNG card (`index.html` + `renderer.js`), stakes badge and clock per table (created in `main.js`), plus auto-roll logic with optional turn gating (`src/turn-detector.js`).
- System tray menu controls scanning, visibility, auto-roll interval, Pomodoro timer, and settings.
- Settings live in `settings.json` and the in-app UI (`settings.html`/`settings.js`), loaded and persisted by `main.js`.

## Current architecture
- Entrypoint `main.js` orchestrates window discovery, tray/shortcuts, settings, scanner, and timers; overlay lifecycle lives in `src/overlay-manager.js` and settings loading in `src/settings-loader.js`.
- Renderer bridge: `preload.cjs` exposes minimal IPC (`table-size`, `roll-now`, `set-auto-roll-interval`).
- Turn detection: `src/turn-detector.js` uses screen sampling (`screenshot-desktop`, `jimp`) with color matching.
- Renderer: `renderer.js` animates the RNG, auto-sizes based on table size, and handles optional auto-roll.

## Known limitations
- The previously documented “modular” files (`main-improved.js`, `config.js`, etc.) are not present; this repo runs solely from `main.js`.
- Settings overlay positioning is merged with defaults but kept in place; no migration files beyond `settings.json`.
- Tests are absent; changes should be validated manually (e.g., `npm start` on Windows).

## Running
- `npm start` to launch the Electron app.
- `npm run dist` builds a Windows portable package via `electron-builder`.

## Potential next steps
- Break `main.js` into modules (scan loop, overlay manager, tray/menu, settings) for maintainability.
- Add automated tests for window filtering and turn detection configuration parsing.
- Document per-poker-site matcher expectations in `settings.json` for easier configuration. 
