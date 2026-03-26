/* RSIPanelRenderer — RSI (14-period) drawn in a separate mini panel.
   Includes overbought/oversold zones (70/30) with colored fills. */
(function () {
  'use strict';

  var RSI_PERIOD    = 14;
  var LINE_COLOR    = '#00b4ff';
  var LINE_WIDTH    = 1.5;
  var OVER_BOUGHT   = 70;
  var OVER_SOLD     = 30;
  var REF_LINE_COLOR = 'rgba(90, 99, 128, 0.5)';
  var OVERBOUGHT_FILL = 'rgba(255, 23, 68, 0.08)';
  var OVERSOLD_FILL   = 'rgba(0, 255, 65, 0.08)';
  var LABEL_COLOR   = 'rgba(200, 214, 229, 0.6)';

  function RSIPanelRenderer() {}

  /**
   * Compute RSI values using Wilder's smoothing.
   */
  RSIPanelRenderer.prototype._calcRSI = function (candles) {
    var rsi = new Array(candles.length);
    if (candles.length < RSI_PERIOD + 1) return rsi;

    var gains = 0, losses = 0;
    for (var i = 1; i <= RSI_PERIOD; i++) {
      var diff = candles[i].close - candles[i - 1].close;
      if (diff > 0) gains += diff;
      else losses -= diff;
    }

    var avgGain = gains / RSI_PERIOD;
    var avgLoss = losses / RSI_PERIOD;
    rsi[RSI_PERIOD] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

    for (var i = RSI_PERIOD + 1; i < candles.length; i++) {
      var diff = candles[i].close - candles[i - 1].close;
      var gain = diff > 0 ? diff : 0;
      var loss = diff < 0 ? -diff : 0;
      avgGain = (avgGain * (RSI_PERIOD - 1) + gain) / RSI_PERIOD;
      avgLoss = (avgLoss * (RSI_PERIOD - 1) + loss) / RSI_PERIOD;
      rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }

    return rsi;
  };

  /**
   * Render RSI panel onto its own canvas context.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array} candles
   * @param {Object} coord - main chart coord (uses timeStart, timeEnd, drawX, drawW)
   * @param {number} panelH - height of the RSI panel in CSS pixels
   */
  RSIPanelRenderer.prototype.render = function (ctx, candles, coord, panelH) {
    if (!candles || candles.length < RSI_PERIOD + 2) return;

    var drawX = coord.drawX;
    var drawW = coord.drawW;
    var timeStart = coord.timeStart, timeEnd = coord.timeEnd;
    var timeRange = timeEnd - timeStart;
    if (timeRange <= 0 || drawW <= 0 || panelH <= 0) return;

    var interval = candles.length > 1 ? candles[1].time - candles[0].time : timeRange;
    var colW = Math.max(1, drawW * interval / timeRange);

    var rsi = this._calcRSI(candles);

    function toX(time) {
      return drawX + (time - timeStart) / timeRange * drawW + colW / 2;
    }
    function toY(rsiVal) {
      // RSI 0-100 mapped to panelH-2 to 2 (2px padding top/bottom)
      return 2 + (panelH - 4) * (1 - rsiVal / 100);
    }

    ctx.save();

    // Background
    ctx.fillStyle = '#05050f';
    ctx.fillRect(0, 0, drawX + drawW + 70, panelH);

    // Clip to draw area
    ctx.beginPath();
    ctx.rect(drawX, 0, drawW, panelH);
    ctx.clip();

    // Overbought zone fill (above 70)
    var y70 = toY(OVER_BOUGHT);
    ctx.fillStyle = OVERBOUGHT_FILL;
    ctx.fillRect(drawX, 0, drawW, y70);

    // Oversold zone fill (below 30)
    var y30 = toY(OVER_SOLD);
    ctx.fillStyle = OVERSOLD_FILL;
    ctx.fillRect(drawX, y30, drawW, panelH - y30);

    // Reference lines at 30, 50, 70
    ctx.strokeStyle = REF_LINE_COLOR;
    ctx.lineWidth = 0.5;
    ctx.setLineDash([3, 3]);

    var refLevels = [OVER_SOLD, 50, OVER_BOUGHT];
    for (var r = 0; r < refLevels.length; r++) {
      var ry = Math.round(toY(refLevels[r])) + 0.5;
      ctx.beginPath();
      ctx.moveTo(drawX, ry);
      ctx.lineTo(drawX + drawW, ry);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // RSI line
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = LINE_COLOR;
    ctx.shadowBlur = 3;

    ctx.beginPath();
    var started = false;
    for (var i = RSI_PERIOD; i < candles.length; i++) {
      if (rsi[i] == null) continue;
      var x = toX(candles[i].time);
      if (x < drawX - 10 || x > drawX + drawW + 10) continue;
      var y = toY(rsi[i]);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    ctx.restore();

    // Labels (drawn outside clip)
    ctx.save();
    ctx.font = '600 9px "JetBrains Mono", monospace';
    ctx.fillStyle = LABEL_COLOR;
    ctx.textAlign = 'left';
    ctx.fillText('RSI 14', drawX + 4, 11);

    // Reference level labels on right side
    ctx.font = '400 8px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(90, 99, 128, 0.7)';
    ctx.textAlign = 'left';
    var labelX = drawX + drawW + 6;
    ctx.fillText('70', labelX, toY(OVER_BOUGHT) + 3);
    ctx.fillText('50', labelX, toY(50) + 3);
    ctx.fillText('30', labelX, toY(OVER_SOLD) + 3);

    ctx.restore();
  };

  window.RSIPanelRenderer = RSIPanelRenderer;
}());
