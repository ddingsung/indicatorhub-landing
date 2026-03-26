/**
 * Aggregator — collects raw liquidation events and organises them into
 * time-bucketed, price-bucketed heatmap data.
 *
 * Timeframe config
 * ─────────────────
 * key   │ interval (min) │ max time-buckets
 * ──────┼────────────────┼─────────────────
 * 5m    │       5        │     288
 * 15m   │      15        │     192
 * 1h    │      60        │     168
 * 4h    │     240        │     180
 * 1d    │    1440        │      30
 *
 * Price-bucket width
 * ──────────────────
 * width = round-to-nearest-5( price × 0.0005 ), minimum 5
 * priceKey = Math.floor(price / width) * width
 *
 * Eviction rules
 * ──────────────
 * - Time buckets: oldest removed when count exceeds max.
 * - Price levels: lowest total volume (long+short) removed when count > 200.
 */

const TIMEFRAMES = {
  '12h': { intervalMs:  5 * 60 * 1000, maxBuckets: 144 },   // 5min buckets × 144 = 12h
  '24h': { intervalMs: 15 * 60 * 1000, maxBuckets:  96 },   // 15min buckets × 96 = 24h
};

const MAX_PRICE_LEVELS = 200;

/**
 * Round `value` to the nearest multiple of `step`.
 */
function roundToNearest(value, step) {
  return Math.round(value / step) * step;
}

/**
 * Compute the price-bucket width for a given price.
 * width = round-to-nearest-5(price × 0.0005), minimum 5.
 */
function priceBucketWidth(price) {
  const raw = price * 0.0005;          // 0.05 % of price
  const rounded = roundToNearest(raw, 5);
  return Math.max(5, rounded);
}

/**
 * Return the canonical price-bucket key (lower bound of bucket as a number).
 */
function getPriceKey(price) {
  const width = priceBucketWidth(price);
  return Math.floor(price / width) * width;
}

/**
 * Evict price levels with the smallest total volume until count ≤ MAX_PRICE_LEVELS.
 *
 * @param {Object} priceLevels  – { [priceKey]: { long, short } }
 */
function evictPriceLevels(priceLevels) {
  const keys = Object.keys(priceLevels);
  if (keys.length <= MAX_PRICE_LEVELS) return;

  // Sort ascending by total volume; evict from the front
  keys.sort((a, b) => {
    const volA = priceLevels[a].long + priceLevels[a].short;
    const volB = priceLevels[b].long + priceLevels[b].short;
    return volA - volB;
  });

  const toRemove = keys.length - MAX_PRICE_LEVELS;
  for (let i = 0; i < toRemove; i++) {
    delete priceLevels[keys[i]];
  }
}

export class Aggregator {
  constructor() {
    /**
     * Storage layout:
     * _data[symbol][timeframe] = Map<bucketTime, { time, priceLevels }>
     * (Map preserves insertion order, making oldest-first eviction O(1).)
     */
    this._data = {};
  }

  /**
   * Add a single liquidation event.
   *
   * @param {string} symbol
   * @param {{ side: 'long'|'short', price: number, quantity: number, timestamp: number }} event
   */
  addLiquidation(symbol, { side, price, quantity, timestamp }) {
    if (!this._data[symbol]) {
      this._data[symbol] = {};
      for (const tf of Object.keys(TIMEFRAMES)) {
        this._data[symbol][tf] = new Map();
      }
    }

    const priceKey = getPriceKey(price);

    for (const [tf, { intervalMs, maxBuckets }] of Object.entries(TIMEFRAMES)) {
      const bucketTime = Math.floor(timestamp / intervalMs) * intervalMs;
      const tfMap = this._data[symbol][tf];

      if (!tfMap.has(bucketTime)) {
        // Evict oldest time bucket if we would exceed the limit
        if (tfMap.size >= maxBuckets) {
          const oldestKey = tfMap.keys().next().value;
          tfMap.delete(oldestKey);
        }
        tfMap.set(bucketTime, { time: bucketTime, priceLevels: {} });
      }

      const bucket = tfMap.get(bucketTime);
      const pl = bucket.priceLevels;

      if (!pl[priceKey]) {
        pl[priceKey] = { long: 0, short: 0 };
      }

      if (side === 'long') {
        pl[priceKey].long += quantity;
      } else {
        pl[priceKey].short += quantity;
      }

      evictPriceLevels(pl);
    }
  }

  /**
   * Return heatmap data for a given symbol and timeframe.
   *
   * @param {string} symbol
   * @param {string} timeframe  – one of '5m', '15m', '1h', '4h', '1d'
   * @returns {{ symbol: string, timeframe: string, buckets: Array }}
   */
  getHeatmapData(symbol, timeframe) {
    const empty = { symbol, timeframe, buckets: [] };

    if (!this._data[symbol]) return empty;
    if (!this._data[symbol][timeframe]) return empty;

    const buckets = Array.from(this._data[symbol][timeframe].values());
    return { symbol, timeframe, buckets };
  }
}
