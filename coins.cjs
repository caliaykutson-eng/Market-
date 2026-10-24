const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');

// Settings. Override any of them with an environment variable, e.g. `PER_PAGE=100 node coins.cjs`
const PER_PAGE = envNumber('PER_PAGE', 50);              // coins per page (CoinGecko allows up to 250)
const MAX_PAGES = envNumber('MAX_PAGES', 1);             // pages to fetch, ordered by market cap
const COIN_DELAY_MS = envNumber('COIN_DELAY_MS', 15000); // pause between coin detail requests
const PAGE_DELAY_MS = envNumber('PAGE_DELAY_MS', 30000); // pause between page requests

const API_URL = 'https://api.coingecko.com/api/v3';
const OUTPUT_FILE = 'customCoinData.json';
// Rewritten after every coin so an interrupted run can resume; deleted when the run completes
const PARTIAL_FILE = 'customCoinData.partial.json';
const MAX_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 30000;

function envNumber(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${name} must be a non-negative number, got "${value}"`);
  }
  return number;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 16 hex characters, derived from the CoinGecko id so a coin keeps its key across runs
function coinKey(coinId) {
  return crypto.createHash('sha256').update(coinId).digest('hex').slice(0, 16);
}

// GET a CoinGecko endpoint, retrying rate limits (429), server errors and network failures
async function get(path, params) {
  let delay = 2000;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await axios.get(`${API_URL}${path}`, { params, timeout: REQUEST_TIMEOUT_MS });
      return response.data;
    } catch (error) {
      const status = error.response?.status;
      const retryable = !status || status === 429 || status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) throw error;
      console.log(`Request to ${path} failed (${status || error.code || error.message}). Retrying in ${delay / 1000} seconds...`);
      await sleep(delay);
      delay *= 4;
    }
  }
}

async function fetchMarkets() {
  let coins = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) {
      console.log(`Waiting ${PAGE_DELAY_MS / 1000} seconds before next page request...`);
      await sleep(PAGE_DELAY_MS);
    }
    console.log(`Fetching page ${page}...`);
    const data = await get('/coins/markets', {
      vs_currency: 'usd',
      order: 'market_cap_desc',
      per_page: PER_PAGE,
      page,
      sparkline: false,
    });
    if (!Array.isArray(data)) throw new Error('Unexpected response from /coins/markets (expected a list of coins)');
    if (data.length === 0) {
      console.log(`No more data available. Stopping at page ${page - 1}.`);
      break;
    }
    coins = coins.concat(data);
  }
  if (coins.length === 0) throw new Error('CoinGecko returned no coins');
  return coins;
}

// Returns null if the details can't be fetched; the coin is then saved with its /coins/markets data
async function fetchCoinDetails(id) {
  try {
    return await get(`/coins/${id}`);
  } catch (error) {
    console.error(`Error fetching details for coin ${id}: ${error.message}`);
    return null;
  }
}

// Keep only the platforms that list a contract address
function validAddresses(platforms) {
  const valid = {};
  if (platforms && typeof platforms === 'object') {
    for (const [platform, address] of Object.entries(platforms)) {
      if (address && typeof address === 'string') valid[platform] = address;
    }
  }
  return valid;
}

// /coins/{id} gives amounts per currency ({ usd: 1.23, ... }); /coins/markets gives plain USD numbers
function usd(value) {
  return value && typeof value === 'object' ? value.usd : value;
}

// Uses the coin's /coins/{id} details where available, otherwise its /coins/markets row
function buildEntry(coin, details) {
  const market = details?.market_data || coin;
  const links = details?.links || {};
  const addresses = validAddresses(details?.platforms);
  const price = usd(market.current_price) || '0';

  return {
    name: coin.name || '',
    symbol: coin.symbol || '',
    price,
    livePrice: {
      value: price,
      url: `https://api.coingecko.com/api/v3/simple/price?ids=${coin.id}&vs_currencies=usd`,
    },
    rank: details?.market_cap_rank || coin.market_cap_rank || '',
    cap: usd(market.market_cap) || '0',
    addedDate: Date.now().toString(),
    coinMarketCap: true,
    coingecko: true,
    chain: details?.asset_platform_id || '',
    launchDate: details?.genesis_date || '',
    token: true,
    description: details?.description?.en || 'No description available',
    explorerLink: links.blockchain_site?.[0] || '',
    address: addresses,
    website: links.homepage?.[0] || '',
    reddit: links.subreddit_url || '',
    telegram: links.telegram_channel_identifier ? `https://t.me/${links.telegram_channel_identifier}` : '',
    twitter: links.twitter_screen_name ? `https://twitter.com/${links.twitter_screen_name}` : '',
    insta: '',
    youtube: '',
    discord: links.chat_url?.find(url => url?.includes('discord')) || '',
    coinLogo: details?.image?.large || coin.image || '',
    coingecko_rank: details?.coingecko_rank || '',
    coingecko_score: details?.coingecko_score || '',
    developer_score: details?.developer_score || '',
    community_score: details?.community_score || '',
    liquidity_score: details?.liquidity_score || '',
    public_interest_score: details?.public_interest_score || '',
    total_volume: usd(market.total_volume) || 0,
    high_24h: usd(market.high_24h) || 0,
    low_24h: usd(market.low_24h) || 0,
    price_change_24h: market.price_change_24h || 0,
    price_change_percentage_24h: market.price_change_percentage_24h || 0,
    market_cap_change_24h: market.market_cap_change_24h || 0,
    market_cap_change_percentage_24h: market.market_cap_change_percentage_24h || 0,
    circulating_supply: market.circulating_supply || 0,
    total_supply: market.total_supply || 0,
    max_supply: market.max_supply || 0,
    last_updated: details?.last_updated || coin.last_updated || '',
    platforms: addresses,
  };
}

async function main() {
  const coins = await fetchMarkets();
  console.log(`Processing ${coins.length} coins...`);

  // Coins already fetched by an interrupted run
  let fetched = {};
  try {
    fetched = JSON.parse(fs.readFileSync(PARTIAL_FILE, 'utf8'));
    console.log(`Resuming with ${Object.keys(fetched).length} coins from ${PARTIAL_FILE} (delete it to start over)`);
  } catch {
    // No usable partial file, so start from scratch
  }

  const coinData = {};
  let requests = 0;
  for (const [i, coin] of coins.entries()) {
    const key = coinKey(coin.id);
    if (!fetched[key]) {
      if (requests++ > 0) await sleep(COIN_DELAY_MS);
      console.log(`Fetching details for ${coin.name} (${i + 1}/${coins.length})...`);
      fetched[key] = buildEntry(coin, await fetchCoinDetails(coin.id));
      fs.writeFileSync(PARTIAL_FILE, JSON.stringify(fetched, null, 2));
    }
    coinData[key] = fetched[key];
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(coinData, null, 2));
  fs.rmSync(PARTIAL_FILE, { force: true });
  console.log(`Coin data for ${Object.keys(coinData).length} coins saved to ${OUTPUT_FILE}`);
}

main().catch(error => {
  console.error('Error fetching coin data:', error.stack || error);
  process.exitCode = 1;
});
