/* SignalRenderer — Buy/Sell signal badges on the chart
   Uses RSI + candlestick patterns to identify potential entries.
   Renders as speech-bubble style badges. */
(function () {
  'use strict';

  var BUY_BG    = '#26a69a';
  var SELL_BG   = '#ef5350';
  var TEXT_COLOR = '#fff';
  var RSI_PERIOD = 14;

  function SignalRenderer() {}

  SignalRenderer.prototype.render = function (ctx, candles, coord) {
    if (!candles || candles.length < RSI_PERIOD + 2) return;

    var sigs = this._computeSignals(candles);
    if (sigs.length === 0) return;

    var drawX = coord.drawX, drawW = coord.drawW, drawH = coord.drawH;
    var timeStart = coord.timeStart, timeEnd = coord.timeEnd;
    var priceLow = coord.priceLow, priceHigh = coord.priceHigh;
    var timeRange = timeEnd - timeStart;
    var priceRange = priceHigh - priceLow;
    if (timeRange <= 0 || priceRange <= 0) return;

    var interval = candles.length > 1 ? candles[1].time - candles[0].time : timeRange;
    var colW = Math.max(1, drawW * interval / timeRange);

    ctx.save();
    ctx.beginPath();
    ctx.rect(drawX, 0, drawW, drawH);
    ctx.clip();

    for (var i = 0; i < sigs.length; i++) {
      var sig = sigs[i];
      var cx = drawX + (sig.time - timeStart) / timeRange * drawW + colW / 2;
      if (cx < drawX + 20 || cx > drawX + drawW - 20) continue;

      var priceY = drawH * (1 - (sig.price - priceLow) / priceRange);

      if (sig.type === 'buy') {
        // If candle is too close to bottom, draw badge above instead
        if (priceY + 45 > drawH) {
          this._drawBubble(ctx, cx, priceY - 18, 'BUY', BUY_BG, 'down');
        } else {
          this._drawBubble(ctx, cx, priceY + 18, 'BUY', BUY_BG, 'up');
        }
      } else {
        // If candle is too close to top, draw badge below instead
        if (priceY - 45 < 0) {
          this._drawBubble(ctx, cx, priceY + 18, 'SELL', SELL_BG, 'up');
        } else {
          this._drawBubble(ctx, cx, priceY - 18, 'SELL', SELL_BG, 'down');
        }
      }
    }

    ctx.restore();
  };

  /**
   * Draw a speech-bubble badge with a small triangle pointer.
   * dir: 'up' = pointer on top (badge below candle), 'down' = pointer on bottom (badge above candle)
   */
  SignalRenderer.prototype._drawBubble = function (ctx, x, y, label, bg, dir) {
    var padH = 5, padW = 8;
    ctx.font = '700 10px "Pretendard Variable", "JetBrains Mono", sans-serif';
    var textW = ctx.measureText(label).width;
    var boxW = textW + padW * 2;
    var boxH = 18;
    var radius = 4;
    var tipSize = 5;

    var boxX = x - boxW / 2;
    var boxY, tipBaseY, tipPointY;

    if (dir === 'up') {
      // Badge below, pointer points up to candle
      tipPointY = y;
      boxY = y + tipSize;
    } else {
      // Badge above, pointer points down to candle
      boxY = y - tipSize - boxH;
      tipPointY = y;
    }

    // Shadow
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;

    // Rounded rect
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(boxX + radius, boxY);
    ctx.lineTo(boxX + boxW - radius, boxY);
    ctx.quadraticCurveTo(boxX + boxW, boxY, boxX + boxW, boxY + radius);
    ctx.lineTo(boxX + boxW, boxY + boxH - radius);
    ctx.quadraticCurveTo(boxX + boxW, boxY + boxH, boxX + boxW - radius, boxY + boxH);
    ctx.lineTo(boxX + radius, boxY + boxH);
    ctx.quadraticCurveTo(boxX, boxY + boxH, boxX, boxY + boxH - radius);
    ctx.lineTo(boxX, boxY + radius);
    ctx.quadraticCurveTo(boxX, boxY, boxX + radius, boxY);
    ctx.closePath();
    ctx.fill();

    // Triangle pointer
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.beginPath();
    if (dir === 'up') {
      ctx.moveTo(x - tipSize, boxY);
      ctx.lineTo(x, tipPointY);
      ctx.lineTo(x + tipSize, boxY);
    } else {
      ctx.moveTo(x - tipSize, boxY + boxH);
      ctx.lineTo(x, tipPointY);
      ctx.lineTo(x + tipSize, boxY + boxH);
    }
    ctx.closePath();
    ctx.fill();

    // Text
    ctx.fillStyle = TEXT_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, boxY + boxH / 2);
  };

  SignalRenderer.prototype._computeSignals = function (candles) {
    var signals = [];
    var rsi = this._calcRSI(candles, RSI_PERIOD);
    var lastSignalIdx = -10; // prevent signals too close together

    for (var i = RSI_PERIOD + 1; i < candles.length; i++) {
      if (i - lastSignalIdx < 5) continue; // min 5 candles apart

      var c = candles[i];
      var prev = candles[i - 1];
      var r = rsi[i];
      var rPrev = rsi[i - 1];
      if (r == null || rPrev == null) continue;

      var isBull = c.close > c.open;
      var isPrevBear = prev.close < prev.open;
      var isBear = c.close < c.open;
      var isPrevBull = prev.close > prev.open;

      var bodySize = Math.abs(c.close - c.open);
      var totalRange = c.high - c.low;
      var lowerWick = Math.min(c.open, c.close) - c.low;
      var upperWick = c.high - Math.max(c.open, c.close);

      // Bullish engulfing
      var bullEngulf = isBull && isPrevBear &&
        c.close > prev.open && c.open < prev.close;

      // Bearish engulfing
      var bearEngulf = isBear && isPrevBull &&
        c.close < prev.open && c.open > prev.close;

      // Hammer
      var isHammer = totalRange > 0 && lowerWick > bodySize * 1.5 && upperWick < bodySize * 0.5;

      // Shooting star
      var isStar = totalRange > 0 && upperWick > bodySize * 1.5 && lowerWick < bodySize * 0.5;

      // 3 consecutive bearish candles
      var threeBear = i >= 2 &&
        candles[i].close < candles[i].open &&
        candles[i-1].close < candles[i-1].open &&
        candles[i-2].close < candles[i-2].open;

      // 3 consecutive bullish candles
      var threeBull = i >= 2 &&
        candles[i].close > candles[i].open &&
        candles[i-1].close > candles[i-1].open &&
        candles[i-2].close > candles[i-2].open;

      var bought = false;

      // === BUY signals ===
      if (r < 35 && (bullEngulf || isHammer)) {
        signals.push({ type: 'buy', time: c.time, price: c.low });
        bought = true;
      } else if (rPrev < 35 && r > 35 && isBull) {
        signals.push({ type: 'buy', time: c.time, price: c.low });
        bought = true;
      } else if (bullEngulf && r < 50) {
        signals.push({ type: 'buy', time: c.time, price: c.low });
        bought = true;
      } else if (isHammer && r < 45 && threeBear) {
        // Hammer after a dip
        signals.push({ type: 'buy', time: c.time, price: c.low });
        bought = true;
      }

      // === SELL signals ===
      if (!bought) {
        if (r > 65 && (bearEngulf || isStar)) {
          signals.push({ type: 'sell', time: c.time, price: c.high });
        } else if (rPrev > 65 && r < 65 && isBear) {
          signals.push({ type: 'sell', time: c.time, price: c.high });
        } else if (bearEngulf && r > 50) {
          signals.push({ type: 'sell', time: c.time, price: c.high });
        } else if (isStar && r > 55 && threeBull) {
          // Shooting star after a pump
          signals.push({ type: 'sell', time: c.time, price: c.high });
        }
      }

      if (bought || signals.length > 0 && signals[signals.length - 1].time === c.time) {
        lastSignalIdx = i;
      }
    }

    return signals;
  };

  SignalRenderer.prototype._calcRSI = function (candles, period) {
    var rsi = new Array(candles.length);
    if (candles.length < period + 1) return rsi;

    var gains = 0, losses = 0;
    for (var i = 1; i <= period; i++) {
      var diff = candles[i].close - candles[i - 1].close;
      if (diff > 0) gains += diff;
      else losses -= diff;
    }

    var avgGain = gains / period;
    var avgLoss = losses / period;
    rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

    for (var i = period + 1; i < candles.length; i++) {
      var diff = candles[i].close - candles[i - 1].close;
      var gain = diff > 0 ? diff : 0;
      var loss = diff < 0 ? -diff : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }

    return rsi;
  };

  /**
   * Render manual markers — re-snaps to nearest candle at render time.
   * @param {Array} candles - current candle data for snapping
   */
  SignalRenderer.prototype.renderManual = function (ctx, manualSignals, coord, candles) {
    if (!manualSignals || manualSignals.length === 0) return;

    var drawX = coord.drawX, drawW = coord.drawW, drawH = coord.drawH;
    var priceLow = coord.priceLow, priceHigh = coord.priceHigh;
    var priceRange = priceHigh - priceLow;
    if (priceRange <= 0 || drawW <= 0 || drawH <= 0) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(drawX, 0, drawW, drawH);
    ctx.clip();

    var timeStart = coord.timeStart, timeEnd = coord.timeEnd;
    var timeRange = timeEnd - timeStart;
    var OFFSET = 28;

    for (var i = 0; i < manualSignals.length; i++) {
      var sig = manualSignals[i];
      var isBuy = sig.type === 'buy';

      // Re-snap to nearest candle in current dataset
      var snapCandle = null;
      if (candles && candles.length > 0 && sig.time != null) {
        var bestDist = Infinity;
        for (var ci = 0; ci < candles.length; ci++) {
          var d = Math.abs(candles[ci].time - sig.time);
          if (d < bestDist) { bestDist = d; snapCandle = candles[ci]; }
        }
      }

      var snapPrice = snapCandle
        ? (isBuy ? snapCandle.low : snapCandle.high)
        : sig.price;
      var snapTime = snapCandle ? snapCandle.time : sig.time;

      var priceY = drawH * (1 - (snapPrice - priceLow) / priceRange);
      var cx;
      if (snapTime != null && timeRange > 0) {
        cx = drawX + (snapTime - timeStart) / timeRange * drawW;
      } else {
        cx = drawX + drawW / 2;
      }

      if (cx < drawX - 10 || cx > drawX + drawW + 10) continue;
      if (priceY < -30 || priceY > drawH + 30) continue;

      var bg = isBuy ? BUY_BG : SELL_BG;
      var label = isBuy ? 'BUY' : 'SELL';

      // Bubble direction
      var bubbleY, dir;
      if (isBuy) {
        if (priceY + OFFSET + 25 > drawH) { bubbleY = priceY - OFFSET; dir = 'down'; }
        else { bubbleY = priceY + OFFSET; dir = 'up'; }
      } else {
        if (priceY - OFFSET - 25 < 0) { bubbleY = priceY + OFFSET; dir = 'up'; }
        else { bubbleY = priceY - OFFSET; dir = 'down'; }
      }

      // Connecting line
      ctx.strokeStyle = isBuy ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(cx, priceY);
      ctx.lineTo(cx, bubbleY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Dot on candle
      ctx.beginPath();
      ctx.arc(cx, priceY, 3, 0, Math.PI * 2);
      ctx.fillStyle = bg;
      ctx.fill();

      // Bubble
      this._drawBubble(ctx, cx, bubbleY, label, bg, dir);
    }

    ctx.restore();
  };

  window.SignalRenderer = SignalRenderer;
}());
