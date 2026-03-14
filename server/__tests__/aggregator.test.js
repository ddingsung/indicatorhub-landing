/**
 * Unit tests for server/services/aggregator.js
 *
 * Runner: node --test  (Node.js built-in test runner)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Aggregator } from '../services/aggregator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a timestamp aligned to a 5-minute boundary. */
function ts5m(offsetBuckets = 0) {
  const bucketMs = 5 * 60 * 1000;
  const base = Math.floor(Date.now() / bucketMs) * bucketMs;
  return base + offsetBuckets * bucketMs;
}

// ---------------------------------------------------------------------------
// Test: adding a long liquidation
// ---------------------------------------------------------------------------
test('addLiquidation – long side stored correctly', () => {
  const agg = new Aggregator();
  const timestamp = ts5m(0);

  agg.addLiquidation('BTCUSDT', { side: 'long', price: 50000, quantity: 1.5, timestamp });

  const { buckets } = agg.getHeatmapData('BTCUSDT', '5m');
  assert.equal(buckets.length, 1);

  const pl = Object.values(buckets[0].priceLevels);
  assert.equal(pl.length, 1);
  assert.equal(pl[0].long, 1.5);
  assert.equal(pl[0].short, 0);
});

// ---------------------------------------------------------------------------
// Test: adding a short liquidation
// ---------------------------------------------------------------------------
test('addLiquidation – short side stored correctly', () => {
  const agg = new Aggregator();
  const timestamp = ts5m(0);

  agg.addLiquidation('ETHUSDT', { side: 'short', price: 3000, quantity: 2, timestamp });

  const { buckets } = agg.getHeatmapData('ETHUSDT', '5m');
  assert.equal(buckets.length, 1);

  const pl = Object.values(buckets[0].priceLevels);
  assert.equal(pl[0].short, 2);
  assert.equal(pl[0].long, 0);
});

// ---------------------------------------------------------------------------
// Test: accumulating multiple liquidations in the same price bucket
// ---------------------------------------------------------------------------
test('addLiquidation – accumulates quantities in same price bucket', () => {
  const agg = new Aggregator();
  const timestamp = ts5m(0);

  // These two prices should fall into the same bucket for BTC (~50 000).
  // Width = round5(50000 × 0.0005) = round5(25) = 25
  // priceKey for 50010 = floor(50010/25)*25 = 50000
  // priceKey for 50020 = floor(50020/25)*25 = 50000  ← same bucket
  agg.addLiquidation('BTCUSDT', { side: 'long',  price: 50010, quantity: 1, timestamp });
  agg.addLiquidation('BTCUSDT', { side: 'long',  price: 50020, quantity: 2, timestamp });
  agg.addLiquidation('BTCUSDT', { side: 'short', price: 50010, quantity: 0.5, timestamp });

  const { buckets } = agg.getHeatmapData('BTCUSDT', '5m');
  assert.equal(buckets.length, 1);

  const pl = buckets[0].priceLevels;
  const key = Object.keys(pl)[0];   // should be a single price level key

  assert.equal(Object.keys(pl).length, 1);
  assert.equal(pl[key].long, 3);
  assert.equal(pl[key].short, 0.5);
});

// ---------------------------------------------------------------------------
// Test: separate price buckets when prices differ enough
// ---------------------------------------------------------------------------
test('addLiquidation – different prices land in separate price buckets', () => {
  const agg = new Aggregator();
  const timestamp = ts5m(0);

  // Width for BTC ~50000 is 25; 50000 and 50050 are in different buckets.
  agg.addLiquidation('BTCUSDT', { side: 'long', price: 50000, quantity: 1, timestamp });
  agg.addLiquidation('BTCUSDT', { side: 'long', price: 50050, quantity: 2, timestamp });

  const { buckets } = agg.getHeatmapData('BTCUSDT', '5m');
  assert.equal(buckets.length, 1);
  assert.equal(Object.keys(buckets[0].priceLevels).length, 2);
});

// ---------------------------------------------------------------------------
// Test: data is separate per symbol
// ---------------------------------------------------------------------------
test('getHeatmapData – symbols are independent', () => {
  const agg = new Aggregator();
  const timestamp = ts5m(0);

  agg.addLiquidation('BTCUSDT', { side: 'long',  price: 50000, quantity: 1, timestamp });
  agg.addLiquidation('ETHUSDT', { side: 'short', price:  3000, quantity: 5, timestamp });

  const btc = agg.getHeatmapData('BTCUSDT', '5m');
  const eth = agg.getHeatmapData('ETHUSDT', '5m');

  assert.equal(btc.buckets.length, 1);
  assert.equal(eth.buckets.length, 1);

  const btcPl = Object.values(btc.buckets[0].priceLevels)[0];
  const ethPl = Object.values(eth.buckets[0].priceLevels)[0];

  assert.equal(btcPl.long, 1);
  assert.equal(ethPl.short, 5);
});

