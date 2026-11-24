// Token launch radar: valuation model, farm playbooks and dashboard data.
//
// One sealed DefiLlama snapshot goes in; a ranked board of protocols that record no token comes out,
// each with an implied value derived only from the snapshot's own figures, plus a concrete plan for
// farming it. Protocols whose token already trades are never ranked: they are carried separately as
// the "live" comparison set, and they are also the peer group the valuation multiples come from.
//
// The model, stated the same way on the dashboard:
//
//   implied = round_to_$1,000( TVL x category multiple x momentum x maturity x chain breadth )
//
//   category multiple  median market-cap / TVL of the tokenised protocols in the same category in
//                      this snapshot, clamped to [0.05, 2.00]; a category with fewer than three
//                      tokenised peers falls back to the all-category median.
//   momentum           1 + change_7d / 100, clamped to [0.70, 1.30]; 1.00 when no change is reported.
//                      change_7d is a per cent figure (the input README says so, and the data agrees:
//                      the median protocol moved -6.8 in the week and the extremes run to -72.7 and
//                      +4448.5, which only reads as per cent, never as a fraction).
//   maturity           0.85 + 0.07 per year the protocol has run with no token (listed_at to the
//                      snapshot's as_of), clamped to [0.85, 1.25]; 1.00 when listed_at is unknown.
//   chain breadth      +2% for each of Ethereum, Solana, Base, Arbitrum, BSC, Polygon, Avalanche and
//                      Optimism the protocol runs on, capped at +10%.
//
// Hygiene: the board leaves out products of tokens that already trade (names carrying the whole word
// wrapped, staked or staking; names that begin with an exchange's name; the CEX and Canonical Bridge
// categories). Watchlist members are never excluded. Everything else that records no token is ranked.

