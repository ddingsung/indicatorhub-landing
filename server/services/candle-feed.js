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
    '12h': { interval: '5m',  limit: 144 },   // 5min × 144 = 12h
    '24h': { interval: '15m', limit:  96 },   // 15min × 96 = 24h
    '3d':  { interval: '1h',  limit:  72 },   // 1h × 72 = 3d
    '7d':  { interval: '4h',  limit:  42 },   // 4h × 42 = 7d
  };

  if (!timeframeConfig[timeframe]) {
    throw new Error(`Unknown timeframe: ${timeframe}. Supported: 12h, 24h`);
  }

  const { interval, limit } = timeframeConfig[timeframe];
  return fetchCandles(symbol, interval, limit);
}
