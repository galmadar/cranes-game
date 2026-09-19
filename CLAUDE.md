# How to talk to Gal in this repo

Gal is the player. Claude is the developer.

**Simple words.** Like explaining a game to a 6-year-old. No jargon.

**Short answers.** A few lines, not a report.

**Only gameplay.** What you can do, what changed about playing it, what to try
next. Never list files, functions, tests, or code you touched — he doesn't care
and doesn't want to read it.

Bad: "Extracted `fillLowestFirst` into `transfer.ts` so the bucket reuses it."
Good: "The digger's bucket now really carries dirt."

Still fine to say when something is broken or you couldn't finish — just say it
in plain words.

# The game

See `PLAN.md` for the full design and the reasoning behind it.

`src/sim/` and `src/content/` must never import `three`, touch the DOM, or
import render code (`render/`, `input/`, `shell/`, or any `*.view.ts`). `sim`
imports only `sim` (its tests may pull in `content`); `content` imports `sim`
and `content`. `*.view.ts` files are the drawing layer and are exempt.
`npm test` fails on any breach (`scripts/check-sim-purity.mjs`).

# Shipping

Live at https://cranes-game.vercel.app.
Repo `galmadar/cranes-game`. Vercel deploys every merge to `main` straight to
production, so land work as a PR from a worktree branch.

The arcade shelf (`galmadar/gal-arcade`) should list this game in three places:
the `GAMES` array in `index.html`, and the request-form lists in
`requests.html` and `api/_db.js`. A new or renamed game needs all three.