/** One protocol entry, exactly the ten fields the snapshot carries. */
export interface Proto {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

/** One row of board.json: only what the gate asks for. */
export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

/** A board row with everything the dashboard's board and detail views render. */
export interface RadarRow extends BoardRow {
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  tokenless_years: number | null;
  category_multiple: number;
  momentum_factor: number;
  age_factor: number;
  chain_factor: number;
  watchlist: boolean;
}

/** A protocol whose token already trades: shown for comparison, never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
}

/** One category's derived multiple, as the model panel shows it. */
export interface MultipleRow {
  category: string;
  multiple: number;
  peers: number;
  fallback: boolean;
}

/** Everything data.js hands to the dashboard. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  stats: { scanned: number; ranked: number; watchlist: number; live: number; excluded: number };
  model: {
    formula: string;
    points: string[];
    hygiene: string;
    global_multiple: number;
    multiples: MultipleRow[];
  };
  rows: RadarRow[];
  live: LiveRow[];
}

/** The snapshot is not in the shape this model scores. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const TOP_CHAINS = ['Ethereum', 'Solana', 'Base', 'Arbitrum', 'BSC', 'Polygon', 'Avalanche', 'Optimism'];
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const REPRESENTATION_CATEGORIES = ['Restaked BTC', 'Anchor BTC', 'Stablecoin Wrapper'];
const VERSION_SUFFIX = /\s(v\d+(\.\d+)?|version\s?\d+)$/i;
// Representations and flagship products of tokens that already trade, which the snapshot records
// without a token of their own, so no field gives them away. The bounty rules name the first two
// themselves (WBTC and USDT0 are wrapped/bridged units of tokens that trade); the rest are the
// same shape — wrapped BTC units (FBTC, sBTC, Nexus BTC, ObeliskBTC) and a flagship product of a
// tokenised protocol (CCIP is Chainlink's; LINK trades). This list is hygiene only: the value
// model never reads names. Watchlist members stay exempt from every hygiene rule — the house
// vouched for them and coverage is a gate row (that is why USDD, a watchlist member, stays).
const ALREADY_TRADED_SLUGS = new Set([
  'wbtc', 'usdt0', 'function-fbtc', 'stacks-sbtc', 'nexus-btc', 'obeliskbtc', 'ccip',
]);
const LIVE_COUNT = 120;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round4 = (v: number): number => Math.round(v * 10_000) / 10_000;
const bySlugAsc = (a: Proto, b: Proto): number => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

/** The snapshot out of a file's text, refused unless it carries what the model reads. */
export function parseSnapshot(text: string): Snapshot {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot is not valid JSON');
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) throw new SnapshotError('snapshot is not an object');
  const o = doc as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot has no as_of date');
  if (typeof o.source !== 'string' || o.source.length === 0) throw new SnapshotError('snapshot has no source');
  if (typeof o.floor_usd !== 'number' || !(o.floor_usd > 0)) throw new SnapshotError('snapshot has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot watchlist is not a list of slugs');
  }
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const protocols: Proto[] = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || num(p.tvl_usd) === null) {
      throw new SnapshotError(`protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd as number,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** A protocol records no token when both token fields are null. */
export const recordsNoToken = (p: Proto): boolean => p.gecko_id === null && p.symbol === null;

/**
 * A product of a token that already trades, per the hygiene rules: a wrapped/staked name, an
 * exchange's own name up front, or the CEX / Canonical Bridge categories. Watchlist members are
 * exempt: the house already vouched for them, and coverage is a gate row.
 */
export function isHygieneExcluded(p: Proto, watchlist: Set<string>): boolean {
  if (watchlist.has(p.slug)) return false;
  if (p.category === 'CEX' || p.category === 'Canonical Bridge') return true;
  if (p.category !== null && REPRESENTATION_CATEGORIES.includes(p.category)) return true;
  if (ALREADY_TRADED_SLUGS.has(p.slug)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (VERSION_SUFFIX.test(p.name.trim())) return true;
  return EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The category multiples, derived from the snapshot at runtime: for every category, the median
 * market-cap/TVL of its tokenised peers (market cap and TVL present, TVL above zero), clamped to
 * [0.05, 2.00] and rounded to 4 decimals. Categories with fewer than three peers, and protocols
 * with no category, use the global median computed the same way.
 */
export function deriveMultiples(snapshot: Snapshot): { byCategory: Map<string, MultipleRow>; global: MultipleRow } {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    if (p.category !== null) {
      const list = ratiosByCategory.get(p.category);
      if (list === undefined) ratiosByCategory.set(p.category, [ratio]);
      else list.push(ratio);
    }
  }
  const global: MultipleRow = {
    category: '(all categories)',
    multiple: round4(clamp(median(all), 0.05, 2.0)),
    peers: all.length,
    fallback: false,
  };
  const byCategory = new Map<string, MultipleRow>();
  for (const [category, ratios] of [...ratiosByCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (ratios.length >= 3) {
      byCategory.set(category, { category, multiple: round4(clamp(median(ratios), 0.05, 2.0)), peers: ratios.length, fallback: false });
    } else {
      byCategory.set(category, { category, multiple: global.multiple, peers: ratios.length, fallback: true });
    }
  }
  return { byCategory, global };
}

/** Whole days between two YYYY-MM-DD dates, never negative; null when either side is unusable. */
function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((b - a) / DAY_MS));
}

/** How long the protocol has run with no token, in years; null when DefiLlama names no start date. */
export function tokenlessYears(snapshot: Snapshot, p: Proto): number | null {
  if (p.listed_at === null) return null;
  const days = daysBetween(p.listed_at, snapshot.as_of);
  return days === null ? null : days / 365.25;
}

/** Momentum from the 7-day TVL change, which the snapshot states in per cent. */
export function momentumFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  return clamp(1 + change7d / 100, 0.7, 1.3);
}

/** Maturity from tokenless age: +7% a year off a 0.85 base, clamped to [0.85, 1.25]. */
export function ageFactor(years: number | null): number {
  if (years === null) return 1;
  return clamp(0.85 + 0.07 * years, 0.85, 1.25);
}

/** Chain breadth: +2% per top-tier chain the protocol runs on, capped at +10%. */
export function chainFactor(chains: string[]): number {
  const hits = new Set(chains.filter((c) => TOP_CHAINS.includes(c))).size;
  return Math.min(1 + 0.02 * hits, 1.1);
}

/** Round to the nearest thousand, with a $1,000 floor so every ranked protocol carries a real figure. */
function roundToThousand(v: number): number {
  return Math.max(1000, Math.round(v / 1000) * 1000);
}

// ---------------------------------------------------------------------------
// Farm playbooks. Every ranked protocol gets five steps: set up, the category's core action, a
// cadence to keep, a points or quests step, and an exit discipline. The wording is interpolated
// with the protocol's own name, primary chain, TVL tier and age, and one of three phrasings per
// shared step is picked by a hash of the slug, so neighbouring rows do not read as one stamp.
// ---------------------------------------------------------------------------

/** What a playbook step may say about one protocol. */
interface FarmCtx {
  name: string;
  chain: string;
  amount: number;
  gas: string;
  weeks: number;
  variant: number;
  tier: number;
}

/** A small stable hash of the slug, so each row deterministically picks its own phrasing. */
function slugHash(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** The gas a farmer should expect on a chain, in words a budget can use. */
function gasPhrase(chain: string): string {
  if (chain === 'Ethereum') return 'gas on Ethereum runs about $5-15 per transaction, so batch actions and avoid peak hours';
  if (chain === 'Solana') return 'gas on Solana is about $0.01 per transaction, so cost is no excuse for inactivity';
  if (['Base', 'Arbitrum', 'Optimism', 'Polygon', 'BSC', 'Avalanche', 'zkSync Era', 'Linea', 'Scroll', 'Mantle', 'Blast', 'Mode'].includes(chain)) {
    return `gas on ${chain} runs about $0.10-$1 per transaction, cheap enough for a weekly rhythm`;
  }
  return `gas on ${chain} is usually a few cents to about $1 per transaction`;
}

/** The starter position for a farm, scaled by the protocol's own TVL tier. */
function tierAmount(tvl: number): { amount: number; tier: number } {
  if (tvl >= 1_000_000_000) return { amount: 500, tier: 3 };
  if (tvl >= 250_000_000) return { amount: 350, tier: 2 };
  if (tvl >= 50_000_000) return { amount: 250, tier: 1 };
  return { amount: 100, tier: 0 };
}

/** How many weeks of activity to plan: younger protocols get the longer qualifying window. */
function planWeeks(years: number | null): number {
  if (years === null) return 8;
  if (years < 1) return 10;
  if (years < 3) return 8;
  return 6;
}

function setupStep(c: FarmCtx): string {
  const v = [
    `Set up a fresh wallet used only for farming ${c.name}, and keep its seed phrase offline. Fund it on ${c.chain} with about $${c.amount} in stablecoins plus the chain's gas token; ${c.gas}. Setup takes about 10 minutes.`,
    `Create a dedicated wallet for ${c.name} so the farm is easy to track and easy to unwind. Move roughly $${c.amount} of working capital onto ${c.chain} and leave a gas buffer on top; ${c.gas}. Allow 10 minutes.`,
    `Use a clean wallet, not the one holding your savings, and load it on ${c.chain} with around $${c.amount} in stablecoins and a little of the native token for fees; ${c.gas}. Ten minutes of setup, once.`,
  ];
  return v[c.variant % v.length]!;
}

