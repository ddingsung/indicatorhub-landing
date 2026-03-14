# Liquidation Heatmap Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real-time liquidation heatmap dashboard for Binance Futures BTCUSDT with Node.js backend and Canvas frontend.

**Architecture:** Node.js server collects liquidation events via Binance WebSocket, aggregates by price level and timeframe, and streams to browser clients via WebSocket. Frontend renders heatmap and candlestick overlays on Canvas.

**Tech Stack:** Node.js, Express, ws, Canvas 2D API, Binance WebSocket/REST API

**Spec:** `docs/superpowers/specs/2026-03-12-liquidation-heatmap-design.md`

---

## File Structure

```
server/
├── package.json
├── index.js                    # Express + WS server entry point
├── services/
│   ├── binance-ws.js           # Binance WebSocket connection (forceOrder + kline)
│   ├── aggregator.js           # Price/time bucket aggregation
│   └── candle-feed.js          # Binance REST klines backfill
├── __tests__/
│   ├── aggregator.test.js      # Aggregator unit tests
│   └── binance-ws.test.js      # Binance WS parser tests

client/
├── index.html                  # Dashboard page
├── css/
│   └── dashboard.css           # Styles (dark theme)
├── js/
│   ├── app.js                  # Entry point, WebSocket client
│   ├── heatmap.js              # Heatmap Canvas renderer
│   ├── candlestick.js          # Candlestick Canvas renderer
│   └── controls.js             # UI controls (timeframe, view toggle)
```

---

## Chunk 1: Backend Core

### Task 1: Project Setup

**Files:**
- Create: `server/package.json`

- [ ] **Step 1: Initialize server project**

```bash
cd /Users/ddingsung/sshome && mkdir -p server/services server/__tests__
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "indicatorhub-heatmap-server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node index.js",
    "dev": "node --watch index.js",
    "test": "node --test __tests__/*.test.js"
  },
  "dependencies": {
    "express": "^4.21.0",
    "ws": "^8.18.0"
  }
}
```

- [ ] **Step 3: Install dependencies**

```bash
cd /Users/ddingsung/sshome/server && npm install
```

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/package-lock.json
git commit -m "feat: initialize server project with express and ws"
```

---

### Task 2: Aggregator — Core Logic

**Files:**
- Create: `server/services/aggregator.js`
- Create: `server/__tests__/aggregator.test.js`

- [ ] **Step 1: Write failing tests for aggregator**

File: `server/__tests__/aggregator.test.js`
```js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Aggregator } from '../services/aggregator.js';

