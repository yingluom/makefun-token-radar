# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/yingluom/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/yingluom/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar built from a single DefiLlama snapshot (2026-11-14, 758 protocols). It ranks the 236 protocols that record no token yet by what a launch could be worth, covers all 40 watchlist protocols, and sets the 120 largest already-tokenised protocols aside in a separate live view.

The value model is derived from the snapshot itself, never from protocol names: implied value = TVL × category multiple × momentum × maturity × chain breadth. The category multiple is the median market cap / TVL of the tokenised protocols in the same category in this snapshot (clamped to 0.05–2.00, with an all-category median fallback for thin categories); momentum comes from the 7-day TVL change, which the snapshot states in per cent; maturity grows with each tokenless year since the protocol was listed; chain breadth adds 2% per major chain, capped at +10%. Hygiene rules keep representations of tokens that already trade (WBTC, USDT0, wrapped/staked products, exchange house brands, CEX and bridge-wrapper categories) off the board; watchlist members are exempt.

The dashboard is a static, offline page: a sortable, filterable board (search, chain, category, minimum value, watchlist-only), a per-protocol detail view that shows the model's arithmetic line by line next to a concrete farm plan (wallet setup, amounts by TVL tier, gas by chain type, cadence, claim safety), and the live-token comparison view. Every protocol carries its own farm plan from a per-category playbook.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=./out node main.ts --input /path/to/snapshot.json
```

This writes `board.json`, `data.js`, `dashboard/` and `screenshots/` into the output directory, plus the `dossier.json` built from them. Open `out/dashboard/index.html` to read the radar. Node 22, standard library only, no network.