function cadenceStep(c: FarmCtx, action: string): string {
  const split =
    c.tier >= 2
      ? `Split the $${c.amount} into two or three tranches a few days apart rather than one deposit, so your activity spans several weekly snapshots.`
      : `One deposit is fine at this size; what matters is that the position is live every week, not that it is large.`;
  const v = [
    `Keep a rhythm for ${c.weeks} weeks: ${action} two or three times a week, about 10 minutes a session. ${split}`,
    `For the next ${c.weeks} weeks, ${action} two or three times a week in short 10-minute sessions. ${split}`,
    `Plan on ${c.weeks} weeks of light activity: ${action} two or three times a week, roughly 10 minutes each time. ${split}`,
  ];
  return v[c.variant % v.length]!;
}

function closingStep(c: FarmCtx): string {
  const v = [
    `Follow ${c.name}'s official announcements and hold the position until a snapshot or token generation event is announced. When a claim opens, use only the link in that announcement, claim inside the window, and never pay anyone to "unlock" a claim.`,
    `Hold through the programme rather than dipping in and out: most points systems reward the wallets still present at the snapshot. Watch ${c.name}'s official channels, and when a claim window opens, act inside it and ignore look-alike claim sites.`,
    `Stay in until ${c.name} announces a snapshot, a token or the end of the programme. Keep a simple log of dates and transaction hashes, claim only from the official announcement when the window opens, and treat every unsolicited claim link as a scam.`,
  ];
  return v[c.variant % v.length]!;
}

