# Bitburner Scripts

My TypeScript scripts for [Bitburner](https://github.com/bitburner-official/bitburner-src) (v3), synced to the game via the Remote File API.

Based on the official [typescript-template](https://github.com/bitburner-official/typescript-template) — see its [Beginner's Guide](https://github.com/bitburner-official/typescript-template/blob/main/BeginnersGuide.md) for full setup instructions.

## Quick start

```
npm i
npm run watch
```

Then in the game: Options -> Remote API -> enter the port `npm run watch` printed -> Connect.

## Scripts

### Hacking

| Script | Description |
| --- | --- |
| `hackController.js` | Main HWGW batcher. Roots everything it can, pairs the biggest hosts with the best targets, then streams staggered hack/weaken/grow/weaken batches per target. |
| `simpleHackController.js` | Single host/target loop: prep (weaken/grow) then hack. Early-game alternative to the batcher. `run simpleHackController.js <host> [target]` |
| `debugHackController.js` | Verbose single-pair harness for diagnosing batch timing. Logs to tail and `debugHack.txt`. |
| `workers/hack.js` / `grow.js` / `weaken.js` | Minimal workers launched by the controllers. `run workers/<script> <target> [delay]` |
| `nukeAll.js` | One-shot: open ports and nuke every server we can. |
| `monitor.js` | Live money/security display for a target. `run monitor.js --hostname n00dles` |

### Other automation

| Script | Description |
| --- | --- |
| `gangController.js` | Recruits, equips, ascends and assigns tasks for a combat gang. `--focus auto\|respect\|money\|"territory warfare"` |
| `cloudServerController.js` | Buys cloud servers, then keeps doubling their RAM as money allows. |
| `shareController.js` | Deploys `workers/share.js` across all rooted servers for faction rep. `--force` kills running scripts first, `--include-home` uses home too. |
| `connectTo.js` | Connects to any server by name (Singularity), or prints the manual `connect` path. `--list` shows paths to everything. |
| `darknetHack.js` | Authenticates to darknet servers, using heartbleed when the default password fails. |

### Library (`src/lib`)

- `servers.ts` — network scanning/pathfinding, server details (single `getServer()` call), rooting, target scoring.
- `hacking.ts` — HWGW batch sizing, server prep, per-target prep/batch lifecycle.
- `gang.ts` — gang enums and helpers (equipment, members, recruit names, focus parsing).
- `logger.ts` — tail/file logger used by the debug harness.
- `ui.ts` — React UI building blocks (panels, stat rows, progress bars) for `ns.printRaw`, using the game's own React via `globalThis` (no 25GB `window`/`document` RAM penalty).

## Development

```
npm run lint      # eslint check
npm run lint:fix  # auto-fix style issues
```

Code style (4-space indent, double quotes, semicolons) is enforced through `.eslintrc.json`.
