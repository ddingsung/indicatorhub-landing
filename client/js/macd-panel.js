/* MACDPanelRenderer — MACD indicator in a separate mini panel.
   MACD line (blue), Signal line (orange), Histogram (green/red bars). */
(function () {
  'use strict';

  var FAST_PERIOD   = 12;
  var SLOW_PERIOD   = 26;
  var SIGNAL_PERIOD = 9;
  var MACD_COLOR    = '#00b4ff';
  var SIGNAL_COLOR  = '#ff9800';
  var HIST_GREEN    = 'rgba(0, 255, 65, 0.6)';
  var HIST_RED      = 'rgba(255, 23, 68, 0.6)';
  var LINE_WIDTH    = 1.2;
  var LABEL_COLOR   = 'rgba(200, 214, 229, 0.6)';
  var ZERO_LINE_COLOR = 'rgba(90, 99, 128, 0.5)';

  function MACDPanelRenderer() {}

  /**
   * Compute EMA for given period.
   */
  MACDPanelRenderer.prototype._calcEMA = function (values, period) {
    var ema = new Array(values.length);
    var k = 2 / (period + 1);

    // Find first valid index
    var firstValid = -1;
    for (var i = 0; i < values.length; i++) {
      if (values[i] != null) { firstValid = i; break; }
    }
    if (firstValid < 0) return ema;

    // Need at least `period` values from firstValid
    if (firstValid + period > values.length) return ema;

    // Seed with SMA
    var sum = 0;
    for (var i = firstValid; i < firstValid + period; i++) {
      sum += values[i];
    }
    var seedIdx = firstValid + period - 1;
    ema[seedIdx] = sum / period;

    for (var i = seedIdx + 1; i < values.length; i++) {
      if (values[i] == null) continue;
      ema[i] = values[i] * k + ema[i - 1] * (1 - k);
    }

    return ema;
  };

  /**
   * Compute MACD, signal, and histogram arrays.
   */
  MACDPanelRenderer.prototype._calcMACD = function (candles) {
    var closes = [];
    for (var i = 0; i < candles.length; i++) {
      closes.push(candles[i].close);
    }

    var emaFast = this._calcEMA(closes, FAST_PERIOD);
    var emaSlow = this._calcEMA(closes, SLOW_PERIOD);

    // MACD line = fast EMA - slow EMA
    var macdLine = new Array(candles.length);
    for (var i = 0; i < candles.length; i++) {
      if (emaFast[i] != null && emaSlow[i] != null) {
        macdLine[i] = emaFast[i] - emaSlow[i];
      }
    }

    // Signal line = 9-period EMA of MACD line
    var signalLine = this._calcEMA(macdLine, SIGNAL_PERIOD);

    // Histogram = MACD - Signal
    var histogram = new Array(candles.length);
    for (var i = 0; i < candles.length; i++) {
      if (macdLine[i] != null && signalLine[i] != null) {
        histogram[i] = macdLine[i] - signalLine[i];
      }
    }

    return { macd: macdLine, signal: signalLine, histogram: histogram };
  };

  /**
   * Render MACD panel onto its own canvas context.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array} candles
   * @param {Object} coord - main chart coord (uses timeStart, timeEnd, drawX, drawW)
   * @param {number} panelH - height of the MACD panel in CSS pixels
   */
  MACDPanelRenderer.prototype.render = function (ctx, candles, coord, panelH) {
    if (!candles || candles.length < SLOW_PERIOD + SIGNAL_PERIOD) return;

    var drawX = coord.drawX;
    var drawW = coord.drawW;
    var timeStart = coord.timeStart, timeEnd = coord.timeEnd;
    var timeRange = timeEnd - timeStart;
    if (timeRange <= 0 || drawW <= 0 || panelH <= 0) return;

    var interval = candles.length > 1 ? candles[1].time - candles[0].time : timeRange;
    var colW = Math.max(1, drawW * interval / timeRange);

    var data = this._calcMACD(candles);

    // Find value range for scaling
    var minVal = Infinity, maxVal = -Infinity;
    for (var i = 0; i < candles.length; i++) {
      if (data.macd[i] != null) {
        if (data.macd[i] < minVal) minVal = data.macd[i];
        if (data.macd[i] > maxVal) maxVal = data.macd[i];
      }
      if (data.signal[i] != null) {
        if (data.signal[i] < minVal) minVal = data.signal[i];
        if (data.signal[i] > maxVal) maxVal = data.signal[i];
      }
      if (data.histogram[i] != null) {
        if (data.histogram[i] < minVal) minVal = data.histogram[i];
        if (data.histogram[i] > maxVal) maxVal = data.histogram[i];
      }
    }

    if (minVal >= maxVal) return;

    // Ensure zero is visible, pad symmetrically
    var absMax = Math.max(Math.abs(minVal), Math.abs(maxVal)) * 1.1;
    minVal = -absMax;
    maxVal = absMax;
    var valRange = maxVal - minVal;

    function toX(time) {
      return drawX + (time - timeStart) / timeRange * drawW + colW / 2;
    }
    function toY(val) {
      return 2 + (panelH - 4) * (1 - (val - minVal) / valRange);
    }

    ctx.save();

    // Background
    ctx.fillStyle = '#05050f';
    ctx.fillRect(0, 0, drawX + drawW + 70, panelH);

    // Clip
    ctx.beginPath();
    ctx.rect(drawX, 0, drawW, panelH);
    ctx.clip();

    // Zero line
    var zeroY = Math.round(toY(0)) + 0.5;
    ctx.strokeStyle = ZERO_LINE_COLOR;
    ctx.lineWidth = 0.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(drawX, zeroY);
    ctx.lineTo(drawX + drawW, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Histogram bars
    var barW = Math.max(1, colW * 0.5);
    for (var i = 0; i < candles.length; i++) {
      if (data.histogram[i] == null) continue;
      var x = toX(candles[i].time);
      if (x < drawX - colW || x > drawX + drawW + colW) continue;

      var hVal = data.histogram[i];
      var barTop, barHeight;

      if (hVal >= 0) {
        barTop = toY(hVal);
        barHeight = zeroY - barTop;
        ctx.fillStyle = HIST_GREEN;
      } else {
        barTop = zeroY;
        barHeight = toY(hVal) - zeroY;
        ctx.fillStyle = HIST_RED;
      }

      ctx.fillRect(Math.floor(x - barW / 2), Math.floor(barTop), Math.ceil(barW), Math.max(1, Math.ceil(barHeight)));
    }

    // MACD line
    ctx.strokeStyle = MACD_COLOR;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();
    var started = false;
    for (var i = 0; i < candles.length; i++) {
      if (data.macd[i] == null) continue;
      var x = toX(candles[i].time);
      if (x < drawX - 10 || x > drawX + drawW + 10) continue;
      var y = toY(data.macd[i]);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else { ctx.lineTo(x, y); }
    }
    ctx.stroke();

    // Signal line
    ctx.strokeStyle = SIGNAL_COLOR;
    ctx.lineWidth = LINE_WIDTH;

    ctx.beginPath();
    started = false;
    for (var i = 0; i < candles.length; i++) {
      if (data.signal[i] == null) continue;
      var x = toX(candles[i].time);
      if (x < drawX - 10 || x > drawX + drawW + 10) continue;
      var y = toY(data.signal[i]);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else { ctx.lineTo(x, y); }
    }
    ctx.stroke();

    ctx.restore();

    // Labels (outside clip)
    ctx.save();
    ctx.font = '600 9px "JetBrains Mono", monospace';
    ctx.fillStyle = LABEL_COLOR;
    ctx.textAlign = 'left';
    ctx.fillText('MACD', drawX + 4, 11);

    // Legend
    ctx.font = '400 8px "JetBrains Mono", monospace';
    ctx.fillStyle = MACD_COLOR;
    ctx.fillText('MACD', drawX + 44, 11);
    ctx.fillStyle = SIGNAL_COLOR;
    ctx.fillText('SIG', drawX + 80, 11);

    // Zero label on right
    ctx.fillStyle = 'rgba(90, 99, 128, 0.7)';
    ctx.textAlign = 'left';
    ctx.fillText('0', drawX + drawW + 6, toY(0) + 3);

    ctx.restore();
  };

  window.MACDPanelRenderer = MACDPanelRenderer;
}());