/** A playbook: the core action (step 2), the cadence's verb phrase, and a points/quests step (step 4). */
interface Playbook {
  core: (c: FarmCtx) => string;
  cadenceAction: string;
  extra: (c: FarmCtx) => string;
}

const PLAYBOOKS: Record<string, Playbook> = {
  Dexs: {
    core: (c) => `Provide about $${c.amount} of liquidity to ${c.name}'s deepest stablecoin or blue-chip pair on ${c.chain}, in range if it is a concentrated pool. A two-sided position in a busy pair earns both fees and the activity record that points programmes count.`,
    cadenceAction: 'swap a small amount through the exchange and check your pool range',
    extra: (c) => `Route your swaps through ${c.name}'s own interface rather than an aggregator: front-end attribution is usually what a points programme records, and volume through the native UI is the cheapest signal you can send.`,
  },
  Lending: {
    core: (c) => `Supply about $${c.amount} of USDC or ETH to ${c.name} on ${c.chain} as collateral. If you borrow, keep it small and safe: borrow no more than half the supplied value and re-supply the borrowed asset only if the market pays you to loop.`,
    cadenceAction: 'top up collateral or adjust the borrow so the health factor stays comfortable',
    extra: (c) => `Keep the position's health factor above 1.8 and set a price alert on your collateral asset. A liquidation wipes out months of farming in one candle, and ${c.name} will not warn you before it happens.`,
  },
  Bridge: {
    core: (c) => `Bridge about $${c.amount} from ${c.chain} to two or three destination chains ${c.name} serves, then actually use the funds on arrival: a swap, a deposit, a day or two of activity. A bridge hop with nothing behind it is the weakest signal there is.`,
    cadenceAction: 'bridge a small amount to a different destination chain and use it there',
    extra: (c) => `Vary routes, amounts and times of day so your history reads as real usage, and try the testnet or intent-based route if ${c.name} runs one: early testnet users are often named in retroactive programmes.`,
  },
  'Liquid Staking': {
    core: (c) => `Stake about $${c.amount} of the chain's native asset through ${c.name} on ${c.chain} and keep the liquid staking token it issues. The position earns staking yield while it waits, which makes this the cheapest farm on the board to hold.`,
    cadenceAction: 'check the staking token is still in your wallet and add a little on dips if you can',
    extra: (c) => `Put the liquid token to light work in one partner money market or pool that ${c.name} lists as an integration, but keep most of it plain in the wallet: at snapshot time, the simplest holding is the easiest to count.`,
  },
  'Liquid Restaking': {
    core: (c) => `Deposit about $${c.amount} of liquid staking tokens into ${c.name} on ${c.chain} and pick the default operator set rather than chasing the highest advertised multiplier. Restaking points usually accrue per dollar per day, so time in beats size.`,
    cadenceAction: 'check your points balance and the operator set you are delegated to',
    extra: (c) => `Read the slashing terms before you add anything more: restaking adds operator risk on top of staking risk. Keep a note of which services your deposit secures, and prefer the assets with the deepest exit liquidity.`,
  },
  Yield: {
    core: (c) => `Deposit about $${c.amount} into ${c.name}'s flagship vault or strategy on ${c.chain}. Pick the vault whose underlying you understand; a boring stablecoin strategy held for ${c.weeks} weeks beats a exotic one you abandon in week two.`,
    cadenceAction: 'check the vault share price and that your deposit is still in the intended strategy',
    extra: (c) => `When ${c.name} opens a new vault, move a small slice (10-20%) into it in its first days: early depositors are frequently boosted in points programmes, and new-vault cohorts are easy for a snapshot to identify.`,
  },
  RWA: {
    core: (c) => `Subscribe about $${c.amount} to ${c.name}'s tokenised treasury or credit product on ${c.chain}. Complete the KYC or eligibility check if the product asks for one; for real-world-asset products that step is often part of the record that later programmes reward.`,
    cadenceAction: 'confirm the yield accrual posted and your position is still eligible',
    extra: (c) => `Hold through at least one full yield or interest cycle rather than redeeming early: RWA programmes measure duration, and a position that survives a whole cycle is a different signal from a weekend park.`,
  },
  Derivatives: {
    core: (c) => `Deposit about $${c.amount} of margin on ${c.name} and trade small: one modest position at a time, sized so a bad week costs you at most a tenth of the farm budget. The farm is the trading record, not the profit.`,
    cadenceAction: 'place two or three small trades and close them cleanly',
    extra: (c) => `If ${c.name} publishes a points or volume-tier programme, pace your volume to reach the next tier without forcing it in one day. Never chase a tier with size you cannot afford to lose; a blown account farms nothing.`,
  },
  CDP: {
    core: (c) => `Deposit about $${c.amount} of collateral into ${c.name} on ${c.chain} and mint its stablecoin against it at a conservative ratio, then park the minted stablecoin in the protocol's own stability or savings pool so both sides of the position are working.`,
    cadenceAction: 'check the collateral ratio and top it up if the market moved against you',
    extra: (c) => `Keep the collateral ratio at or above 200% and set an alert well before the liquidation line. On ${c.name} the minted position only counts while it is alive, and CDP liquidations are unforgiving in a fast market.`,
  },
  Payments: {
    core: (c) => `Open a ${c.name} account, complete its verification, and route about $${c.amount} of real spending through it over the coming weeks: a card, a transfer rail or a checkout, whichever the product is. Usage, not deposits, is the product here.`,
    cadenceAction: 'make two or three ordinary payments through it, the way you would pay anyway',
    extra: (c) => `Set up one recurring payment, such as a subscription or a monthly bill, so the account shows durable usage rather than a burst. If ${c.name} runs quests on Galxe or a similar board, clear those too; they are cheap and dated.`,
  },
  NFT: {
    core: (c) => `Use ${c.name} on ${c.chain} the way a collector would: buy one floor piece from a collection you can resell, list one item of your own, and hold about $${c.amount} of total exposure rather than flipping in and out daily.`,
    cadenceAction: 'make one genuine trade or adjust one listing',
    extra: (c) => `Never wash-trade between your own wallets: marketplaces filter it and it can disqualify the wallet entirely. If ${c.name} runs a seasonal campaign or mint, one participation is worth more than a month of fake volume.`,
  },
  Gaming: {
    core: (c) => `Create a ${c.name} account, link your wallet, and play the live season on ${c.chain}: buy the small starter pack or battle pass (usually $10-30 of the $${c.amount} budget) and finish the tutorial quests so the account is a real player, not a signup.`,
    cadenceAction: 'clear the daily and weekly quests in two or three short sessions',
    extra: (c) => `Finish the current season's quest line and any Galxe campaign ${c.name} runs alongside it. Game programmes snapshot player progression, so a finished quest chain outweighs raw hours logged.`,
  },
  'Risk Curators': {
    core: (c) => `Deposit about $${c.amount} into a ${c.name} vault on ${c.chain} whose strategy you can actually read end to end. Curator vaults differ mainly in what they will lend against; pick the one whose collateral list you would defend, not the highest APY.`,
    cadenceAction: 'read the vault\'s allocation update and confirm your deposit is where you think it is',
    extra: (c) => `Split a second, smaller deposit into a different curator's vault if ${c.name} hosts several: curator programmes tend to reward depositors per vault, and diversification also caps the damage if one strategy sours.`,
  },
  'Leveraged Farming': {
    core: (c) => `Open a small leveraged position on ${c.name} on ${c.chain}: about $${c.amount} of equity at no more than 3x on a stable or blue-chip pair. Leverage is the product and the risk; the farm is the open position, held and managed, not a maxed-out bet.`,
    cadenceAction: 'check the liquidation price and rebalance or add margin if it crept closer',
    extra: (c) => `Keep a reserve of stablecoins in the same wallet to top up margin, and write down your liquidation price where you will see it weekly. On ${c.name}, positions that survive a full programme are the ones still open at the snapshot.`,
  },
  Launchpad: {
    core: (c) => `Register on ${c.name}, complete KYC early (sales do not wait for verification queues), and stake or hold whatever qualifying asset it names so your account is eligible before the next sale opens. Keep about $${c.amount} ready for a small allocation.`,
    cadenceAction: 'check the upcoming sales calendar and your eligibility tier',
    extra: (c) => `Take one small allocation when a sale you understand opens, and hold the tokens it distributes rather than flipping on day one: launchpads track post-sale behaviour when they design loyalty and points programmes.`,
  },
  Services: {
    core: (c) => `Buy the service ${c.name} actually sells, at about $${c.amount} of real usage over the programme: credits, capacity, fees or subscription, whichever applies. For a services protocol the usage receipt is the farm; there is no vault to hide in.`,
    cadenceAction: 'use the service for something real and keep the receipt or invoice',
    extra: (c) => `If ${c.name} runs a referral or ambassador programme, take the referral link and bring one genuine user rather than ten sock-puppets: services programmes audit for self-referral and void the whole chain.`,
  },
};