// ---------------------------------------------------------------------------
// Test: empty result for unknown symbol
// ---------------------------------------------------------------------------
test('getHeatmapData – unknown symbol returns empty buckets', () => {
  const agg = new Aggregator();
  const result = agg.getHeatmapData('XYZUSDT', '5m');

  assert.deepEqual(result, { symbol: 'XYZUSDT', timeframe: '5m', buckets: [] });
});

// ---------------------------------------------------------------------------
// Test: data separation by timeframe (same event appears in all timeframes)
// ---------------------------------------------------------------------------
test('addLiquidation – event appears in all timeframes', () => {
  const agg = new Aggregator();
  const timestamp = ts5m(0);

  agg.addLiquidation('BTCUSDT', { side: 'long', price: 50000, quantity: 1, timestamp });

  for (const tf of ['5m', '15m', '1h', '4h', '1d']) {
    const { buckets } = agg.getHeatmapData('BTCUSDT', tf);
    assert.equal(buckets.length, 1, `timeframe ${tf} should have 1 bucket`);
    const pl = Object.values(buckets[0].priceLevels);
    assert.equal(pl.length, 1, `timeframe ${tf} should have 1 price level`);
    assert.equal(pl[0].long, 1, `timeframe ${tf} long quantity should be 1`);
  }
});

// ---------------------------------------------------------------------------
// Test: different timeframe buckets stay separate for the same symbol
// ---------------------------------------------------------------------------
test('getHeatmapData – timeframes are independent data stores', () => {
  const agg = new Aggregator();
  const timestamp = ts5m(0);

  agg.addLiquidation('BTCUSDT', { side: 'long',  price: 50000, quantity: 1, timestamp });
  agg.addLiquidation('BTCUSDT', { side: 'short', price: 50000, quantity: 2, timestamp });

  const res5m  = agg.getHeatmapData('BTCUSDT', '5m');
  const res15m = agg.getHeatmapData('BTCUSDT', '15m');

  // Both should independently hold the same aggregated data.
  const pl5m  = Object.values(res5m.buckets[0].priceLevels)[0];
  const pl15m = Object.values(res15m.buckets[0].priceLevels)[0];

  assert.equal(pl5m.long,   pl15m.long);
  assert.equal(pl5m.short,  pl15m.short);
});

// ---------------------------------------------------------------------------
// Test: old time-bucket eviction beyond max for '5m' (max 288)
// ---------------------------------------------------------------------------
test('addLiquidation – evicts oldest time bucket beyond 288 for 5m', () => {
  const agg = new Aggregator();
  const intervalMs = 5 * 60 * 1000;
  const maxBuckets = 288;

  // Insert exactly maxBuckets + 1 distinct time buckets.
  for (let i = 0; i <= maxBuckets; i++) {
    const timestamp = i * intervalMs;   // bucket 0, 1, …, 288
    agg.addLiquidation('BTCUSDT', { side: 'long', price: 50000, quantity: 1, timestamp });
  }

  const { buckets } = agg.getHeatmapData('BTCUSDT', '5m');

  // Should never exceed maxBuckets.
  assert.equal(buckets.length, maxBuckets);

  // The oldest bucket (time=0) should have been evicted; the newest is bucket 288.
  const times = buckets.map(b => b.time);
  assert.ok(!times.includes(0), 'bucket at time=0 should have been evicted');
  assert.ok(times.includes(maxBuckets * intervalMs), 'newest bucket should still be present');
});

// ---------------------------------------------------------------------------
// Test: price bucket width – nearby prices merge
// ---------------------------------------------------------------------------
test('priceBucketWidth – nearby BTC prices merge into one bucket', () => {
  // For price ~50000: width = roundToNearest5(50000 * 0.0005) = roundToNearest5(25) = 25
  // 50000 → floor(50000/25)*25 = 50000
  // 50024 → floor(50024/25)*25 = 50000  ← same bucket
  // 50025 → floor(50025/25)*25 = 50025  ← different bucket

  const agg = new Aggregator();
  const timestamp = ts5m(0);

  agg.addLiquidation('BTCUSDT', { side: 'long', price: 50000, quantity: 1, timestamp });
  agg.addLiquidation('BTCUSDT', { side: 'long', price: 50024, quantity: 2, timestamp });

  const { buckets } = agg.getHeatmapData('BTCUSDT', '5m');
  // Only one price level — both fell in the same bucket.
  assert.equal(Object.keys(buckets[0].priceLevels).length, 1);

  const pl = Object.values(buckets[0].priceLevels)[0];
  assert.equal(pl.long, 3);
});

