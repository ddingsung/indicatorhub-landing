/* VolumeBarRenderer — Traditional vertical volume bars at the bottom of the main chart.
   Green for bullish candles, red for bearish. Semi-transparent.
   Max height = 20% of chart height. */
(function () {
  'use strict';

  var COLOR_BULL = 'rgba(38, 166, 154, 0.35)';
  var COLOR_BEAR = 'rgba(239, 83, 80, 0.35)';
  var MAX_HEIGHT_RATIO = 0.20; // 20% of chart height

  function VolumeBarRenderer() {}

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array} candles - [{ open, high, low, close, volume, time }]
   * @param {Object} coord  - { drawX, drawW, drawH, timeStart, timeEnd, priceLow, priceHigh }
   */
  VolumeBarRenderer.prototype.render = function (ctx, candles, coord) {
    if (!candles || candles.length === 0) return;

    var drawX = coord.drawX, drawW = coord.drawW, drawH = coord.drawH;
    var timeStart = coord.timeStart, timeEnd = coord.timeEnd;
    var timeRange = timeEnd - timeStart;
    if (timeRange <= 0 || drawW <= 0 || drawH <= 0) return;

    var interval = candles.length > 1 ? candles[1].time - candles[0].time : timeRange;
    var colW = Math.max(1, drawW * interval / timeRange);
    var barW = Math.max(1, colW * 0.6);

    // Find max volume for normalization
    var maxVol = 0;
    for (var i = 0; i < candles.length; i++) {
      var v = candles[i].volume || 0;
      if (v > maxVol) maxVol = v;
    }
    if (maxVol <= 0) return;

    var maxBarH = drawH * MAX_HEIGHT_RATIO;

    ctx.save();
    ctx.beginPath();
    ctx.rect(drawX, 0, drawW, drawH);
    ctx.clip();

    for (var i = 0; i < candles.length; i++) {
      var c = candles[i];
      var vol = c.volume || 0;
      if (vol <= 0) continue;

      var cx = drawX + (c.time - timeStart) / timeRange * drawW + colW / 2;
      if (cx + colW < drawX || cx - colW > drawX + drawW) continue;

      var isBull = c.close >= c.open;
      var barH = (vol / maxVol) * maxBarH;
      var barY = drawH - barH;

      ctx.fillStyle = isBull ? COLOR_BULL : COLOR_BEAR;
      ctx.fillRect(Math.floor(cx - barW / 2), Math.floor(barY), Math.ceil(barW), Math.ceil(barH));
    }

    // "VOL" label
    ctx.font = '600 9px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(200, 214, 229, 0.4)';
    ctx.textAlign = 'left';
    ctx.fillText('VOL', drawX + 4, drawH - maxBarH + 11);

    ctx.restore();
  };

  window.VolumeBarRenderer = VolumeBarRenderer;
}());
