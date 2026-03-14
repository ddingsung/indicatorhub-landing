import WebSocket from 'ws';

// ---------------------------------------------------------------------------
// Pure event parsers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Parse a Binance forceOrder (liquidation) event.
 *
 * Binance payload shape:
 *   { e: 'forceOrder', o: { S, ap, z, T, s, ... } }
 *
 * Mapping:
 *   o.S  → 'SELL' means long was liquidated, 'BUY' means short was liquidated
 *   o.ap → average fill price
 *   o.z  → total filled quantity
 *   o.T  → timestamp (ms)
 *   o.s  → symbol (e.g. 'BTCUSDT')
 *
 * @param {object} raw  Parsed JSON object from the WebSocket message.
 * @returns {{ symbol: string, side: 'long'|'short', price: number, quantity: number, timestamp: number }}
 */
export function parseLiquidationEvent(raw) {
  const o = raw.o;
  return {
    symbol:    o.s,
    side:      o.S === 'SELL' ? 'long' : 'short',
    price:     parseFloat(o.ap),
    quantity:  parseFloat(o.z),
    timestamp: o.T,
  };
}

/**
 * Parse a Binance kline event.
 *
 * Binance payload shape:
 *   { e: 'kline', k: { t, o, h, l, c, v, x, ... } }
 *
 * @param {object} raw  Parsed JSON object from the WebSocket message.
 * @returns {{ time: number, open: number, high: number, low: number, close: number, volume: number, closed: boolean }}
 */
export function parseKlineEvent(raw) {
  const k = raw.k;
  return {
    time:   k.t,
    open:   parseFloat(k.o),
    high:   parseFloat(k.h),
    low:    parseFloat(k.l),
    close:  parseFloat(k.c),
    volume: parseFloat(k.v),
    closed: k.x,
  };
}

// ---------------------------------------------------------------------------
// Connection constants
// ---------------------------------------------------------------------------

const BASE_URL          = 'wss://fstream.binance.com/ws';
const RECONNECT_BASE_MS = 1_000;      // 1 s initial backoff
const RECONNECT_MAX_MS  = 30_000;     // 30 s cap
const PREEMPT_MS        = 23 * 60 * 60 * 1_000; // 23 h — Binance closes at 24 h

// ---------------------------------------------------------------------------
// Internal stream helper
// ---------------------------------------------------------------------------

/**
 * Manages a single WebSocket stream with exponential-backoff reconnection
 * and a preemptive reconnect before Binance's 24-hour hard limit.
 */
class ManagedStream {
  #url;
  #onMessage;
  #onStatusChange;
  #ws = null;
  #retryCount = 0;
  #reconnectTimer = null;
  #preemptTimer   = null;
  #destroyed = false;

  constructor(url, onMessage, onStatusChange) {
    this.#url            = url;
    this.#onMessage      = onMessage;
    this.#onStatusChange = onStatusChange;
  }

  connect() {
    if (this.#destroyed) return;
    this.#clearTimers();

    const ws = new WebSocket(this.#url);
    this.#ws = ws;

    ws.on('open', () => {
      if (this.#destroyed) { ws.close(); return; }
      this.#retryCount = 0;
      this.#onStatusChange?.('connected');

      // Schedule preemptive reconnect at 23 h
      this.#preemptTimer = setTimeout(() => {
        this.#onStatusChange?.('reconnecting');
        ws.close();            // triggers 'close' → schedules immediate reconnect
      }, PREEMPT_MS);
    });

    ws.on('message', (data) => {
      try {
        this.#onMessage(JSON.parse(data.toString()));
      } catch {
        // Ignore malformed frames
      }
    });

    ws.on('close', () => {
      this.#clearTimers();
      if (this.#destroyed) return;
      this.#scheduleReconnect();
    });

    ws.on('error', () => {
      // 'close' will follow; no extra action needed
    });
  }

  disconnect() {
    this.#destroyed = true;
    this.#clearTimers();
    if (this.#ws) {
      this.#ws.terminate();
      this.#ws = null;
    }
  }

  // ---- private helpers ----

  #clearTimers() {
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    if (this.#preemptTimer !== null) {
      clearTimeout(this.#preemptTimer);
      this.#preemptTimer = null;
    }
  }

  #scheduleReconnect() {
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.#retryCount,
      RECONNECT_MAX_MS,
    );
    this.#retryCount += 1;
    this.#onStatusChange?.('reconnecting');
    this.#reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Manages two Binance futures WebSocket streams (forceOrder + kline_1m)
 * for a given symbol.
 *
 * @example
 * const ws = new BinanceWS({
 *   symbol: 'btcusdt',
 *   onLiquidation: (event) => console.log('liq', event),
 *   onKline:       (event) => console.log('kline', event),
 *   onStatusChange:(status) => console.log('status', status),
 * });
 * ws.connect();
 * // later…
 * ws.disconnect();
 */
export class BinanceWS {
  #symbol;
  #onLiquidation;
  #onKline;
  #onStatusChange;
  #liqStream   = null;
  #klineStream = null;

  constructor({ symbol, onLiquidation, onKline, onStatusChange }) {
    this.#symbol         = (symbol ?? 'btcusdt').toLowerCase();
    this.#onLiquidation  = onLiquidation;
    this.#onKline        = onKline;
    this.#onStatusChange = onStatusChange;
  }

  /**
   * Open both WebSocket streams.  Safe to call only once; subsequent calls
   * are ignored if already connected.
   */
  connect() {
    if (this.#liqStream || this.#klineStream) return; // already connected

    const sym = this.#symbol;

    this.#liqStream = new ManagedStream(
      `${BASE_URL}/${sym}@forceOrder`,
      (raw) => {
        try { this.#onLiquidation?.(parseLiquidationEvent(raw)); } catch { /* ignore */ }
      },
      this.#onStatusChange,
    );

    this.#klineStream = new ManagedStream(
      `${BASE_URL}/${sym}@kline_1m`,
      (raw) => {
        try { this.#onKline?.(parseKlineEvent(raw)); } catch { /* ignore */ }
      },
      this.#onStatusChange,
    );

    this.#liqStream.connect();
    this.#klineStream.connect();
  }

  /**
   * Close both streams cleanly.  No further reconnection attempts will be made.
   */
  disconnect() {
    this.#liqStream?.disconnect();
    this.#klineStream?.disconnect();
    this.#liqStream   = null;
    this.#klineStream = null;
  }
}
