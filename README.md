# Market

A cryptocurrency data scraper. Every 12 hours, a GitHub Actions workflow fetches the top 50 coins by market cap from the [CoinGecko API](https://www.coingecko.com/en/api) and commits the results to `customCoinData.json`.

Adapted from [genfuture/cryptocurrency-scraper](https://github.com/genfuture/cryptocurrency-scraper). The output format is the same; see [Changes from the original](#changes-from-the-original) for what was fixed.

## Requirements

- Node.js 22 or newer
- npm

## Usage

```bash
npm ci
npm start          # same as: node coins.cjs
```

A run of 50 coins takes about 13 minutes, because the script waits 15 seconds between coins to stay within CoinGecko's free rate limit.

### Settings

Set these environment variables to change the defaults, e.g. `PER_PAGE=100 npm start`:

| Variable        | Default | Meaning                                       |
| --------------- | ------- | --------------------------------------------- |
| `PER_PAGE`      | `50`    | Coins per page (CoinGecko allows up to 250)   |
| `MAX_PAGES`     | `1`     | Number of pages to fetch, by market cap       |
| `COIN_DELAY_MS` | `15000` | Wait between coin detail requests, in ms      |
| `PAGE_DELAY_MS` | `30000` | Wait between page requests, in ms             |

CoinGecko's public API only allows a few requests per minute, so lowering the delays mostly leads to rate-limit retries. GitHub Actions stops a job after 6 hours, which at the default delay is roughly 1,400 coins.

### Interrupted runs

After each coin, the results so far are written to `customCoinData.partial.json`. If a run stops early, the next run reuses those coins and only fetches the rest. Delete the file to start over. It is removed when a run finishes.

### Errors

- Rate limits (HTTP 429), server errors, network failures and timeouts (30 seconds per request) get up to 5 attempts, with waits of 2, 8, 32 and 128 seconds between them.
- If a coin's details still can't be fetched, the coin is saved with the price and market figures from the market list, but without links, description or contract addresses.
- If the market list can't be fetched, the script exits with an error and leaves `customCoinData.json` as it was.

## Automatic updates

[`.github/workflows/fetch_coin_data.yml`](.github/workflows/fetch_coin_data.yml) runs the script:

- every 12 hours (00:00 and 12:00 UTC),
- on every push to `main`,
- on demand: **Actions → Fetch Coin Data → Run workflow**.

It commits `customCoinData.json` to the branch it ran on, and also uploads it as a workflow artifact that is kept for 5 days. GitHub only runs scheduled workflows on the repository's default branch.

## Output format

`customCoinData.json` maps an ID per coin to its data, in market cap order. The ID is the first 16 hex characters of the SHA-256 hash of the CoinGecko coin ID (`bitcoin` → `6b88c087247aa2f0`), so a coin keeps the same ID from one run to the next.

```json
{
  "6b88c087247aa2f0": {
    "name": "Bitcoin",
    "symbol": "btc",
    "price": 81621,
    "livePrice": {
      "value": 81621,
      "url": "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
    },
    "rank": 1,
    "cap": 1640969337622,
    "launchDate": "2009-01-03",
    "website": "http://www.bitcoin.org",
    "reddit": "https://www.reddit.com/r/Bitcoin/",
    "...": "..."
  }
}
```

| Group               | Fields |
| ------------------- | ------ |
| Basics              | `name`, `symbol`, `rank`, `description`, `launchDate`, `coinLogo`, `chain` (the token's platform; empty for native coins) |
| Market data, in USD | `price`, `livePrice`, `cap`, `total_volume`, `high_24h`, `low_24h`, `price_change_24h`, `price_change_percentage_24h`, `market_cap_change_24h`, `market_cap_change_percentage_24h`, `circulating_supply`, `total_supply`, `max_supply`, `last_updated` |
| Links               | `website`, `explorerLink`, `reddit`, `telegram`, `twitter`, `discord`, `insta`, `youtube` (`insta` and `youtube` are always empty) |
| Contract addresses  | `address` and `platforms` (the same map of platform → address) |
| Fixed values        | `addedDate` (time of the run), `coinMarketCap`, `coingecko`, `token` (always `true`) |
| Legacy scores       | `coingecko_rank`, `coingecko_score`, `developer_score`, `community_score`, `liquidity_score`, `public_interest_score` (currently always empty) |

Missing numbers are `0` (`"0"` for `price` and `cap`), and missing text is an empty string.

## Changes from the original

- Running the script a second time wrote an empty `customCoinData.json`, because `progress.json` still pointed past the last coin. Every run now fetches all coins.
- Resuming an interrupted run dropped the coins fetched before the interruption. They are now kept.
- A coin whose details failed to load was saved with all of its market figures set to `0`. It now keeps its figures from the market list.
- Server errors, network failures and timeouts are now retried too (before, only rate limits were). If the market list can't be fetched, the script exits with an error, so the workflow run fails instead of passing silently.
- Coin IDs are now stable between runs. They used to be random on every run.
- The workflow now asks for the write permission it needs to push (`contents: write`) instead of relying on the repository's default token settings. It runs on Node 24 with current action versions, installs exact versions from `package-lock.json`, and commits only `customCoinData.json`.
- The unused dependencies (`puppeteer`, `cheerio`, `qs`, `xml2js`, `fs`) were removed, along with `progress.json` and the duplicate `customCoinDatat.json`.

## Credits

The original scraper is [genfuture/cryptocurrency-scraper](https://github.com/genfuture/cryptocurrency-scraper) by Prem ([genfuture](https://github.com/genfuture)). Its README says it is MIT-licensed, but the repository has no LICENSE file. Market data is provided by [CoinGecko](https://www.coingecko.com).

## Disclaimer

This tool is for educational and research purposes only. Always check the data independently before making any financial decision.
