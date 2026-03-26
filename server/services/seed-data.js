/**
 * Seed data generator
 * Generates realistic Coinglass-style liquidation data across the full candle history.
 * Uses actual price history to place liquidation clusters at realistic levels.
 */

import { fetchCandles } from './candle-feed.js';

/**
 * Find swing highs and lows from candle data — these become support/resistance levels.
 */
function findSwingLevels(candles) {
  const levels = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const prev2 = candles[i - 2], prev1 = candles[i - 1];
    const curr = candles[i];
    const next1 = candles[i + 1], next2 = candles[i + 2];

    // Swing high
    if (curr.high > prev1.high && curr.high > prev2.high &&
        curr.high > next1.high && curr.high > next2.high) {
      levels.push({ price: curr.high, type: 'resistance', time: curr.time, strength: 1 });
    }
    // Swing low
    if (curr.low < prev1.low && curr.low < prev2.low &&
        curr.low < next1.low && curr.low < next2.low) {
      levels.push({ price: curr.low, type: 'support', time: curr.time, strength: 1 });
    }
  }

  // Add round number levels within price range
  const minP = Math.min(...candles.map(c => c.low));
  const maxP = Math.max(...candles.map(c => c.high));
  const step = 500; // round number interval for BTC
  for (let p = Math.floor(minP / step) * step; p <= maxP; p += step) {
    levels.push({ price: p, type: 'round', time: 0, strength: 0.5 });
  }

  return levels;
}

/**
 * Generate seed liquidation events and inject them into the aggregator.
 *
 * Strategy:
 * - Fetch actual candle history to get realistic price path
 * - Find swing highs/lows as support/resistance levels
 * - Generate liquidation events clustered around these levels
 * - More events when price is near a level (cascade simulation)
 * - Events span the full candle history (7 days for 1h)
 * - 8000+ events for dense, Coinglass-like coverage
 */
export async function seedHeatmapData(aggregator, symbol = 'BTCUSDT') {
  let candles;
  try {
    candles = await fetchCandles(symbol, '5m', 288);  // 24h of 5min candles
  } catch (e) {
    console.warn('[Seed] Could not fetch candles, skipping seed:', e.message);
    return;
  }

  if (!candles || candles.length < 10) {
    console.warn('[Seed] Not enough candle data');
    return;
  }

  const currentPrice = candles[candles.length - 1].close;
  console.log(`[Seed] Generating dummy data from ${candles.length} candles around $${currentPrice.toFixed(0)}`);

  const levels = findSwingLevels(candles);
  const now = Date.now();
  const EVENT_COUNT = 100;
  let injected = 0;

  // Pre-compute candle ranges for efficient lookup
  const candleData = candles.map((c, idx) => {
    const next = idx < candles.length - 1 ? candles[idx + 1].time : now;
    const range = c.high - c.low;
    const velocity = range / c.close; // normalized volatility
    return { ...c, nextTime: next, range, velocity };
  });

  for (let i = 0; i < EVENT_COUNT; i++) {
    // Pick a candle — bias towards recent and volatile candles
    const candleIdx = pickCandle(candleData);
    const candle = candleData[candleIdx];

    // Timestamp within this candle's window
    const timestamp = candle.time + Math.random() * (candle.nextTime - candle.time);

    // Generate price
    let price;
    const r = Math.random();

    if (r < 0.55) {
      // 55% — cluster around a support/resistance level
      const level = pickNearbyLevel(levels, candle.close, candle.range * 3);
      if (level) {
        // Scatter around the level (±0.15% of price)
        price = level.price + (Math.random() - 0.5) * candle.close * 0.003;
      } else {
        price = candle.low + Math.random() * candle.range;
      }
    } else if (r < 0.80) {
      // 25% — within the candle's wicks (just beyond body, where stops sit)
      const bodyHigh = Math.max(candle.open, candle.close);
      const bodyLow  = Math.min(candle.open, candle.close);
      if (Math.random() < 0.5) {
        // Above body — short liquidation zone
        price = bodyHigh + Math.random() * (candle.high - bodyHigh) * 1.5;
      } else {
        // Below body — long liquidation zone
        price = bodyLow - Math.random() * (bodyLow - candle.low) * 1.5;
      }
    } else {
      // 20% — scattered across wider range (±1.5% from close)
      price = candle.close + (Math.random() - 0.5) * candle.close * 0.03;
    }

    // Side: longs below close, shorts above (with some noise)
    const belowClose = price < candle.close;
    const side = belowClose
      ? (Math.random() < 0.75 ? 'long' : 'short')
      : (Math.random() < 0.75 ? 'short' : 'long');

    // Quantity: power-law with bigger events during volatile candles
    const u = Math.random();
    const volMultiplier = 1 + candle.velocity * 50; // volatile candles → bigger liquidations
    const quantity = (0.5 + Math.pow(u, 2) * 30) * volMultiplier;

    aggregator.addLiquidation(symbol, {
      side,
      price,
      quantity: parseFloat(quantity.toFixed(4)),
      timestamp: Math.floor(timestamp),
    });
    injected++;
  }

  console.log(`[Seed] Injected ${injected} dummy liquidation events across ${candles.length} candle periods`);
}

/**
 * Pick a candle index, biased toward recent and volatile candles.
 */
function pickCandle(candles) {
  // Combine recency bias with volatility bias
  const n = candles.length;
  // Recency: quadratic bias towards recent
  const recencyIdx = Math.floor(Math.pow(Math.random(), 0.7) * n);
  // Map so higher index = more recent
  const idx = n - 1 - recencyIdx;

  // Sometimes pick a volatile candle instead
  if (Math.random() < 0.3) {
    // Find a candle with above-average volatility
    const avgVel = candles.reduce((s, c) => s + c.velocity, 0) / n;
    const volatile = candles
      .map((c, i) => ({ i, v: c.velocity }))
      .filter(x => x.v > avgVel * 1.5);
    if (volatile.length > 0) {
      return volatile[Math.floor(Math.random() * volatile.length)].i;
    }
  }

  return Math.max(0, Math.min(n - 1, idx));
}

/**
 * Pick a support/resistance level near the given price.
 */
function pickNearbyLevel(levels, refPrice, maxDist) {
  const nearby = levels.filter(l =>
    Math.abs(l.price - refPrice) < maxDist
  );
  if (nearby.length === 0) return null;

  // Weight by proximity and strength
  const weights = nearby.map(l => {
    const dist = Math.abs(l.price - refPrice);
    return (1 - dist / maxDist) * (0.5 + l.strength);
  });
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < nearby.length; i++) {
    r -= weights[i];
    if (r <= 0) return nearby[i];
  }
  return nearby[nearby.length - 1];
}