describe('Aggregator', () => {
  let agg;

  beforeEach(() => {
    agg = new Aggregator();
  });

  describe('addLiquidation', () => {
    it('should add a long liquidation to the correct price bucket', () => {
      agg.addLiquidation('BTCUSDT', {
        side: 'long',
        price: 67234.5,
        quantity: 2.5,
        timestamp: Date.now(),
      });

      const data = agg.getHeatmapData('BTCUSDT', '5m');
      assert.ok(data.buckets.length > 0, 'should have at least one time bucket');

      const bucket = data.buckets[0];
      const levels = Object.values(bucket.priceLevels);
      const totalLong = levels.reduce((sum, l) => sum + l.long, 0);
      assert.equal(totalLong, 2.5, 'total long volume should be 2.5');
    });

    it('should add a short liquidation correctly', () => {
      agg.addLiquidation('BTCUSDT', {
        side: 'short',
        price: 67100.0,
        quantity: 1.2,
        timestamp: Date.now(),
      });

      const data = agg.getHeatmapData('BTCUSDT', '5m');
      const bucket = data.buckets[0];
      const totalShort = Object.values(bucket.priceLevels).reduce((s, l) => s + l.short, 0);
      assert.equal(totalShort, 1.2);
    });

    it('should accumulate multiple liquidations in the same price bucket', () => {
      const now = Date.now();
      agg.addLiquidation('BTCUSDT', { side: 'long', price: 67000, quantity: 1.0, timestamp: now });
      agg.addLiquidation('BTCUSDT', { side: 'long', price: 67002, quantity: 0.5, timestamp: now });

      const data = agg.getHeatmapData('BTCUSDT', '5m');
      const bucket = data.buckets[0];
      const totalLong = Object.values(bucket.priceLevels).reduce((s, l) => s + l.long, 0);
      assert.equal(totalLong, 1.5, 'nearby prices should land in same bucket');
    });
  });

  describe('getHeatmapData', () => {
    it('should separate data by timeframe', () => {
      const now = Date.now();
      agg.addLiquidation('BTCUSDT', { side: 'long', price: 67000, quantity: 1.0, timestamp: now });

      const data5m = agg.getHeatmapData('BTCUSDT', '5m');
      const data1h = agg.getHeatmapData('BTCUSDT', '1h');

      assert.ok(data5m.buckets.length > 0);
      assert.ok(data1h.buckets.length > 0);
    });

    it('should return empty buckets for unknown symbol', () => {
      const data = agg.getHeatmapData('ETHUSDT', '1h');
      assert.deepEqual(data.buckets, []);
    });
  });

  describe('bucket eviction', () => {
    it('should evict old 5m buckets beyond 288 limit', () => {
      // Create 290 distinct 5m buckets
      const baseTime = Date.now() - 290 * 5 * 60 * 1000;
      for (let i = 0; i < 290; i++) {
        agg.addLiquidation('BTCUSDT', {
          side: 'long',
          price: 67000,
          quantity: 0.1,
          timestamp: baseTime + i * 5 * 60 * 1000,
        });
      }

      const data = agg.getHeatmapData('BTCUSDT', '5m');
      assert.ok(data.buckets.length <= 288, `should have at most 288 buckets, got ${data.buckets.length}`);
    });
  });

  describe('price bucket width', () => {
    it('should use approximately 0.05% of reference price as bucket width', () => {
      // At price 67000, bucket width ≈ 33.5 → rounds to 35
      agg.addLiquidation('BTCUSDT', { side: 'long', price: 67000, quantity: 1.0, timestamp: Date.now() });
      agg.addLiquidation('BTCUSDT', { side: 'long', price: 67010, quantity: 1.0, timestamp: Date.now() });

      const data = agg.getHeatmapData('BTCUSDT', '5m');
      const bucket = data.buckets[0];
      const levelCount = Object.keys(bucket.priceLevels).length;
      // 67000 and 67010 are within the same ~35 bucket, so should be 1 level
      assert.equal(levelCount, 1, 'prices within same bucket width should merge');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/ddingsung/sshome/server && npm test
```

Expected: FAIL — `aggregator.js` does not exist

- [ ] **Step 3: Implement aggregator**

File: `server/services/aggregator.js`
```js
const TIMEFRAMES = {
  '5m':  { ms: 5 * 60 * 1000, maxBuckets: 288 },
  '15m': { ms: 15 * 60 * 1000, maxBuckets: 192 },
  '1h':  { ms: 60 * 60 * 1000, maxBuckets: 168 },
  '4h':  { ms: 4 * 60 * 60 * 1000, maxBuckets: 180 },
  '1d':  { ms: 24 * 60 * 60 * 1000, maxBuckets: 30 },
};

const MAX_PRICE_LEVELS_PER_BUCKET = 200;

export class Aggregator {
  constructor() {
    // data[symbol][timeframe] = Map<bucketTime, { time, priceLevels }>
    this.data = {};
    this.priceBucketWidth = {}; // per symbol
  }

  _ensureSymbol(symbol) {
    if (!this.data[symbol]) {
      this.data[symbol] = {};
      for (const tf of Object.keys(TIMEFRAMES)) {
        this.data[symbol][tf] = new Map();
      }
    }
  }

  _getBucketWidth(price) {
    // 0.05% of price, rounded to nearest 5
    const raw = price * 0.0005;
    return Math.max(5, Math.round(raw / 5) * 5);
  }

  _priceToBucketKey(price, bucketWidth) {
    return Math.floor(price / bucketWidth) * bucketWidth;
  }

  _timeToBucketKey(timestamp, tfMs) {
    return Math.floor(timestamp / tfMs) * tfMs;
  }

  addLiquidation(symbol, { side, price, quantity, timestamp }) {
    this._ensureSymbol(symbol);

    const bucketWidth = this._getBucketWidth(price);
    this.priceBucketWidth[symbol] = bucketWidth;
    const priceKey = this._priceToBucketKey(price, bucketWidth);

    for (const [tf, config] of Object.entries(TIMEFRAMES)) {
      const timeKey = this._timeToBucketKey(timestamp, config.ms);
      const tfData = this.data[symbol][tf];

      if (!tfData.has(timeKey)) {
        tfData.set(timeKey, { time: timeKey, priceLevels: {} });
      }

      const bucket = tfData.get(timeKey);
      if (!bucket.priceLevels[priceKey]) {
        bucket.priceLevels[priceKey] = { long: 0, short: 0 };
      }

      bucket.priceLevels[priceKey][side] += quantity;

      // Evict price levels if over limit
      const levelKeys = Object.keys(bucket.priceLevels);
      if (levelKeys.length > MAX_PRICE_LEVELS_PER_BUCKET) {
        let minKey = levelKeys[0];
        let minVol = Infinity;
        for (const k of levelKeys) {
          const vol = bucket.priceLevels[k].long + bucket.priceLevels[k].short;
          if (vol < minVol) { minVol = vol; minKey = k; }
        }
        delete bucket.priceLevels[minKey];
      }

      // Evict old time buckets
      if (tfData.size > config.maxBuckets) {
        const sortedKeys = [...tfData.keys()].sort((a, b) => a - b);
        const toRemove = sortedKeys.length - config.maxBuckets;
        for (let i = 0; i < toRemove; i++) {
          tfData.delete(sortedKeys[i]);
        }
      }
    }
  }

  getHeatmapData(symbol, timeframe) {
    this._ensureSymbol(symbol);
    const tfData = this.data[symbol]?.[timeframe];
    if (!tfData || tfData.size === 0) {
      return { symbol, timeframe, buckets: [] };
    }

    const buckets = [...tfData.values()].sort((a, b) => a.time - b.time);
    return { symbol, timeframe, buckets };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/ddingsung/sshome/server && npm test
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/aggregator.js server/__tests__/aggregator.test.js
git commit -m "feat: implement aggregator with price/time bucketing and eviction"
```

---

### Task 3: Binance WebSocket Client

**Files:**
- Create: `server/services/binance-ws.js`
- Create: `server/__tests__/binance-ws.test.js`

- [ ] **Step 1: Write failing tests for event parsing**

File: `server/__tests__/binance-ws.test.js`
```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLiquidationEvent, parseKlineEvent } from '../services/binance-ws.js';

describe('parseLiquidationEvent', () => {
  it('should parse a SELL (long liquidation) event correctly', () => {
    const raw = {
      e: 'forceOrder',
      E: 1710000000000,
      o: {
        s: 'BTCUSDT',
        S: 'SELL',
        ap: '67230.20',
        z: '0.014',
        T: 1710000000123,
      },
    };

    const result = parseLiquidationEvent(raw);
    assert.equal(result.symbol, 'BTCUSDT');
    assert.equal(result.side, 'long');
    assert.equal(result.price, 67230.2);
    assert.equal(result.quantity, 0.014);
    assert.equal(result.timestamp, 1710000000123);
  });

  it('should parse a BUY (short liquidation) event correctly', () => {
    const raw = {
      e: 'forceOrder',
      E: 1710000000000,
      o: { s: 'BTCUSDT', S: 'BUY', ap: '67100.00', z: '1.5', T: 1710000000456 },
    };

    const result = parseLiquidationEvent(raw);
    assert.equal(result.side, 'short');
    assert.equal(result.price, 67100);
    assert.equal(result.quantity, 1.5);
  });
});

describe('parseKlineEvent', () => {
  it('should parse a kline event into a candle object', () => {
    const raw = {
      e: 'kline',
      k: {
        t: 1710000000000,
        o: '67000.00',
        h: '67500.00',
        l: '66800.00',
        c: '67200.00',
        v: '1234.56',
        x: false,
      },
    };

    const result = parseKlineEvent(raw);
    assert.equal(result.time, 1710000000000);
    assert.equal(result.open, 67000);
    assert.equal(result.high, 67500);
    assert.equal(result.low, 66800);
    assert.equal(result.close, 67200);
    assert.equal(result.volume, 1234.56);
    assert.equal(result.closed, false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/ddingsung/sshome/server && npm test
```

Expected: FAIL — functions not defined

- [ ] **Step 3: Implement binance-ws.js**

File: `server/services/binance-ws.js`
```js
import WebSocket from 'ws';

const BINANCE_WS_BASE = 'wss://fstream.binance.com/ws';
const RECONNECT_MAX_DELAY = 30000;
const PREEMPTIVE_RECONNECT_MS = 23 * 60 * 60 * 1000; // 23 hours

export function parseLiquidationEvent(raw) {
  const o = raw.o;
  return {
    symbol: o.s,
    side: o.S === 'SELL' ? 'long' : 'short',
    price: parseFloat(o.ap),
    quantity: parseFloat(o.z),
    timestamp: o.T,
  };
}

export function parseKlineEvent(raw) {
  const k = raw.k;
  return {
    time: k.t,
    open: parseFloat(k.o),
    high: parseFloat(k.h),
    low: parseFloat(k.l),
    close: parseFloat(k.c),
    volume: parseFloat(k.v),
    closed: k.x,
  };
}

export class BinanceWS {
  constructor({ symbol = 'btcusdt', onLiquidation, onKline, onStatusChange }) {
    this.symbol = symbol;
    this.onLiquidation = onLiquidation;
    this.onKline = onKline;
    this.onStatusChange = onStatusChange;
    this.wsForceOrder = null;
    this.wsKline = null;
    this.reconnectDelay = 1000;
    this.reconnectTimer = null;
    this.preemptiveTimer = null;
    this.connected = false;
  }

  connect() {
    this._connectForceOrder();
    this._connectKline();
  }

  _connectForceOrder() {
    const url = `${BINANCE_WS_BASE}/${this.symbol}@forceOrder`;
    this.wsForceOrder = new WebSocket(url);

    this.wsForceOrder.on('open', () => {
      console.log('[BinanceWS] forceOrder connected');
      this.reconnectDelay = 1000;
      this.connected = true;
      this.onStatusChange?.(true);
      this._schedulePreemptiveReconnect('forceOrder');
    });

    this.wsForceOrder.on('message', (data) => {
      try {
        const raw = JSON.parse(data);
        const event = parseLiquidationEvent(raw);
        this.onLiquidation?.(event);
      } catch (e) {
        console.error('[BinanceWS] parse error:', e.message);
      }
    });

    this.wsForceOrder.on('close', () => {
      console.log('[BinanceWS] forceOrder disconnected');
      this.connected = false;
      this.onStatusChange?.(false);
      this._reconnect('forceOrder');
    });

    this.wsForceOrder.on('error', (err) => {
      console.error('[BinanceWS] forceOrder error:', err.message);
    });
  }

  _connectKline() {
    const url = `${BINANCE_WS_BASE}/${this.symbol}@kline_1m`;
    this.wsKline = new WebSocket(url);

    this.wsKline.on('open', () => {
      console.log('[BinanceWS] kline connected');
    });

    this.wsKline.on('message', (data) => {
      try {
        const raw = JSON.parse(data);
        const candle = parseKlineEvent(raw);
        this.onKline?.(candle);
      } catch (e) {
        console.error('[BinanceWS] kline parse error:', e.message);
      }
    });

    this.wsKline.on('close', () => {
      console.log('[BinanceWS] kline disconnected, reconnecting...');
      setTimeout(() => this._connectKline(), 3000);
    });

    this.wsKline.on('error', (err) => {
      console.error('[BinanceWS] kline error:', err.message);
    });
  }

  _reconnect(streamType) {
    clearTimeout(this.reconnectTimer);
    console.log(`[BinanceWS] reconnecting ${streamType} in ${this.reconnectDelay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_DELAY);
      if (streamType === 'forceOrder') this._connectForceOrder();
      else this._connectKline();
    }, this.reconnectDelay);
  }

  _schedulePreemptiveReconnect(streamType) {
    clearTimeout(this.preemptiveTimer);
    this.preemptiveTimer = setTimeout(() => {
      console.log('[BinanceWS] preemptive reconnect (23h limit)');
      if (streamType === 'forceOrder' && this.wsForceOrder) {
        this.wsForceOrder.close();
      }
    }, PREEMPTIVE_RECONNECT_MS);
  }

  disconnect() {
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.preemptiveTimer);
    this.wsForceOrder?.close();
    this.wsKline?.close();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/ddingsung/sshome/server && npm test
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/binance-ws.js server/__tests__/binance-ws.test.js
git commit -m "feat: implement Binance WebSocket client with event parsing"
```

---

### Task 4: Candle Feed (REST backfill)

**Files:**
- Create: `server/services/candle-feed.js`

- [ ] **Step 1: Implement candle-feed.js**

File: `server/services/candle-feed.js`
```js
const BINANCE_API = 'https://fapi.binance.com';

export async function fetchCandles(symbol = 'BTCUSDT', interval = '1h', limit = 168) {
  const url = `${BINANCE_API}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Binance API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  return data.map((k) => ({
    time: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    closed: true,
  }));
}

// Binance interval strings matching our timeframe keys
const INTERVAL_MAP = {
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
};

export async function fetchCandlesForTimeframe(symbol, timeframe) {
  const interval = INTERVAL_MAP[timeframe];
  if (!interval) throw new Error(`Unknown timeframe: ${timeframe}`);

  const limitMap = { '5m': 288, '15m': 192, '1h': 168, '4h': 180, '1d': 30 };
  return fetchCandles(symbol, interval, limitMap[timeframe]);
}
```

- [ ] **Step 2: Commit**

```bash
git add server/services/candle-feed.js
git commit -m "feat: implement candle feed with Binance REST API backfill"
```

---

### Task 5: Server Entry Point

**Files:**
- Create: `server/index.js`

- [ ] **Step 1: Implement server entry point**

File: `server/index.js`
```js
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

import { Aggregator } from './services/aggregator.js';
import { BinanceWS } from './services/binance-ws.js';
import { fetchCandlesForTimeframe } from './services/candle-feed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const SYMBOL = 'BTCUSDT';

// --- State ---
const aggregator = new Aggregator();
const collectingSince = Date.now();
let currentPrice = 0;
let binanceConnected = false;

// Track latest candle per 1m for real-time updates
let latestCandle = null;

// --- Binance WebSocket ---
const binance = new BinanceWS({
  symbol: 'btcusdt',
  onLiquidation(event) {
    aggregator.addLiquidation(event.symbol, event);
    currentPrice = event.price;
    // Broadcast to all clients
    broadcast({
      version: 1,
      type: 'liquidation',
      side: event.side,
      price: event.price,
      quantity: event.quantity,
      timestamp: event.timestamp,
    });
  },
  onKline(candle) {
    latestCandle = candle;
    currentPrice = candle.close;
    broadcast({
      version: 1,
      type: 'candle_update',
      candle,
    });
  },
  onStatusChange(connected) {
    binanceConnected = connected;
    broadcast({
      version: 1,
      type: 'status',
      binanceConnected: connected,
      collectingSince,
    });
  },
});

// --- Express ---
const app = express();
app.use(express.static(path.join(__dirname, '..', 'client')));
const httpServer = createServer(app);

// --- WebSocket Server ---
const wss = new WebSocketServer({ server: httpServer });

// Client state: which timeframe each client is subscribed to
const clientTimeframes = new WeakMap();

wss.on('connection', async (ws) => {
  const defaultTf = '1h';
  clientTimeframes.set(ws, defaultTf);

  // Send initial snapshot
  await sendSnapshot(ws, defaultTf);

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'subscribe' && msg.timeframe) {
        clientTimeframes.set(ws, msg.timeframe);
        await sendSnapshot(ws, msg.timeframe);
      }
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ version: 1, type: 'pong' }));
      }
    } catch (e) {
      // ignore malformed messages
    }
  });
});

async function sendSnapshot(ws, timeframe) {
  if (ws.readyState !== WebSocket.OPEN) return;

  const heatmap = aggregator.getHeatmapData(SYMBOL, timeframe);

  let candles = [];
  try {
    candles = await fetchCandlesForTimeframe(SYMBOL, timeframe);
  } catch (e) {
    console.error('[Server] candle fetch error:', e.message);
  }

  ws.send(JSON.stringify({
    version: 1,
    type: 'snapshot',
    timeframe,
    heatmap: heatmap.buckets,
    candles,
    collectingSince,
    currentPrice,
    binanceConnected,
  }));
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// --- Start ---
httpServer.listen(PORT, () => {
  console.log(`[Server] listening on http://localhost:${PORT}`);
  binance.connect();
});
```

- [ ] **Step 2: Verify server starts**

```bash
cd /Users/ddingsung/sshome/server && node index.js
```

Expected: `[Server] listening on http://localhost:3000` and Binance WS connected messages. Press Ctrl+C to stop.

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat: implement server entry point with WS relay and static serving"
```

---

## Chunk 2: Frontend

### Task 6: Dashboard HTML & CSS

**Files:**
- Create: `client/index.html`
- Create: `client/css/dashboard.css`

- [ ] **Step 1: Create dashboard HTML**

File: `client/index.html`
```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>IndicatorHub — 청산 히트맵</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;600;700&family=Rajdhani:wght@400;500;600;700&family=JetBrains+Mono:wght@300;400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
  <link rel="stylesheet" href="css/dashboard.css">
</head>
<body>
  <header>
    <div class="header-left">
      <a href="/" class="logo">INDICATOR<span>HUB</span></a>
      <div class="divider"></div>
      <h1 class="page-title">청산 히트맵</h1>
    </div>
    <div class="header-right">
      <div class="symbol-badge">BTCUSDT</div>
      <div class="price-display">
        <span class="price" id="currentPrice">--</span>
      </div>
      <div class="status-dot" id="statusDot" title="연결 상태"></div>
    </div>
  </header>

  <div class="controls">
    <div class="control-group">
      <label>타임프레임</label>
      <div class="btn-group" id="timeframeBtns">
        <button data-tf="5m">5m</button>
        <button data-tf="15m">15m</button>
        <button data-tf="1h" class="active">1h</button>
        <button data-tf="4h">4h</button>
        <button data-tf="1d">1d</button>
      </div>
    </div>
    <div class="control-group">
      <label>차트</label>
      <div class="btn-group" id="chartModeBtns">
        <button data-mode="heatmap" class="active">히트맵</button>
        <button data-mode="overlay">캔들+히트맵</button>
      </div>
    </div>
    <div class="control-group">
      <label>뷰</label>
      <div class="btn-group" id="viewModeBtns">
        <button data-view="all" class="active">전체</button>
        <button data-view="long">롱</button>
        <button data-view="short">숏</button>
      </div>
    </div>
  </div>

  <main>
    <div class="chart-container" id="chartContainer">
      <canvas id="mainCanvas"></canvas>
      <div class="y-axis" id="yAxis"></div>
      <div class="x-axis" id="xAxis"></div>
      <div class="color-legend" id="colorLegend">
        <span class="legend-label">낮음</span>
        <div class="legend-gradient"></div>
        <span class="legend-label">높음</span>
      </div>
    </div>
  </main>

  <div class="feed-panel">
    <div class="feed-header">
      <span class="feed-title">최근 청산</span>
      <span class="feed-info" id="feedInfo"></span>
    </div>
    <div class="feed-list" id="feedList"></div>
  </div>

  <div class="data-notice" id="dataNotice">
    <span>&#9432;</span> 데이터 수집 대기 중...
  </div>

  <script src="js/heatmap.js"></script>
  <script src="js/candlestick.js"></script>
  <script src="js/controls.js"></script>
  <script src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create dashboard CSS**

File: `client/css/dashboard.css`
```css
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#05070e;--surface:#0a0e1c;--card:#10152a;
  --cyan:#00e5ff;--cyan-dim:rgba(0,229,255,.15);--cyan-border:rgba(0,229,255,.2);
  --green:#00ff87;--red:#ff3d71;--gold:#ffc857;
  --text:#e4e9f2;--text-dim:#7a8599;--text-muted:#4a5568;
  --border:rgba(255,255,255,.06);
  --font-display:'Orbitron',sans-serif;
  --font-heading:'Rajdhani',sans-serif;
  --font-body:'Pretendard Variable','Pretendard',sans-serif;
  --font-mono:'JetBrains Mono',monospace;
}
html,body{height:100%;background:var(--bg);color:var(--text);font-family:var(--font-body);overflow:hidden}

/* Header */
header{
  display:flex;justify-content:space-between;align-items:center;
  padding:12px 20px;border-bottom:1px solid var(--border);
  background:var(--surface);
}
.header-left{display:flex;align-items:center;gap:16px}
.logo{font-family:var(--font-display);font-size:1rem;font-weight:700;color:var(--cyan);text-decoration:none;letter-spacing:2px}
.logo span{color:var(--text)}
.divider{width:1px;height:20px;background:var(--border)}
.page-title{font-family:var(--font-heading);font-size:1rem;font-weight:500;color:var(--text-dim);letter-spacing:.5px}
.header-right{display:flex;align-items:center;gap:16px}
.symbol-badge{
  font-family:var(--font-mono);font-size:.75rem;font-weight:600;
  color:var(--cyan);background:var(--cyan-dim);
  padding:4px 12px;border:1px solid var(--cyan-border);letter-spacing:1px;
}
.price-display .price{font-family:var(--font-mono);font-size:1rem;font-weight:600;color:var(--text)}
.status-dot{
  width:8px;height:8px;border-radius:50%;background:var(--red);
  transition:background .3s;
}
.status-dot.connected{background:var(--green);box-shadow:0 0 8px rgba(0,255,135,.4)}

/* Controls */
.controls{
  display:flex;gap:24px;padding:10px 20px;
  border-bottom:1px solid var(--border);background:var(--surface);
}
.control-group{display:flex;align-items:center;gap:8px}
.control-group label{font-family:var(--font-mono);font-size:.6rem;color:var(--text-muted);letter-spacing:2px;text-transform:uppercase}
.btn-group{display:flex;gap:2px}
.btn-group button{
  padding:5px 14px;font-family:var(--font-heading);font-size:.8rem;
  font-weight:500;letter-spacing:.5px;
  background:transparent;border:1px solid var(--border);color:var(--text-muted);
  cursor:pointer;transition:all .2s;
}
.btn-group button:hover{color:var(--text);border-color:var(--text-muted)}
.btn-group button.active{color:var(--cyan);border-color:var(--cyan-border);background:var(--cyan-dim)}

/* Chart */
main{flex:1;position:relative;height:calc(100vh - 52px - 41px - 120px - 32px)}
.chart-container{
  position:relative;width:100%;height:100%;
  margin:0;padding:0 60px 28px 70px;
}
.chart-container canvas{position:absolute;top:0;left:70px;right:60px;bottom:28px}
.y-axis{
  position:absolute;top:0;left:0;bottom:28px;width:70px;
  display:flex;flex-direction:column;justify-content:space-between;
  padding:4px 8px;
}
.y-axis .tick{font-family:var(--font-mono);font-size:.65rem;color:var(--text-muted);text-align:right}
.x-axis{
  position:absolute;bottom:0;left:70px;right:60px;height:28px;
  display:flex;justify-content:space-between;align-items:center;
  padding:0 4px;
}
.x-axis .tick{font-family:var(--font-mono);font-size:.6rem;color:var(--text-muted)}
.color-legend{
  position:absolute;top:8px;right:8px;
  display:flex;align-items:center;gap:6px;
}
.legend-label{font-family:var(--font-mono);font-size:.55rem;color:var(--text-muted);letter-spacing:1px}
.legend-gradient{
  width:80px;height:8px;border:1px solid var(--border);
  background:linear-gradient(90deg,#0a0e1c,#1a3a5c,#f0c040,#ff3d3d);
}
.legend-gradient.long{background:linear-gradient(90deg,#1a0a0a,#ff3d3d)}
.legend-gradient.short{background:linear-gradient(90deg,#0a1a0a,#00ff87)}

/* Feed Panel */
.feed-panel{
  height:120px;border-top:1px solid var(--border);
  background:var(--surface);padding:8px 20px;overflow:hidden;
}
.feed-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.feed-title{font-family:var(--font-heading);font-size:.85rem;font-weight:600;color:var(--text);letter-spacing:.5px}
.feed-info{font-family:var(--font-mono);font-size:.6rem;color:var(--text-muted);letter-spacing:1px}
.feed-list{display:flex;flex-direction:column;gap:3px;overflow:hidden}
.feed-item{
  display:flex;gap:16px;align-items:center;
  font-family:var(--font-mono);font-size:.7rem;
  padding:3px 8px;background:rgba(255,255,255,.02);
  animation:feedIn .3s ease;
}
@keyframes feedIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
.feed-item .price{color:var(--text);font-weight:500;min-width:90px}
.feed-item .side{min-width:50px;font-weight:600}
.feed-item .side.long{color:var(--red)}
.feed-item .side.short{color:var(--green)}
.feed-item .qty{color:var(--text-dim);min-width:80px}
.feed-item .time{color:var(--text-muted)}

/* Data Notice */
.data-notice{
  padding:6px 20px;font-family:var(--font-mono);font-size:.65rem;
  color:var(--text-muted);letter-spacing:.5px;
  border-top:1px solid var(--border);background:var(--surface);
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/ddingsung/sshome && git add client/
git commit -m "feat: add dashboard HTML and CSS (dark terminal theme)"
```

---

### Task 7: Heatmap Renderer

**Files:**
- Create: `client/js/heatmap.js`

- [ ] **Step 1: Implement heatmap renderer**

File: `client/js/heatmap.js`
```js
// Heatmap Canvas renderer
// Uses ImageData for batch pixel operations

const COLOR_SCALES = {
  all: [
    [10, 14, 28],    // #0a0e1c - empty
    [26, 58, 92],    // #1a3a5c - low
    [240, 192, 64],  // #f0c040 - medium
    [255, 61, 61],   // #ff3d3d - high
  ],
  long: [
    [10, 14, 28],
    [80, 20, 20],
    [200, 40, 40],
    [255, 61, 113],
  ],
  short: [
    [10, 14, 28],
    [15, 60, 30],
    [0, 180, 90],
    [0, 255, 135],
  ],
};

function lerpColor(colors, t) {
  t = Math.max(0, Math.min(1, t));
  const segments = colors.length - 1;
  const idx = t * segments;
  const lower = Math.floor(idx);
  const upper = Math.min(lower + 1, segments);
  const frac = idx - lower;

  return [
    Math.round(colors[lower][0] + (colors[upper][0] - colors[lower][0]) * frac),
    Math.round(colors[lower][1] + (colors[upper][1] - colors[lower][1]) * frac),
    Math.round(colors[lower][2] + (colors[upper][2] - colors[lower][2]) * frac),
  ];
}

class HeatmapRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const w = rect.width - 130; // account for y-axis and legend
    const h = rect.height - 28; // account for x-axis
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.scale(this.dpr, this.dpr);
    this.W = w;
    this.H = h;
  }

  render(buckets, { viewMode = 'all', currentPrice = 0, priceRange = 0.02 }) {
    if (!this.W || !this.H) this.resize();
    const { ctx, W, H } = this;

    ctx.clearRect(0, 0, W, H);

    if (!buckets || buckets.length === 0) {
      ctx.fillStyle = '#4a5568';
      ctx.font = '14px "Pretendard Variable", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('데이터 수집 중...', W / 2, H / 2);
      return { priceLow: 0, priceHigh: 0, times: [] };
    }

    // Price range
    const priceLow = currentPrice * (1 - priceRange);
    const priceHigh = currentPrice * (1 + priceRange);

    // Collect all price keys to determine bucket width
    const allPriceKeys = new Set();
    for (const b of buckets) {
      for (const k of Object.keys(b.priceLevels)) allPriceKeys.add(Number(k));
    }
    const priceKeys = [...allPriceKeys].filter(p => p >= priceLow && p <= priceHigh).sort((a, b) => a - b);
    if (priceKeys.length === 0) {
      ctx.fillStyle = '#4a5568';
      ctx.font = '14px "Pretendard Variable", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('범위 내 청산 데이터 없음', W / 2, H / 2);
      return { priceLow, priceHigh, times: buckets.map(b => b.time) };
    }

    const bucketWidth = priceKeys.length > 1 ? priceKeys[1] - priceKeys[0] : 50;
    const numRows = Math.ceil((priceHigh - priceLow) / bucketWidth);
    const numCols = buckets.length;

    const cellW = W / numCols;
    const cellH = H / numRows;

    // Find max volume for normalization (log scale)
    let maxLog = 0;
    for (const b of buckets) {
      for (const [pk, lv] of Object.entries(b.priceLevels)) {
        const p = Number(pk);
        if (p < priceLow || p > priceHigh) continue;
        let vol = 0;
        if (viewMode === 'all') vol = lv.long + lv.short;
        else if (viewMode === 'long') vol = lv.long;
        else vol = lv.short;
        const logVol = Math.log1p(vol);
        if (logVol > maxLog) maxLog = logVol;
      }
    }

    if (maxLog === 0) maxLog = 1;
    const colors = COLOR_SCALES[viewMode] || COLOR_SCALES.all;

    // Draw cells
    for (let col = 0; col < numCols; col++) {
      const bucket = buckets[col];
      const x = col * cellW;

      for (const [pk, lv] of Object.entries(bucket.priceLevels)) {
        const p = Number(pk);
        if (p < priceLow || p > priceHigh) continue;

        let vol = 0;
        if (viewMode === 'all') vol = lv.long + lv.short;
        else if (viewMode === 'long') vol = lv.long;
        else vol = lv.short;

        if (vol === 0) continue;

        const t = Math.log1p(vol) / maxLog;
        const row = Math.floor((priceHigh - p) / bucketWidth);
        const y = row * cellH;

        const [r, g, b] = lerpColor(colors, t);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(cellW), Math.ceil(cellH));
      }
    }

    // Current price line
    if (currentPrice >= priceLow && currentPrice <= priceHigh) {
      const yLine = ((priceHigh - currentPrice) / (priceHigh - priceLow)) * H;
      ctx.strokeStyle = 'rgba(255,255,255,.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, yLine);
      ctx.lineTo(W, yLine);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    return { priceLow, priceHigh, times: buckets.map(b => b.time), bucketWidth };
  }
}

window.HeatmapRenderer = HeatmapRenderer;
```

- [ ] **Step 2: Commit**

```bash
git add client/js/heatmap.js
git commit -m "feat: implement heatmap Canvas renderer with log-scale coloring"
```

---

### Task 8: Candlestick Renderer

**Files:**
- Create: `client/js/candlestick.js`

- [ ] **Step 1: Implement candlestick renderer**

File: `client/js/candlestick.js`
```js
class CandlestickRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  render(candles, { priceLow, priceHigh, W, H }) {
    if (!candles || candles.length === 0 || !W || !H) return;

    const ctx = this.ctx;
    const range = priceHigh - priceLow;
    if (range <= 0) return;

    const candleW = W / candles.length;
    const toY = (p) => ((priceHigh - p) / range) * H;

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const x = i * candleW + candleW / 2;
      const isGreen = c.close >= c.open;
      const color = isGreen ? '#00ff87' : '#ff3d71';

      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, toY(c.high));
      ctx.lineTo(x, toY(c.low));
      ctx.stroke();

      // Body
      const bodyTop = toY(Math.max(c.open, c.close));
      const bodyH = Math.max(1, Math.abs(toY(c.open) - toY(c.close)));
      ctx.fillStyle = color;
      ctx.fillRect(x - candleW * 0.3, bodyTop, candleW * 0.6, bodyH);
    }
  }
}

window.CandlestickRenderer = CandlestickRenderer;
```

- [ ] **Step 2: Commit**

```bash
git add client/js/candlestick.js
git commit -m "feat: implement candlestick Canvas renderer"
```

---

### Task 9: Controls Module

**Files:**
- Create: `client/js/controls.js`

- [ ] **Step 1: Implement controls**

File: `client/js/controls.js`
```js
class Controls {
  constructor() {
    this.timeframe = '1h';
    this.chartMode = 'heatmap'; // 'heatmap' | 'overlay'
    this.viewMode = 'all';       // 'all' | 'long' | 'short'
    this.listeners = [];
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  _emit() {
    for (const fn of this.listeners) {
      fn({ timeframe: this.timeframe, chartMode: this.chartMode, viewMode: this.viewMode });
    }
  }

  init() {
    this._bindGroup('timeframeBtns', 'data-tf', (val) => {
      this.timeframe = val;
    });
    this._bindGroup('chartModeBtns', 'data-mode', (val) => {
      this.chartMode = val;
    });
    this._bindGroup('viewModeBtns', 'data-view', (val) => {
      this.viewMode = val;
      this._updateLegend(val);
    });
  }

  _bindGroup(containerId, attr, setter) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      container.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setter(btn.getAttribute(attr));
      this._emit();
    });
  }

  _updateLegend(viewMode) {
    const gradient = document.querySelector('.legend-gradient');
    if (!gradient) return;
    gradient.className = 'legend-gradient';
    if (viewMode === 'long') gradient.classList.add('long');
    else if (viewMode === 'short') gradient.classList.add('short');
  }
}

window.Controls = Controls;
```

- [ ] **Step 2: Commit**

```bash
git add client/js/controls.js
git commit -m "feat: implement UI controls for timeframe, chart mode, and view mode"
```

---

### Task 10: App Entry Point (WebSocket Client + Orchestration)

**Files:**
- Create: `client/js/app.js`

- [ ] **Step 1: Implement app.js**

File: `client/js/app.js`
```js
(function () {
  // --- State ---
  let heatmapBuckets = [];
  let candles = [];
  let currentPrice = 0;
  let collectingSince = 0;
  let recentLiquidations = [];
  const MAX_FEED_ITEMS = 8;

  // --- Renderers ---
  const canvas = document.getElementById('mainCanvas');
  const heatmap = new HeatmapRenderer(canvas);
  const candlestick = new CandlestickRenderer(canvas);
  const controls = new Controls();
  controls.init();

  // --- DOM ---
  const priceEl = document.getElementById('currentPrice');
  const statusDot = document.getElementById('statusDot');
  const feedList = document.getElementById('feedList');
  const feedInfo = document.getElementById('feedInfo');
  const dataNotice = document.getElementById('dataNotice');
  const yAxisEl = document.getElementById('yAxis');
  const xAxisEl = document.getElementById('xAxis');

  // --- WebSocket ---
  let ws = null;
  let pingInterval = null;

  function connectWS() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${protocol}://${location.host}`);

    ws.onopen = () => {
      console.log('[WS] connected');
      ws.send(JSON.stringify({ type: 'subscribe', timeframe: controls.timeframe }));
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 5000);
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      handleMessage(msg);
    };

    ws.onclose = () => {
      console.log('[WS] disconnected, reconnecting in 3s...');
      clearInterval(pingInterval);
      statusDot.classList.remove('connected');
      setTimeout(connectWS, 3000);
    };

    ws.onerror = () => ws.close();
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'snapshot':
        heatmapBuckets = msg.heatmap || [];
        candles = msg.candles || [];
        currentPrice = msg.currentPrice || 0;
        collectingSince = msg.collectingSince || 0;
        if (msg.binanceConnected) statusDot.classList.add('connected');
        updateDataNotice();
        render();
        break;

      case 'liquidation':
        addLiquidationToFeed(msg);
        // We don't re-aggregate client-side; wait for next snapshot or
        // optimistically add to current buckets for visual feedback
        currentPrice = msg.price;
        updatePrice();
        break;

      case 'candle_update':
        if (msg.candle) {
          currentPrice = msg.candle.close;
          updatePrice();
          // Update last candle if same time, else append
          if (candles.length > 0 && candles[candles.length - 1].time === msg.candle.time) {
            candles[candles.length - 1] = msg.candle;
          }
        }
        break;

      case 'status':
        if (msg.binanceConnected) statusDot.classList.add('connected');
        else statusDot.classList.remove('connected');
        collectingSince = msg.collectingSince || collectingSince;
        updateDataNotice();
        break;

      case 'pong':
        break;
    }
  }

  // --- Render ---
  let renderScheduled = false;
  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      render();
    });
  }

  function render() {
    heatmap.resize();

    const result = heatmap.render(heatmapBuckets, {
      viewMode: controls.viewMode,
      currentPrice,
      priceRange: 0.02,
    });

    // Overlay candles if in overlay mode
    if (controls.chartMode === 'overlay' && candles.length > 0 && result.priceLow) {
      const ctx = canvas.getContext('2d');
      ctx.globalAlpha = 0.6;
      candlestick.render(candles, {
        priceLow: result.priceLow,
        priceHigh: result.priceHigh,
        W: heatmap.W,
        H: heatmap.H,
      });
      ctx.globalAlpha = 1.0;
    }

    updateAxes(result);
    updatePrice();
  }

  function updateAxes({ priceLow, priceHigh, times, bucketWidth }) {
    if (!priceLow || !priceHigh) return;

    // Y axis
    yAxisEl.innerHTML = '';
    const numTicks = 8;
    const range = priceHigh - priceLow;
    for (let i = 0; i <= numTicks; i++) {
      const price = priceHigh - (range / numTicks) * i;
      const div = document.createElement('div');
      div.className = 'tick';
      div.textContent = price.toLocaleString('en-US', { maximumFractionDigits: 0 });
      yAxisEl.appendChild(div);
    }

    // X axis
    if (!times || times.length === 0) return;
    xAxisEl.innerHTML = '';
    const step = Math.max(1, Math.floor(times.length / 6));
    for (let i = 0; i < times.length; i += step) {
      const d = new Date(times[i]);
      const div = document.createElement('div');
      div.className = 'tick';
      div.textContent = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
      xAxisEl.appendChild(div);
    }
  }

  function updatePrice() {
    if (currentPrice > 0) {
      priceEl.textContent = currentPrice.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
  }

  function updateDataNotice() {
    if (collectingSince) {
      const d = new Date(collectingSince);
      dataNotice.innerHTML = `<span>&#9432;</span> 데이터 수집 시작: ${d.toLocaleString('ko-KR')} &middot; 데이터는 거래소 제공 기준이며, 고변동 구간에서 일부 누락될 수 있습니다`;
    }
  }

  function addLiquidationToFeed(liq) {
    recentLiquidations.unshift(liq);
    if (recentLiquidations.length > MAX_FEED_ITEMS) recentLiquidations.pop();
    renderFeed();
  }

  function renderFeed() {
    feedList.innerHTML = recentLiquidations
      .map((l) => {
        const ago = Math.floor((Date.now() - l.timestamp) / 1000);
        const agoText = ago < 60 ? `${ago}초 전` : `${Math.floor(ago / 60)}분 전`;
        return `<div class="feed-item">
          <span class="price">${l.price.toLocaleString('en-US', { maximumFractionDigits: 1 })}</span>
          <span class="side ${l.side}">${l.side.toUpperCase()}</span>
          <span class="qty">${l.quantity.toFixed(3)} BTC</span>
          <span class="time">${agoText}</span>
        </div>`;
      })
      .join('');
  }

  // --- Control changes ---
  controls.onChange(({ timeframe }) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'subscribe', timeframe }));
    }
    scheduleRender();
  });

  // --- Resize ---
  window.addEventListener('resize', () => scheduleRender());

  // --- Periodic re-render for feed timestamps ---
  setInterval(() => {
    if (recentLiquidations.length > 0) renderFeed();
  }, 5000);

  // --- Init ---
  connectWS();
})();
```

- [ ] **Step 2: Commit**

```bash
git add client/js/app.js
git commit -m "feat: implement app entry point with WebSocket client and orchestration"
```

---

## Chunk 3: Integration & Verification

### Task 11: End-to-End Test

- [ ] **Step 1: Run all unit tests**

```bash
cd /Users/ddingsung/sshome/server && npm test
```

Expected: All tests PASS

- [ ] **Step 2: Start the server**

```bash
cd /Users/ddingsung/sshome/server && node index.js
```

Expected:
```
[Server] listening on http://localhost:3000
[BinanceWS] forceOrder connected
[BinanceWS] kline connected
```

- [ ] **Step 3: Open browser and verify**

```bash
open http://localhost:3000
```

Verify:
- Dashboard loads with dark theme
- Status dot turns green (Binance connected)
- Current price updates in header
- Timeframe buttons switch and trigger re-render
- Chart/view mode toggles work
- When a liquidation occurs, it appears in the feed panel
- Heatmap renders data as it accumulates
- Data notice shows collection start time

- [ ] **Step 4: Final commit**

```bash
cd /Users/ddingsung/sshome
git add -A
git commit -m "feat: complete liquidation heatmap dashboard (server + client)"
```

- [ ] **Step 5: Push to GitHub**

```bash
git push
```
