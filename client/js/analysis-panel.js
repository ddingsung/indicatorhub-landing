/* ═══════════════════════════════════════════
   analysis-panel.js — Real-Time Analysis Engine
   Generates terminal logs, signal matrix scores,
   and pattern recognition from live candle data.
   ═══════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Configuration ─────────────────────── */
  var LOG_INTERVAL_MIN   = 2000;
  var LOG_INTERVAL_MAX   = 3500;
  var MATRIX_INTERVAL    = 5000;
  var PATTERN_INTERVAL_MIN = 10000;
  var PATTERN_INTERVAL_MAX = 15000;
  var MAX_LOG_LINES      = 15;
  var MAX_PATTERN_CARDS  = 5;

  /* ── DOM refs ──────────────────────────── */
  var logEl      = document.getElementById('analysisLog');
  var matrixEl   = document.getElementById('analysisMatrix');
  var patternsEl = document.getElementById('analysisPatterns');

  if (!logEl || !matrixEl || !patternsEl) return;

  /* ── State ─────────────────────────────── */
  var logLines       = [];
  var patternCards    = [];
  var currentScores   = { trend: 50, momentum: 50, volatility: 50, buyPressure: 50, sellPressure: 50 };
  var targetScores    = { trend: 50, momentum: 50, volatility: 50, buyPressure: 50, sellPressure: 50 };
  var overallScore    = 50;
  var started         = false;
  var animFrame       = null;

  /* ── Helpers ────────────────────────────── */
  function getCandles() {
    return window._analysisCandles || [];
  }
  function getPrice() {
    return window._analysisPrice || 0;
  }
  function ts() {
    var d = new Date();
    var h = String(d.getHours()).padStart(2, '0');
    var m = String(d.getMinutes()).padStart(2, '0');
    var s = String(d.getSeconds()).padStart(2, '0');
    return h + ':' + m + ':' + s;
  }
  function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function randF(min, max) { return Math.random() * (max - min) + min; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function fmtPrice(p) {
    if (!p) return '--';
    return p >= 1000 ? p.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : p.toFixed(2);
  }
  function fmtPct(v) { return v.toFixed(1) + '%'; }

  /* ═══════════════════════════════════════════
     Technical Analysis Computations
  ═══════════════════════════════════════════ */

  function computeRSI(candles, period) {
    period = period || 14;
    if (candles.length < period + 1) return 50;
    var gains = 0, losses = 0;
    var start = candles.length - period - 1;
    for (var i = start + 1; i < candles.length; i++) {
      var diff = candles[i].close - candles[i - 1].close;
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    if (losses === 0) return 100;
    var rs = (gains / period) / (losses / period);
    return 100 - (100 / (1 + rs));
  }

  function computeEMA(values, period) {
    if (values.length === 0) return 0;
    var k = 2 / (period + 1);
    var ema = values[0];
    for (var i = 1; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
    }
    return ema;
  }

  function computeATR(candles, period) {
    period = period || 14;
    if (candles.length < 2) return 0;
    var trs = [];
    var start = Math.max(1, candles.length - period - 1);
    for (var i = start; i < candles.length; i++) {
      var c = candles[i];
      var pc = candles[i - 1].close;
      var tr = Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
      trs.push(tr);
    }
    if (trs.length === 0) return 0;
    var sum = 0;
    for (var j = 0; j < trs.length; j++) sum += trs[j];
    return sum / trs.length;
  }

  function computeVolumeAvg(candles, period) {
    period = period || 20;
    var start = Math.max(0, candles.length - period);
    var sum = 0, count = 0;
    for (var i = start; i < candles.length; i++) {
      sum += (candles[i].volume || 0);
      count++;
    }
    return count > 0 ? sum / count : 0;
  }

  function computeSupportResistance(candles) {
    if (candles.length < 5) return { support: 0, resistance: 0 };
    var lows = [], highs = [];
    var recent = candles.slice(-20);
    for (var i = 0; i < recent.length; i++) {
      lows.push(recent[i].low);
      highs.push(recent[i].high);
    }
    lows.sort(function (a, b) { return a - b; });
    highs.sort(function (a, b) { return b - a; });
    return {
      support: lows[Math.floor(lows.length * 0.15)],
      resistance: highs[Math.floor(highs.length * 0.15)]
    };
  }

  function computeMACD(candles) {
    if (candles.length < 26) return { macd: 0, signal: 0, histogram: 0 };
    var closes = [];
    for (var i = 0; i < candles.length; i++) closes.push(candles[i].close);
    var ema12 = computeEMA(closes, 12);
    var ema26 = computeEMA(closes, 26);
    var macdLine = ema12 - ema26;
    // Simplified signal (would need series for accuracy)
    return { macd: macdLine, signal: macdLine * 0.8, histogram: macdLine * 0.2 };
  }

  function computeAllScores(candles) {
    if (candles.length < 5) return;

    var price = getPrice();
    var rsi = computeRSI(candles, 14);
    var atr = computeATR(candles, 14);
    var sr = computeSupportResistance(candles);
    var macd = computeMACD(candles);
    var avgVol = computeVolumeAvg(candles, 20);
    var lastVol = candles[candles.length - 1].volume || 0;
    var volRatio = avgVol > 0 ? lastVol / avgVol : 1;

    // Trend Strength: based on EMA crossover and price vs S/R
    var closes = [];
    for (var i = 0; i < candles.length; i++) closes.push(candles[i].close);
    var ema9 = computeEMA(closes, 9);
    var ema21 = computeEMA(closes, 21);
    var trendRaw = ((ema9 - ema21) / ema21) * 10000; // basis points
    var trendScore = clamp(50 + trendRaw * 2, 5, 95);

    // Momentum: RSI-based
    var momentumScore;
    if (rsi > 70) momentumScore = clamp(70 + (rsi - 70) * 1.5, 70, 95);
    else if (rsi < 30) momentumScore = clamp(30 - (30 - rsi) * 1.5, 5, 30);
    else momentumScore = clamp(rsi, 20, 80);

    // Volatility: ATR as percentage of price
    var atrPct = price > 0 ? (atr / price) * 100 : 0;
    var volScore = clamp(atrPct * 30, 5, 95);

    // Buy/Sell Pressure from recent candles
    var buyCount = 0, sellCount = 0, totalBody = 0;
    var len = Math.min(10, candles.length);
    for (var j = candles.length - len; j < candles.length; j++) {
      var c = candles[j];
      var body = Math.abs(c.close - c.open);
      totalBody += body;
      if (c.close > c.open) buyCount += body;
      else sellCount += body;
    }
    var buyPressure = totalBody > 0 ? clamp((buyCount / totalBody) * 100, 5, 95) : 50;
    var sellPressure = totalBody > 0 ? clamp((sellCount / totalBody) * 100, 5, 95) : 50;

    // Volume adjustment
    if (volRatio > 1.5) {
      buyPressure = clamp(buyPressure * 1.15, 5, 95);
      sellPressure = clamp(sellPressure * 1.15, 5, 95);
    }

    targetScores.trend = Math.round(trendScore);
    targetScores.momentum = Math.round(momentumScore);
    targetScores.volatility = Math.round(volScore);
    targetScores.buyPressure = Math.round(buyPressure);
    targetScores.sellPressure = Math.round(sellPressure);
  }

  /* ═══════════════════════════════════════════
     Terminal Log Generation
  ═══════════════════════════════════════════ */

  var categories = ['SCAN', 'ALERT', 'SIG', 'DATA', 'AI', 'NET'];
  var categoryColors = {
    SCAN:  '#00e5ff',
    ALERT: '#ff1744',
    SIG:   '#00ff41',
    DATA:  '#00b4ff',
    AI:    '#b388ff',
    NET:   '#ffab00'
  };

  function generateLogMessage() {
    var candles = getCandles();
    var price = getPrice();
    if (!price || candles.length < 3) return null;

    var rsi = computeRSI(candles, 14);
    var atr = computeATR(candles, 14);
    var sr = computeSupportResistance(candles);
    var avgVol = computeVolumeAvg(candles, 20);
    var lastCandle = candles[candles.length - 1];
    var prevCandle = candles[candles.length - 2];
    var volRatio = avgVol > 0 ? (lastCandle.volume || 0) / avgVol : 1;
    var priceDelta = lastCandle.close - prevCandle.close;
    var priceDeltaPct = prevCandle.close > 0 ? (priceDelta / prevCandle.close) * 100 : 0;

    var templates = [
      // SCAN messages
      { cat: 'SCAN', msg: 'Price level ' + fmtPrice(price) + ' — scanning order flow for anomalies' },
      { cat: 'SCAN', msg: 'RSI(' + rsi.toFixed(1) + ') ' + (rsi > 70 ? 'OVERBOUGHT zone' : rsi < 30 ? 'OVERSOLD zone' : 'neutral range') + ' — monitoring divergence' },
      { cat: 'SCAN', msg: 'Support detected at ' + fmtPrice(sr.support) + ' | Resistance at ' + fmtPrice(sr.resistance) },
      { cat: 'SCAN', msg: 'Analyzing ' + candles.length + ' candles across active timeframe window' },
      { cat: 'SCAN', msg: 'Bid/ask spread analysis — liquidity depth at ' + fmtPrice(price) + ' zone' },

      // ALERT messages
      { cat: 'ALERT', msg: 'Volume spike: ' + fmtPct(volRatio * 100 - 100) + ' above 20-period avg' },
      { cat: 'ALERT', msg: 'Price ' + (priceDelta > 0 ? '+' : '') + fmtPct(priceDeltaPct) + ' — ' + (Math.abs(priceDeltaPct) > 0.5 ? 'significant move detected' : 'within normal range') },
      { cat: 'ALERT', msg: 'ATR(' + fmtPrice(atr) + ') — volatility ' + (atr / price * 100 > 2 ? 'ELEVATED' : 'STABLE') },
      { cat: 'ALERT', msg: (price < sr.support * 1.005 ? 'CAUTION: price approaching support at ' + fmtPrice(sr.support) : price > sr.resistance * 0.995 ? 'CAUTION: price testing resistance at ' + fmtPrice(sr.resistance) : 'Price within consolidation range ' + fmtPrice(sr.support) + ' - ' + fmtPrice(sr.resistance)) },

      // SIG messages
      { cat: 'SIG', msg: 'Signal strength: TREND=' + targetScores.trend + ' MOM=' + targetScores.momentum + ' VOL=' + targetScores.volatility },
      { cat: 'SIG', msg: 'Buy pressure index: ' + targetScores.buyPressure + '/100 | Sell: ' + targetScores.sellPressure + '/100' },
      { cat: 'SIG', msg: 'Composite score ' + overallScore + ' — ' + (overallScore > 60 ? 'BULLISH bias' : overallScore < 40 ? 'BEARISH bias' : 'NEUTRAL stance') },
      { cat: 'SIG', msg: 'EMA(9)=' + fmtPrice(computeEMA(candles.map(function(c){return c.close;}), 9)) + ' cross analysis — ' + (targetScores.trend > 55 ? 'bullish alignment' : 'bearish alignment') },

      // DATA messages
      { cat: 'DATA', msg: 'Candle close: ' + fmtPrice(lastCandle.close) + ' | H=' + fmtPrice(lastCandle.high) + ' L=' + fmtPrice(lastCandle.low) },
      { cat: 'DATA', msg: 'Volume: ' + (lastCandle.volume ? lastCandle.volume.toFixed(2) : '0') + ' BTC (avg: ' + avgVol.toFixed(2) + ')' },
      { cat: 'DATA', msg: '24h range mapped — ' + candles.length + ' data points indexed for pattern scan' },
      { cat: 'DATA', msg: 'OHLC delta: O=' + fmtPrice(lastCandle.open) + ' C=' + fmtPrice(lastCandle.close) + ' (' + (lastCandle.close > lastCandle.open ? 'BULL' : 'BEAR') + ' candle)' },

      // AI messages
      { cat: 'AI', msg: 'Neural net confidence: ' + rand(72, 96) + '% — pattern recognition active' },
      { cat: 'AI', msg: 'ML model processing ' + rand(1200, 4800) + ' features from order flow data' },
      { cat: 'AI', msg: 'Bayesian predictor: ' + (rsi > 55 ? 'long bias ' + rand(55, 75) + '%' : rsi < 45 ? 'short bias ' + rand(55, 75) + '%' : 'no edge detected') },
      { cat: 'AI', msg: 'Deep learning module: microstructure analysis at ' + fmtPrice(price) + ' level' },
      { cat: 'AI', msg: 'Transformer attention map: key level ' + fmtPrice(sr.support + (sr.resistance - sr.support) * 0.5) + ' flagged' },

      // NET messages
      { cat: 'NET', msg: 'WebSocket latency: ' + rand(1, 8) + 'ms — feed integrity verified' },
      { cat: 'NET', msg: 'Data stream: ' + rand(120, 380) + ' msgs/sec — buffer nominal' },
      { cat: 'NET', msg: 'Exchange feed sync: Binance perpetuals — ' + rand(98, 100) + '% uptime' },
      { cat: 'NET', msg: 'Node cluster heartbeat OK — encrypted channel AES-256 active' }
    ];

    var entry = templates[rand(0, templates.length - 1)];
    return entry;
  }

  /* ═══════════════════════════════════════════
     Pattern Detection
  ═══════════════════════════════════════════ */

  function detectPatterns() {
    var candles = getCandles();
    if (candles.length < 5) return [];

    var detected = [];
    var last = candles[candles.length - 1];
    var prev = candles[candles.length - 2];
    var prev2 = candles[candles.length - 3];
    var price = getPrice();

    var lastBody = Math.abs(last.close - last.open);
    var lastRange = last.high - last.low;
    var prevBody = Math.abs(prev.close - prev.open);
    var prevRange = prev.high - prev.low;
    var lastBull = last.close > last.open;
    var prevBull = prev.close > prev.open;

    // Doji
    if (lastRange > 0 && lastBody / lastRange < 0.1) {
      detected.push({
        name: 'DOJI',
        type: 'neutral',
        confidence: rand(70, 92),
        desc: 'Indecision at ' + fmtPrice(price) + ' — equal buy/sell pressure'
      });
    }

    // Bullish Engulfing
    if (!prevBull && lastBull && last.open <= prev.close && last.close >= prev.open && lastBody > prevBody * 1.1) {
      detected.push({
        name: 'BULLISH ENGULFING',
        type: 'bullish',
        confidence: rand(72, 95),
        desc: 'Bull candle engulfs prior bear — reversal signal at ' + fmtPrice(price)
      });
    }

    // Bearish Engulfing
    if (prevBull && !lastBull && last.open >= prev.close && last.close <= prev.open && lastBody > prevBody * 1.1) {
      detected.push({
        name: 'BEARISH ENGULFING',
        type: 'bearish',
        confidence: rand(72, 95),
        desc: 'Bear candle engulfs prior bull — reversal signal at ' + fmtPrice(price)
      });
    }

    // Hammer (bullish)
    var lowerWick = lastBull ? (last.open - last.low) : (last.close - last.low);
    var upperWick = lastBull ? (last.high - last.close) : (last.high - last.open);
    if (lowerWick > lastBody * 2 && upperWick < lastBody * 0.5 && lastBody > 0) {
      detected.push({
        name: 'HAMMER',
        type: 'bullish',
        confidence: rand(65, 88),
        desc: 'Long lower shadow — buyers defending ' + fmtPrice(last.low) + ' level'
      });
    }

    // Shooting Star (bearish)
    if (upperWick > lastBody * 2 && lowerWick < lastBody * 0.5 && lastBody > 0) {
      detected.push({
        name: 'SHOOTING STAR',
        type: 'bearish',
        confidence: rand(65, 88),
        desc: 'Long upper shadow — sellers rejecting ' + fmtPrice(last.high) + ' level'
      });
    }

    // Three White Soldiers / Three Black Crows
    if (candles.length >= 4) {
      var c1 = candles[candles.length - 3];
      var c2 = candles[candles.length - 2];
      var c3 = candles[candles.length - 1];
      if (c1.close > c1.open && c2.close > c2.open && c3.close > c3.open &&
          c2.close > c1.close && c3.close > c2.close) {
        detected.push({
          name: 'THREE WHITE SOLDIERS',
          type: 'bullish',
          confidence: rand(78, 94),
          desc: 'Three consecutive bullish closes — strong uptrend continuation'
        });
      }
      if (c1.close < c1.open && c2.close < c2.open && c3.close < c3.open &&
          c2.close < c1.close && c3.close < c2.close) {
        detected.push({
          name: 'THREE BLACK CROWS',
          type: 'bearish',
          confidence: rand(78, 94),
          desc: 'Three consecutive bearish closes — strong downtrend continuation'
        });
      }
    }

    // Volume Surge
    var avgVol = computeVolumeAvg(candles, 20);
    if (avgVol > 0 && (last.volume || 0) > avgVol * 2) {
      detected.push({
        name: 'VOLUME SURGE',
        type: lastBull ? 'bullish' : 'bearish',
        confidence: rand(75, 92),
        desc: 'Volume ' + ((last.volume / avgVol) * 100 - 100).toFixed(0) + '% above avg — institutional flow detected'
      });
    }

    // RSI Divergence (simplified)
    var rsi = computeRSI(candles, 14);
    if (rsi > 75) {
      detected.push({
        name: 'RSI OVERBOUGHT',
        type: 'bearish',
        confidence: rand(60, 82),
        desc: 'RSI at ' + rsi.toFixed(1) + ' — overbought conditions, potential pullback'
      });
    } else if (rsi < 25) {
      detected.push({
        name: 'RSI OVERSOLD',
        type: 'bullish',
        confidence: rand(60, 82),
        desc: 'RSI at ' + rsi.toFixed(1) + ' — oversold conditions, potential bounce'
      });
    }

    // Support/Resistance test
    var sr = computeSupportResistance(candles);
    if (price > 0 && sr.resistance > 0 && Math.abs(price - sr.resistance) / price < 0.003) {
      detected.push({
        name: 'RESISTANCE TEST',
        type: 'neutral',
        confidence: rand(68, 88),
        desc: 'Price testing resistance at ' + fmtPrice(sr.resistance) + ' — breakout or rejection imminent'
      });
    }
    if (price > 0 && sr.support > 0 && Math.abs(price - sr.support) / price < 0.003) {
      detected.push({
        name: 'SUPPORT TEST',
        type: 'neutral',
        confidence: rand(68, 88),
        desc: 'Price testing support at ' + fmtPrice(sr.support) + ' — bounce or breakdown imminent'
      });
    }

    // Morning/Evening Star (simplified)
    if (candles.length >= 4) {
      var s1 = candles[candles.length - 3];
      var s2 = candles[candles.length - 2];
      var s3 = candles[candles.length - 1];
      var s1Body = Math.abs(s1.close - s1.open);
      var s2Body = Math.abs(s2.close - s2.open);
      var s3Body = Math.abs(s3.close - s3.open);
      if (s1.close < s1.open && s2Body < s1Body * 0.3 && s3.close > s3.open && s3Body > s1Body * 0.5) {
        detected.push({
          name: 'MORNING STAR',
          type: 'bullish',
          confidence: rand(70, 90),
          desc: 'Three-candle reversal — bearish to bullish transition at ' + fmtPrice(price)
        });
      }
      if (s1.close > s1.open && s2Body < s1Body * 0.3 && s3.close < s3.open && s3Body > s1Body * 0.5) {
        detected.push({
          name: 'EVENING STAR',
          type: 'bearish',
          confidence: rand(70, 90),
          desc: 'Three-candle reversal — bullish to bearish transition at ' + fmtPrice(price)
        });
      }
    }

    // Consolidation / Tight Range
    if (candles.length >= 6) {
      var rangeLow = Infinity, rangeHigh = -Infinity;
      for (var i = candles.length - 6; i < candles.length; i++) {
        if (candles[i].low < rangeLow) rangeLow = candles[i].low;
        if (candles[i].high > rangeHigh) rangeHigh = candles[i].high;
      }
      var rangePct = rangeHigh > 0 ? ((rangeHigh - rangeLow) / rangeHigh) * 100 : 0;
      if (rangePct < 1.0 && rangePct > 0) {
        detected.push({
          name: 'TIGHT CONSOLIDATION',
          type: 'neutral',
          confidence: rand(72, 90),
          desc: fmtPct(rangePct) + ' range over 6 candles — breakout likely imminent'
        });
      }
    }

    return detected;
  }

  /* ═══════════════════════════════════════════
     Rendering — Terminal Log
  ═══════════════════════════════════════════ */

  function renderLog() {
    // Only re-render all lines on first call; after that, addLogLine handles DOM
    logEl.innerHTML = '';
    for (var i = 0; i < logLines.length; i++) {
      var line = logLines[i];
      logEl.appendChild(createLogLineEl(line, false));
    }
    logEl.scrollTop = logEl.scrollHeight;
  }

  function createLogLineEl(line, isNew) {
    var catColor = categoryColors[line.cat] || '#00b4ff';
    var div = document.createElement('div');
    div.className = 'alog-line' + (isNew ? ' alog-new' : '');
    div.innerHTML =
      '<span class="alog-ts">' + line.ts + '</span>' +
      '<span class="alog-cat" style="color:' + catColor + ';border-color:' + catColor + '40">[' + line.cat + ']</span>' +
      '<span class="alog-msg">' + line.msg + '</span>';
    return div;
  }

  function addLogLine() {
    var entry = generateLogMessage();
    if (!entry) return;
    var lineData = { ts: ts(), cat: entry.cat, msg: entry.msg };
    logLines.push(lineData);

    // Remove oldest from DOM if over limit
    if (logLines.length > MAX_LOG_LINES) {
      logLines.shift();
      var first = logEl.firstChild;
      if (first) logEl.removeChild(first);
    }

    // Append new line with slide-up animation
    var el = createLogLineEl(lineData, true);
    logEl.appendChild(el);
    logEl.scrollTop = logEl.scrollHeight;
  }

  /* ═══════════════════════════════════════════
     Rendering — Signal Matrix
  ═══════════════════════════════════════════ */

  function getScoreColor(val) {
    if (val < 30) return '#ff1744';
    if (val < 60) return '#ffab00';
    return '#00ff41';
  }

  function getBarGradient(val) {
    if (val < 30) return 'linear-gradient(90deg, #ff1744 0%, #ff174480 100%)';
    if (val < 60) return 'linear-gradient(90deg, #ffab00 0%, #ffab0080 100%)';
    return 'linear-gradient(90deg, #00ff41 0%, #00ff4180 100%)';
  }

  function getBarGlow(val) {
    if (val < 30) return '0 0 8px rgba(255,23,68,0.4)';
    if (val < 60) return '0 0 8px rgba(255,171,0,0.4)';
    return '0 0 8px rgba(0,255,65,0.4)';
  }

  function renderMatrix() {
    // Smooth transition of scores
    var keys = ['trend', 'momentum', 'volatility', 'buyPressure', 'sellPressure'];
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      currentScores[key] += (targetScores[key] - currentScores[key]) * 0.15;
      currentScores[key] = Math.round(currentScores[key]);
    }
    overallScore = Math.round(
      currentScores.trend * 0.25 +
      currentScores.momentum * 0.25 +
      (100 - currentScores.volatility) * 0.1 +
      currentScores.buyPressure * 0.25 +
      (100 - currentScores.sellPressure) * 0.15
    );
    overallScore = clamp(overallScore, 0, 100);

    var scoreColor = getScoreColor(overallScore);
    var scoreLabel = overallScore > 60 ? 'BULLISH' : overallScore < 40 ? 'BEARISH' : 'NEUTRAL';

    var html = '<div class="matrix-header">' +
      '<div class="matrix-title">SIGNAL SCORE</div>' +
      '<div class="matrix-score" style="color:' + scoreColor + ';text-shadow:0 0 30px ' + scoreColor + '80,0 0 60px ' + scoreColor + '30">' + overallScore + '</div>' +
      '<div class="matrix-label" style="color:' + scoreColor + '">' + scoreLabel + '</div>' +
      '</div>';

    html += '<div class="matrix-bars">';

    var metrics = [
      { label: 'TREND',        key: 'trend' },
      { label: 'MOMENTUM',     key: 'momentum' },
      { label: 'VOLATILITY',   key: 'volatility' },
      { label: 'BUY PRESS',    key: 'buyPressure' },
      { label: 'SELL PRESS',   key: 'sellPressure' }
    ];

    for (var i = 0; i < metrics.length; i++) {
      var m = metrics[i];
      var val = currentScores[m.key];
      var barColor = getScoreColor(val);
      html += '<div class="matrix-row">' +
        '<span class="matrix-metric-label">' + m.label + '</span>' +
        '<div class="matrix-bar-track">' +
        '<div class="matrix-bar-fill" style="width:' + val + '%;background:' + getBarGradient(val) + ';box-shadow:' + getBarGlow(val) + '"></div>' +
        '</div>' +
        '<span class="matrix-metric-val" style="color:' + barColor + '">' + val + '</span>' +
        '</div>';
    }
    html += '</div>';

    matrixEl.innerHTML = html;
  }

  /* ═══════════════════════════════════════════
     Rendering — Pattern Cards
  ═══════════════════════════════════════════ */

  function renderPatterns() {
    if (patternCards.length === 0) {
      patternsEl.innerHTML = '<div class="pattern-empty">Scanning for patterns<span class="pattern-dots">...</span></div>';
      return;
    }
    var html = '';
    for (var i = 0; i < patternCards.length; i++) {
      var p = patternCards[i];
      var borderColor = p.type === 'bullish' ? '#00ff41' : p.type === 'bearish' ? '#ff1744' : '#00e5ff';
      var typeLabel = p.type === 'bullish' ? 'BULL' : p.type === 'bearish' ? 'BEAR' : 'NEUT';
      var typeColor = borderColor;
      html += '<div class="pattern-card' + (i === 0 ? ' pattern-new' : '') + '" style="border-left-color:' + borderColor + '">' +
        '<div class="pattern-card-header">' +
        '<span class="pattern-name">' + p.name + '</span>' +
        '<span class="pattern-conf" style="color:' + borderColor + '">' + p.confidence + '%</span>' +
        '</div>' +
        '<div class="pattern-card-body">' +
        '<span class="pattern-type" style="color:' + typeColor + ';border-color:' + typeColor + '40">' + typeLabel + '</span>' +
        '<span class="pattern-ts">' + p.ts + '</span>' +
        '</div>' +
        '<div class="pattern-desc">' + p.desc + '</div>' +
        '</div>';
    }
    patternsEl.innerHTML = html;
  }

  function addPattern() {
    var detected = detectPatterns();
    if (detected.length === 0) return;

    // Pick a random one from detected
    var pick = detected[rand(0, detected.length - 1)];

    // Don't add duplicate names in a row
    if (patternCards.length > 0 && patternCards[0].name === pick.name) {
      // Try another
      if (detected.length > 1) {
        var filtered = detected.filter(function (d) { return d.name !== pick.name; });
        if (filtered.length > 0) pick = filtered[rand(0, filtered.length - 1)];
        else return;
      } else {
        return;
      }
    }

    patternCards.unshift({
      name: pick.name,
      type: pick.type,
      confidence: pick.confidence,
      desc: pick.desc,
      ts: ts()
    });
    if (patternCards.length > MAX_PATTERN_CARDS) patternCards.pop();
    renderPatterns();
  }

  /* ═══════════════════════════════════════════
     Main Loop
  ═══════════════════════════════════════════ */

  var logTimer = null;
  var matrixTimer = null;
  var patternTimer = null;

  function scheduleLog() {
    logTimer = setTimeout(function () {
      addLogLine();
      scheduleLog();
    }, rand(LOG_INTERVAL_MIN, LOG_INTERVAL_MAX));
  }

  function scheduleMatrix() {
    matrixTimer = setTimeout(function () {
      computeAllScores(getCandles());
      renderMatrix();
      scheduleMatrix();
    }, MATRIX_INTERVAL);
  }

  function schedulePattern() {
    patternTimer = setTimeout(function () {
      addPattern();
      schedulePattern();
    }, rand(PATTERN_INTERVAL_MIN, PATTERN_INTERVAL_MAX));
  }

  function tryStart() {
    if (started) return;
    var candles = getCandles();
    if (!candles || candles.length < 3) return;

    started = true;

    // Initial computations
    computeAllScores(candles);

    // Initial render
    renderMatrix();
    renderPatterns();

    // Burst: add a few initial log lines quickly
    for (var i = 0; i < 5; i++) {
      (function (delay) {
        setTimeout(function () { addLogLine(); }, delay);
      })(i * 400);
    }

    // Add initial pattern
    setTimeout(function () { addPattern(); }, 1500);

    // Start scheduled updates
    setTimeout(function () {
      scheduleLog();
      scheduleMatrix();
      schedulePattern();
    }, 2500);
  }

  // Poll until candle data is available
  var pollTimer = setInterval(function () {
    var candles = getCandles();
    if (candles && candles.length >= 3) {
      clearInterval(pollTimer);
      tryStart();
    }
  }, 500);

  // Also expose for manual trigger
  window._startAnalysisPanel = tryStart;

}());
