# Agentic Harness (the app)

Source: the harness repo's `app/` folder (Electron shell in `app/main.js`, web view and local server in `app/web/`). Run with `npm start` in the repo folder.

## Preferences
- Sound: alert sounds must be comfortable at full system volume (low peak level, soft attack, near-pure tones). Loudness is `LEVEL` in `app/sounds/make-sounds.mjs`.
- Look: brain-shaped map with no drawn outline; the background never competes with nodes.

## Working facts
- After changing `app/web/template.html` or `app/web/build.mjs`, run `node app/web/build.mjs`, then restart the app.