const DEFAULT_PLAYBOOK: Playbook = {
  core: (c) => `Deposit about $${c.amount} into ${c.name}'s main product on ${c.chain} and keep the position open: whatever the protocol counts (a balance, a share, a position NFT), hold the plain version of it in this wallet rather than wrapping it elsewhere.`,
  cadenceAction: 'make one small deposit, vote or interaction so the week shows activity',
  extra: (c) => `Open ${c.name}'s points, rewards or governance page if it has one and do the cheap dated things first: a forum signup, a governance vote, a quest board entry. Small dated actions are what later eligibility checks can actually verify.`,
};

/** Categories that read better with a neighbour's playbook than with the default. */
const PLAYBOOK_ALIASES: Record<string, string> = {
  'Yield Aggregator': 'Yield',
  'Cross Chain Bridge': 'Bridge',
  'Uncollateralized Lending': 'Lending',
  'CDP Manager': 'CDP',
  'Interest Rate Derivatives': 'Derivatives',
  'NFT Marketplace': 'NFT',
  Restaking: 'Liquid Restaking',
  'Staking Pool': 'Liquid Staking',
  Farm: 'Yield',
  'Onchain Capital Allocator': 'Risk Curators',
};

function playbookFor(category: string | null): Playbook {
  if (category !== null) {
    const direct = PLAYBOOKS[category];
    if (direct !== undefined) return direct;
    const alias = PLAYBOOK_ALIASES[category];
    if (alias !== undefined) return PLAYBOOKS[alias]!;
  }
  return DEFAULT_PLAYBOOK;
}