// ---------------------------------------------------------------------------
// Test: price bucket width – prices in different buckets stay separate
// ---------------------------------------------------------------------------
test('priceBucketWidth – prices in different buckets stay separate', () => {
  const agg = new Aggregator();
  const timestamp = ts5m(0);

  // 50000 → bucket 50000, 50025 → bucket 50025
  agg.addLiquidation('BTCUSDT', { side: 'long', price: 50000, quantity: 1, timestamp });
  agg.addLiquidation('BTCUSDT', { side: 'long', price: 50025, quantity: 2, timestamp });

  const { buckets } = agg.getHeatmapData('BTCUSDT', '5m');
  assert.equal(Object.keys(buckets[0].priceLevels).length, 2);
});

// ---------------------------------------------------------------------------
// Test: price bucket minimum width of 5
// ---------------------------------------------------------------------------
test('priceBucketWidth – minimum width is 5 for very small prices', () => {
  // For price 1: raw = 0.0005, roundToNearest5 = 0 → clamp to 5.
  // priceKey for 1   = floor(1/5)*5  = 0
  // priceKey for 3   = floor(3/5)*5  = 0  ← same bucket
  // priceKey for 5.1 = floor(5.1/5)*5 = 5 ← different bucket

  const agg = new Aggregator();
  const timestamp = ts5m(0);

  agg.addLiquidation('LOWUSDT', { side: 'long', price: 1,   quantity: 1, timestamp });
  agg.addLiquidation('LOWUSDT', { side: 'long', price: 3,   quantity: 1, timestamp });
  agg.addLiquidation('LOWUSDT', { side: 'long', price: 5.1, quantity: 1, timestamp });

  const { buckets } = agg.getHeatmapData('LOWUSDT', '5m');
  // bucket 0 (price 1 and 3) and bucket 5 (price 5.1)
  assert.equal(Object.keys(buckets[0].priceLevels).length, 2);
});

// ---------------------------------------------------------------------------
// Test: price-level eviction beyond 200 per time bucket
// ---------------------------------------------------------------------------
test('addLiquidation – evicts lowest-volume price levels beyond 200', () => {
  const agg = new Aggregator();
  const timestamp = ts5m(0);

  // Insert 201 price levels, each with a different quantity.
  // Use large, well-separated prices so each gets its own bucket.
  // Width for ~10000 = round5(10000*0.0005) = round5(5) = 5
  // Stepping by 5 guarantees distinct price keys.
  for (let i = 0; i <= 200; i++) {
    const price = 10000 + i * 5;       // 10000, 10005, 10010, …
    const quantity = i + 1;            // volumes 1 … 201 (unique, ascending)
    agg.addLiquidation('BTCUSDT', { side: 'long', price, quantity, timestamp });
  }

  const { buckets } = agg.getHeatmapData('BTCUSDT', '5m');
  const priceLevels = buckets[0].priceLevels;

  // Must not exceed 200 price levels.
  assert.ok(
    Object.keys(priceLevels).length <= 200,
    `expected ≤200 price levels, got ${Object.keys(priceLevels).length}`,
  );

  // The lowest-volume entry (quantity=1, price=10000) should be evicted.
  const lowestKey = String(10000);
  assert.ok(!(lowestKey in priceLevels), 'lowest-volume price level should have been evicted');
});

// ---------------------------------------------------------------------------
// Test: bucket.time is aligned to the timeframe interval
// ---------------------------------------------------------------------------
test('getHeatmapData – bucket.time is correctly aligned to interval', () => {
  const agg = new Aggregator();
  // Use a timestamp in the middle of a 5-min window.
  const intervalMs = 5 * 60 * 1000;
  const rawTimestamp = 1_700_000_123_456;   // arbitrary ms timestamp
  const expectedTime = Math.floor(rawTimestamp / intervalMs) * intervalMs;

  agg.addLiquidation('BTCUSDT', { side: 'long', price: 50000, quantity: 1, timestamp: rawTimestamp });

  const { buckets } = agg.getHeatmapData('BTCUSDT', '5m');
  assert.equal(buckets[0].time, expectedTime);
});
