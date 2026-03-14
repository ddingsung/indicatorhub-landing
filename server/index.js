import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';
import { WebSocketServer } from 'ws';

import { Aggregator } from './services/aggregator.js';
import { BinanceWS } from './services/binance-ws.js';
import { fetchCandlesForTimeframe } from './services/candle-feed.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PORT   = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const SYMBOL = 'BTCUSDT';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = join(__dirname, '..', 'client');

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

const aggregator = new Aggregator();

let collectingSince  = Date.now();
let currentPrice     = undefined;
let binanceConnected = false;
let latestCandle     = undefined;

// Per-client subscribed timeframe: WeakMap<WebSocket, string>
const clientTimeframe = new WeakMap();

// ---------------------------------------------------------------------------
// Express + HTTP server
// ---------------------------------------------------------------------------

const app    = express();
const server = createServer(app);

app.use(express.static(CLIENT_DIR));

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ server });

/**
 * Send a JSON message to a single WS client (fire-and-forget).
 */
function send(ws, msg) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/**
 * Broadcast a JSON message to every open WS client.
 */
function broadcast(msg) {
  const payload = JSON.stringify(msg);
  for (const ws of wss.clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}

/**
 * Fetch heatmap + candles and send a snapshot to one client.
 */
async function sendSnapshot(ws, timeframe) {
  const [heatmap, candles] = await Promise.all([
    Promise.resolve(aggregator.getHeatmapData(SYMBOL, timeframe)),
    fetchCandlesForTimeframe(SYMBOL, timeframe),
  ]);

  send(ws, {
    version: 1,
    type: 'snapshot',
    timeframe,
    heatmap,
    candles,
    collectingSince,
    currentPrice,
    binanceConnected,
  });
}

wss.on('connection', (ws) => {
  // Default timeframe for this client
  const defaultTimeframe = '1h';
  clientTimeframe.set(ws, defaultTimeframe);

  // Send initial snapshot
  sendSnapshot(ws, defaultTimeframe).catch(console.error);

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return; // Ignore malformed frames
    }

    if (msg.type === 'subscribe' && msg.timeframe) {
      clientTimeframe.set(ws, msg.timeframe);
      sendSnapshot(ws, msg.timeframe).catch(console.error);
    } else if (msg.type === 'ping') {
      send(ws, { version: 1, type: 'pong' });
    }
  });
});

// ---------------------------------------------------------------------------
// Binance WebSocket integration
// ---------------------------------------------------------------------------

const binanceWS = new BinanceWS({
  symbol: SYMBOL,

  onLiquidation(event) {
    const { side, price, quantity, timestamp } = event;

    aggregator.addLiquidation(SYMBOL, { side, price, quantity, timestamp });

    broadcast({
      version: 1,
      type: 'liquidation',
      side,
      price,
      quantity,
      timestamp,
    });
  },

  onKline(candle) {
    latestCandle  = candle;
    currentPrice  = candle.close;

    broadcast({
      version: 1,
      type: 'candle_update',
      candle,
    });
  },

  onStatusChange(status) {
    binanceConnected = status === 'connected';

    broadcast({
      version: 1,
      type: 'status',
      binanceConnected,
      collectingSince,
    });
  },
});

binanceWS.connect();

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`Serving static files from: ${CLIENT_DIR}`);
  console.log(`Tracking symbol: ${SYMBOL}`);
});