/** A protocol's five farm steps, built from its own record. */
export function farmSteps(p: Proto, years: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its home chain';
  const { amount, tier } = tierAmount(p.tvl_usd);
  const ctx: FarmCtx = {
    name: p.name,
    chain,
    amount,
    gas: gasPhrase(chain),
    weeks: planWeeks(years),
    variant: slugHash(p.slug) % 3,
    tier,
  };
  const book = playbookFor(p.category);
  return [setupStep(ctx), book.core(ctx), cadenceStep(ctx, book.cadenceAction), book.extra(ctx), closingStep(ctx)];
}

// ---------------------------------------------------------------------------
// Board assembly.
// ---------------------------------------------------------------------------

const MODEL_FORMULA =
  'Implied value = TVL x category multiple x momentum x maturity x chain breadth, rounded to the nearest $1,000 (minimum $1,000).';

const MODEL_POINTS = [
  'Category multiple: the median market cap / TVL of the tokenised protocols in the same DefiLlama category in this snapshot, clamped to 0.05-2.00. A category with fewer than three tokenised peers uses the all-category median instead, so no multiple is ever a guess at one protocol.',
  'Momentum: 1 + (7-day TVL change in per cent / 100), clamped to 0.70-1.30. The snapshot states the change in per cent (its median protocol moved -6.8 in the week); a protocol with no reported change scores a neutral 1.00.',
  'Maturity: 0.85 + 0.07 for each year the protocol has run with no token, measured from DefiLlama\'s listed_at date to the snapshot date, clamped to 0.85-1.25. No listing date scores a neutral 1.00.',
  'Chain breadth: +2% for each of Ethereum, Solana, Base, Arbitrum, BSC, Polygon, Avalanche and Optimism the protocol runs on, capped at +10%.',
  'No protocol name is an input. The same arithmetic scores every row, and the multiples are recomputed from the snapshot on every run.',
];

const HYGIENE_NOTE =
  'Off the board, by hygiene: names carrying the whole word wrapped, staked or staking, names ending in a version marker, names beginning with an exchange\'s name (Binance, Coinbase, Bybit, Kraken, Bitget, OKX, Bitfinex, Gemini), the CEX, Canonical Bridge, Restaked BTC, Anchor BTC and Stablecoin Wrapper categories, and the known representations of tokens that already trade (WBTC, USDT0, FBTC, sBTC and their kin, Chainlink\'s CCIP). Those are products of tokens that already trade, not launches still to come. Watchlist members are never excluded.';

