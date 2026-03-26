/**
 * Candle data fetcher for Binance REST API
 * Provides functions to fetch OHLCV data for various timeframes
 */

/**
 * Fetches candle data from Binance REST API
 * @param {string} symbol - Trading pair symbol (default: 'BTCUSDT')
 * @param {string} interval - Candle interval (default: '1h')
 * @param {number} limit - Number of candles to fetch (default: 168)
 * @returns {Promise<Array>} Array of candles with {time, open, high, low, close, volume, closed}
 * @throws {Error} If API response is not OK
 */
export async function fetchCandles(symbol = 'BTCUSDT', interval = '1h', limit = 168) {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Binance API error: ${response.status} ${response.statusText}`);
  }

  const klines = await response.json();

  return klines.map(kline => ({
    time: parseFloat(kline[0]),
    open: parseFloat(kline[1]),
    high: parseFloat(kline[2]),
    low: parseFloat(kline[3]),
    close: parseFloat(kline[4]),
    volume: parseFloat(kline[5]),
    closed: true
  }));
}

/**
 * Fetches candle data for a specific timeframe
 * Automatically maps timeframe to Binance interval and appropriate limit
 * @param {string} symbol - Trading pair symbol
 * @param {string} timeframe - Timeframe key ('5m', '15m', '1h', '4h', '1d')
 * @returns {Promise<Array>} Array of candles with {time, open, high, low, close, volume, closed}
 * @throws {Error} If timeframe is unknown or API call fails
 */
export async function fetchCandlesForTimeframe(symbol, timeframe) {
  const timeframeConfig = {
    '5m':  { interval: '5m',  limit: 1000 },  // ~3.5 days
    '15m': { interval: '15m', limit: 1000 },  // ~10.4 days
    '30m': { interval: '30m', limit: 1000 },  // ~20.8 days
    '1h':  { interval: '1h',  limit: 1000 },  // ~41 days
    '4h':  { interval: '4h',  limit: 1000 },  // ~166 days
    '1d':  { interval: '1d',  limit: 500 },   // ~1.4 years
    // Legacy support
    '12h': { interval: '5m',  limit: 144 },
    '24h': { interval: '15m', limit:  96 },
    '3d':  { interval: '1h',  limit:  72 },
    '7d':  { interval: '4h',  limit:  42 },
  };

  if (!timeframeConfig[timeframe]) {
    throw new Error(`Unknown timeframe: ${timeframe}. Supported: 5m, 15m, 30m, 1h, 4h, 1d`);
  }

  const { interval, limit } = timeframeConfig[timeframe];
  return fetchCandles(symbol, interval, limit);
}
