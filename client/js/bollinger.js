/* BollingerRenderer — Bollinger Bands overlay
   20-period SMA middle band (white dotted), upper/lower bands (light blue),
   semi-transparent fill between bands. */
(function () {
  'use strict';

  var PERIOD   = 20;
  var STD_MULT = 2;
  var BAND_COLOR   = 'rgba(100, 180, 255, 0.7)';
  var MIDDLE_COLOR = 'rgba(255, 255, 255, 0.5)';
  var FILL_COLOR   = 'rgba(100, 180, 255, 0.06)';
  var LINE_WIDTH   = 1;

  function BollingerRenderer() {}

  /**
   * Compute SMA and standard deviation for Bollinger Bands.
   * @returns {{ sma: Array, upper: Array, lower: Array }}
   */
  BollingerRenderer.prototype._calcBands = function (candles) {
    var len = candles.length;
    var sma   = new Array(len);
    var upper = new Array(len);
    var lower = new Array(len);

    if (len < PERIOD) return { sma: sma, upper: upper, lower: lower };

    for (var i = PERIOD - 1; i < len; i++) {
      // SMA
      var sum = 0;
      for (var j = i - PERIOD + 1; j <= i; j++) {
        sum += candles[j].close;
      }
      var mean = sum / PERIOD;
      sma[i] = mean;

      // Standard deviation
      var sqSum = 0;
      for (var j = i - PERIOD + 1; j <= i; j++) {
        var diff = candles[j].close - mean;
        sqSum += diff * diff;
      }
      var stdDev = Math.sqrt(sqSum / PERIOD);
      upper[i] = mean + STD_MULT * stdDev;
      lower[i] = mean - STD_MULT * stdDev;
    }

    return { sma: sma, upper: upper, lower: lower };
  };

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array} candles
   * @param {Object} coord
   */
  BollingerRenderer.prototype.render = function (ctx, candles, coord) {
    if (!candles || candles.length < PERIOD) return;

    var drawX = coord.drawX, drawW = coord.drawW, drawH = coord.drawH;
    var timeStart = coord.timeStart, timeEnd = coord.timeEnd;
    var priceLow = coord.priceLow, priceHigh = coord.priceHigh;
    var timeRange  = timeEnd - timeStart;
    var priceRange = priceHigh - priceLow;
    if (timeRange <= 0 || priceRange <= 0) return;

    var interval = candles.length > 1 ? candles[1].time - candles[0].time : timeRange;
    var colW = Math.max(1, drawW * interval / timeRange);

    var bands = this._calcBands(candles);

    function toX(time) {
      return drawX + (time - timeStart) / timeRange * drawW + colW / 2;
    }
    function toY(price) {
      return drawH * (1 - (price - priceLow) / priceRange);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(drawX, 0, drawW, drawH);
    ctx.clip();

    // Collect visible points for fill
    var upperPts = [];
    var lowerPts = [];
    for (var i = PERIOD - 1; i < candles.length; i++) {
      if (bands.upper[i] == null) continue;
      var x = toX(candles[i].time);
      if (x < drawX - 10 || x > drawX + drawW + 10) continue;
      upperPts.push({ x: x, y: toY(bands.upper[i]) });
      lowerPts.push({ x: x, y: toY(bands.lower[i]) });
    }

    // Fill between bands
    if (upperPts.length > 1) {
      ctx.fillStyle = FILL_COLOR;
      ctx.beginPath();
      ctx.moveTo(upperPts[0].x, upperPts[0].y);
      for (var i = 1; i < upperPts.length; i++) {
        ctx.lineTo(upperPts[i].x, upperPts[i].y);
      }
      for (var i = lowerPts.length - 1; i >= 0; i--) {
        ctx.lineTo(lowerPts[i].x, lowerPts[i].y);
      }
      ctx.closePath();
      ctx.fill();
    }

    // Upper band line
    this._drawLine(ctx, upperPts, BAND_COLOR, LINE_WIDTH, false);

    // Lower band line
    this._drawLine(ctx, lowerPts, BAND_COLOR, LINE_WIDTH, false);

    // Middle band (SMA) - dotted
    var middlePts = [];
    for (var i = PERIOD - 1; i < candles.length; i++) {
      if (bands.sma[i] == null) continue;
      var x = toX(candles[i].time);
      if (x < drawX - 10 || x > drawX + drawW + 10) continue;
      middlePts.push({ x: x, y: toY(bands.sma[i]) });
    }
    this._drawLine(ctx, middlePts, MIDDLE_COLOR, LINE_WIDTH, true);

    // Label
    ctx.font = '600 9px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(100, 180, 255, 0.8)';
    ctx.textAlign = 'left';
    ctx.fillText('BB 20,2', drawX + 4, 12);

    ctx.restore();
  };

  BollingerRenderer.prototype._drawLine = function (ctx, pts, color, width, dashed) {
    if (pts.length < 2) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (dashed) {
      ctx.setLineDash([4, 4]);
    } else {
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };

  window.BollingerRenderer = BollingerRenderer;
}());
