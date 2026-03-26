/* EMARenderer — Exponential Moving Average overlay
   Draws EMA 9 (yellow) and EMA 21 (cyan) lines on the price chart. */
(function () {
  'use strict';

  var EMA9_COLOR  = '#FFD700';
  var EMA21_COLOR = '#00E5FF';
  var LINE_WIDTH  = 1.5;

  function EMARenderer() {}

  /**
   * Compute EMA array for given candles and period.
   * @param {Array} candles - [{ close }]
   * @param {number} period
   * @returns {Array} ema values (index-aligned with candles)
   */
  EMARenderer.prototype._calcEMA = function (candles, period) {
    var ema = new Array(candles.length);
    if (candles.length === 0) return ema;

    var k = 2 / (period + 1);

    // Seed with SMA of first `period` candles
    var sum = 0;
    for (var i = 0; i < Math.min(period, candles.length); i++) {
      sum += candles[i].close;
    }
    if (candles.length < period) return ema; // not enough data

    ema[period - 1] = sum / period;

    for (var i = period; i < candles.length; i++) {
      ema[i] = candles[i].close * k + ema[i - 1] * (1 - k);
    }

    return ema;
  };

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array} candles - [{ open, high, low, close, time }]
   * @param {Object} coord  - { drawX, drawW, drawH, timeStart, timeEnd, priceLow, priceHigh }
   */
  EMARenderer.prototype.render = function (ctx, candles, coord) {
    if (!candles || candles.length < 21) return;

    var drawX = coord.drawX, drawW = coord.drawW, drawH = coord.drawH;
    var timeStart = coord.timeStart, timeEnd = coord.timeEnd;
    var priceLow = coord.priceLow, priceHigh = coord.priceHigh;
    var timeRange  = timeEnd - timeStart;
    var priceRange = priceHigh - priceLow;
    if (timeRange <= 0 || priceRange <= 0) return;

    var interval = candles.length > 1 ? candles[1].time - candles[0].time : timeRange;
    var colW = Math.max(1, drawW * interval / timeRange);

    var ema9  = this._calcEMA(candles, 9);
    var ema21 = this._calcEMA(candles, 21);

    ctx.save();
    ctx.beginPath();
    ctx.rect(drawX, 0, drawW, drawH);
    ctx.clip();

    function toX(time) {
      return drawX + (time - timeStart) / timeRange * drawW + colW / 2;
    }
    function toY(price) {
      return drawH * (1 - (price - priceLow) / priceRange);
    }

    // Draw EMA 9
    this._drawLine(ctx, candles, ema9, 8, toX, toY, EMA9_COLOR, drawX, drawW);

    // Draw EMA 21
    this._drawLine(ctx, candles, ema21, 20, toX, toY, EMA21_COLOR, drawX, drawW);

    // Labels
    ctx.font = '600 9px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';

    // Find last valid EMA values for label positioning
    var lastEma9 = null, lastEma21 = null;
    for (var i = candles.length - 1; i >= 0; i--) {
      if (lastEma9 === null && ema9[i] != null) lastEma9 = ema9[i];
      if (lastEma21 === null && ema21[i] != null) lastEma21 = ema21[i];
      if (lastEma9 !== null && lastEma21 !== null) break;
    }

    if (lastEma9 !== null) {
      var y9 = toY(lastEma9);
      ctx.fillStyle = EMA9_COLOR;
      ctx.fillText('EMA 9', drawX + 4, Math.max(10, Math.min(drawH - 4, y9 - 4)));
    }
    if (lastEma21 !== null) {
      var y21 = toY(lastEma21);
      ctx.fillStyle = EMA21_COLOR;
      ctx.fillText('EMA 21', drawX + 4, Math.max(20, Math.min(drawH - 4, y21 - 4)));
    }

    ctx.restore();
  };

  EMARenderer.prototype._drawLine = function (ctx, candles, ema, startIdx, toX, toY, color, drawX, drawW) {
    ctx.strokeStyle = color;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Subtle glow
    ctx.shadowColor = color;
    ctx.shadowBlur = 4;

    ctx.beginPath();
    var started = false;

    for (var i = startIdx; i < candles.length; i++) {
      if (ema[i] == null) continue;
      var x = toX(candles[i].time);
      if (x < drawX - 10 || x > drawX + drawW + 10) continue;

      var y = toY(ema[i]);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  };

  window.EMARenderer = EMARenderer;
}());
