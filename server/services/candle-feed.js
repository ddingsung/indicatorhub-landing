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
    '5m': { interval: '5m', limit: 288 },
    '15m': { interval: '15m', limit: 192 },
    '1h': { interval: '1h', limit: 168 },
    '4h': { interval: '4h', limit: 180 },
    '1d': { interval: '1d', limit: 30 }
  };

  if (!timeframeConfig[timeframe]) {
    throw new Error(`Unknown timeframe: ${timeframe}. Supported: 5m, 15m, 1h, 4h, 1d`);
  }

  const { interval, limit } = timeframeConfig[timeframe];
  return fetchCandles(symbol, interval, limit);
}