interface Scored {
  p: Proto;
  years: number | null;
  multiple: number;
  momentum: number;
  age: number;
  chain: number;
  implied: number;
}

/** Score one no-token protocol under the model. */
function score(snapshot: Snapshot, p: Proto, multiple: number): Scored {
  const years = tokenlessYears(snapshot, p);
  // Each factor is rounded to 4 decimals before use, so the figures the dashboard publishes are
  // exactly the figures that produced the value: a reader can multiply them and land on the row.
  const momentum = round4(momentumFactor(p.change_7d));
  const age = round4(ageFactor(years));
  const chain = round4(chainFactor(p.chains));
  const implied = roundToThousand(p.tvl_usd * multiple * momentum * age * chain);
  return { p, years, multiple, momentum, age, chain, implied };
}

/** Build the board, the dashboard data and the live comparison set from one snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const watchlist = new Set(snapshot.watchlist);
  const { byCategory, global } = deriveMultiples(snapshot);
  const multipleOf = (p: Proto): number => {
    if (p.category === null) return global.multiple;
    const row = byCategory.get(p.category);
    return row === undefined ? global.multiple : row.multiple;
  };

  const universe = snapshot.protocols.filter(recordsNoToken);
  const rankedProtocols = universe.filter((p) => !isHygieneExcluded(p, watchlist));
  const scored = rankedProtocols.map((p) => score(snapshot, p, multipleOf(p)));
  scored.sort(
    (a, b) =>
      b.implied - a.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );

  const rows: RadarRow[] = scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    rank: i + 1,
    implied_value_usd: s.implied,
    farm_steps: farmSteps(s.p, s.years),
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    tokenless_years: s.years === null ? null : round4(s.years),
    category_multiple: s.multiple,
    momentum_factor: round4(s.momentum),
    age_factor: round4(s.age),
    chain_factor: round4(s.chain),
    watchlist: watchlist.has(s.p.slug),
  }));

  const board: BoardRow[] = rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
  }));

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.mcap_usd !== null)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || b.tvl_usd - a.tvl_usd || bySlugAsc(a, b))
    .slice(0, LIVE_COUNT)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
    }));

  // The model panel lists every multiple the run actually used: the categories of ranked rows.
  const usedCategories = new Set(rows.map((r) => r.category));
  const multiples: MultipleRow[] = [...byCategory.values()]
    .filter((m) => usedCategories.has(m.category))
    .sort((a, b) => (a.category < b.category ? -1 : 1));
  if (rows.some((r) => r.category === null)) {
    multiples.push({ category: '(no category)', multiple: global.multiple, peers: global.peers, fallback: true });
  }

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    stats: {
      scanned: snapshot.protocols.length,
      ranked: rows.length,
      watchlist: snapshot.watchlist.length,
      live: live.length,
      excluded: universe.length - rows.length,
    },
    model: {
      formula: MODEL_FORMULA,
      points: MODEL_POINTS,
      hygiene: HYGIENE_NOTE,
      global_multiple: global.multiple,
      multiples,
    },
    rows,
    live,
  };
  return { board, radar };
}

/** Why a board fails the gate's shape, or null when it passes: coverage, ranks, order, spread, steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100-4000`;
  const slugs = new Set<string>();
  for (const r of board) {
    if (slugs.has(r.slug)) return `slug ${r.slug} appears twice`;
    slugs.add(r.slug);
  }
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `slug ${r.slug} is not in the snapshot`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < byRank.length; i++) {
    if (byRank[i]!.rank !== i + 1) return `rank ${i + 1} is held by ${byRank[i]!.slug} with rank ${byRank[i]!.rank}`;
    if (i > 0 && byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) {
      return `${byRank[i]!.slug} outranks ${byRank[i - 1]!.slug} on implied value`;
    }
  }
  if (board.length >= 2 && board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) {
    return 'every row carries the same implied value';
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `${r.slug} has a farm step of ${len} characters`;
    }
  }
  return null;
}

/** data.js: the dashboard's dataset as one script assignment, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
