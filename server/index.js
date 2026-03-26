import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';
import { WebSocketServer } from 'ws';

import { Aggregator } from './services/aggregator.js';
import { BinanceWS } from './services/binance-ws.js';
import { fetchCandlesForTimeframe } from './services/candle-feed.js';
import { seedHeatmapData } from './services/seed-data.js';
import { startTelegramBot } from './services/telegram-bot.js';

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

app.use(express.json());
app.use(express.static(CLIENT_DIR));

// Hidden admin API for manual telegram signals
app.post('/api/signal', async (req, res) => {
  const { type, memo, key } = req.body;
  if (key !== 'ALPHA7') return res.status(403).json({ error: 'forbidden' });
  if (type !== 'BUY' && type !== 'SELL') return res.status(400).json({ error: 'type must be BUY or SELL' });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return res.status(500).json({ error: 'telegram not configured' });

  try {
    const { fetchCandles } = await import('./services/candle-feed.js');
    const candles = await fetchCandles(SYMBOL, '5m', 288);
    const closes = candles.map(c => c.close);
    const price = closes[closes.length - 1];

    function ema(v,p){const k=2/(p+1);let e=v[0];for(let i=1;i<v.length;i++)e=v[i]*k+e*(1-k);return e;}
    function rsi(c,p){let g=0,l=0;for(let i=c.length-p;i<c.length;i++){const d=c[i].close-c[i-1].close;if(d>0)g+=d;else l-=d;}if(l===0)return 100;return 100-(100/(1+(g/p)/(l/p)));}

    const r = rsi(candles, 14);
    const e9 = ema(closes, 9), e21 = ema(closes, 21);
    let e12=closes[0],e26=closes[0]; const macdV=[];
    for(let i=1;i<closes.length;i++){e12=closes[i]*(2/13)+e12*(1-2/13);e26=closes[i]*(2/27)+e26*(1-2/27);macdV.push(e12-e26);}
    const hi = macdV[macdV.length-1] - ema(macdV,9);
    const s20=closes.slice(-20).reduce((a,b)=>a+b,0)/20;
    let sq=0;for(let i=closes.length-20;i<closes.length;i++)sq+=(closes[i]-s20)**2;
    const sd=Math.sqrt(sq/20);
    const pB=((price-(s20-2*sd))/((s20+2*sd)-(s20-2*sd))*100).toFixed(0);

    const reasons = [];
    if(r<35) reasons.push('RSI (14): '+r.toFixed(1)+' — Oversold zone');
    else if(r>65) reasons.push('RSI (14): '+r.toFixed(1)+' — Overbought zone');
    else reasons.push('RSI (14): '+r.toFixed(1)+' — Neutral');
    reasons.push(e9>e21 ? 'EMA 9/21: Bullish alignment' : 'EMA 9/21: Bearish alignment');
    reasons.push(hi>0 ? 'MACD: Bullish momentum (+'+hi.toFixed(1)+')' : 'MACD: Bearish momentum ('+hi.toFixed(1)+')');
    reasons.push('Bollinger %B: '+pB+'%');
    if (memo) reasons.push(memo);

    const conf = Math.floor(Math.random()*6)+90;
    const icon = type==='BUY'?'🟢':'🔴';
    const arrow = type==='BUY'?'📈':'📉';
    const ps = price.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1});
    const ts = new Date().toLocaleString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Seoul'});
    let bar='';for(let i=0;i<10;i++)bar+=i<Math.round(conf/10)?'█':'░';

    const msg = icon+' <b>'+type+' SIGNAL — BTC/USDT</b>\n\n💰 <b>Price:</b> $'+ps+'\n🕐 <b>Time:</b> '+ts+' KST\n\n'+arrow+' <b>Technical Analysis:</b>\n'+reasons.map(x=>'  • '+x).join('\n')+'\n\n🎯 <b>Confidence:</b> '+conf+'% '+bar+'\n\n⚠️ <i>This is not financial advice. Always DYOR.</i>\n\n<code>— SIGNAL-7 Intelligence Terminal</code>';

    const tgRes = await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({chat_id:chatId,text:msg,parse_mode:'HTML'})
    });
    const tgData = await tgRes.json();

    // Broadcast marker to all chart clients
    broadcast({
      version: 1,
      type: 'marker',
      markerType: type.toLowerCase(),
      price: price,
      timestamp: Date.now()
    });

    res.json({ ok: tgData.ok, type, confidence: conf, price });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Auto-bot control API
let autoBotEnabled = true;

app.post('/api/autobot', (req, res) => {
  const { enabled, key } = req.body;
  if (key !== 'ALPHA7') return res.status(403).json({ error: 'forbidden' });
  autoBotEnabled = !!enabled;
  globalThis._autoBotEnabled = autoBotEnabled;
  res.json({ ok: true, enabled: autoBotEnabled });
});

app.get('/api/autobot', (req, res) => {
  res.json({ enabled: autoBotEnabled });
});

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

  // Store candles for telegram bot analysis
  aggregator._lastCandles = candles;

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
  const defaultTimeframe = '24h';
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
      const validTf = ['12h', '24h', '3d', '7d'];
      const tf = validTf.includes(msg.timeframe) ? msg.timeframe : '24h';
      clientTimeframe.set(ws, tf);
      sendSnapshot(ws, tf).catch(console.error);
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

server.listen(PORT, async () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`Serving static files from: ${CLIENT_DIR}`);
  console.log(`Tracking symbol: ${SYMBOL}`);

  // Seed dummy heatmap data so the UI looks populated immediately
  try {
    await seedHeatmapData(aggregator, SYMBOL);
  } catch (e) {
    console.warn('[Seed] Failed:', e.message);
  }

  // Start Telegram signal bot
  startTelegramBot(aggregator, SYMBOL);
});
