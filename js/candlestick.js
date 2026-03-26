/* CandlestickRenderer — draws OHLC candles on shared coordinate space */
(function () {
  'use strict';

  var COLOR_BULL = '#26a69a';
  var COLOR_BEAR = '#ef5350';

  function CandlestickRenderer() {}

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array} candles - [{ open, high, low, close, time }]
   * @param {Object} coord  - { drawX, drawW, drawH, timeStart, timeEnd, priceLow, priceHigh }
   */
  CandlestickRenderer.prototype.render = function (ctx, candles, coord) {
    if (!candles || candles.length === 0) return;

    var drawX = coord.drawX, drawW = coord.drawW, drawH = coord.drawH;
    var timeStart = coord.timeStart, timeEnd = coord.timeEnd;
    var priceLow = coord.priceLow, priceHigh = coord.priceHigh;
    var timeRange  = timeEnd - timeStart;
    var priceRange = priceHigh - priceLow;
    if (timeRange <= 0 || priceRange <= 0) return;

    // Candle width based on interval
    var interval = candles.length > 1 ? candles[1].time - candles[0].time : timeRange;
    var colW  = Math.max(1, drawW * interval / timeRange);
    var bodyW = Math.max(1, colW * 0.6);

    function toY(price) {
      return drawH * (1 - (price - priceLow) / priceRange);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(drawX, 0, drawW, drawH);
    ctx.clip();

    for (var i = 0; i < candles.length; i++) {
      var c = candles[i];
      var cx = drawX + (c.time - timeStart) / timeRange * drawW + colW / 2;

      // Skip if outside
      if (cx + colW < drawX || cx - colW > drawX + drawW) continue;

      var isBull = c.close >= c.open;
      var color  = isBull ? COLOR_BULL : COLOR_BEAR;

      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(cx) + 0.5, Math.round(toY(c.high)));
      ctx.lineTo(Math.round(cx) + 0.5, Math.round(toY(c.low)));
      ctx.stroke();

      // Body
      var bodyTop = toY(Math.max(c.open, c.close));
      var bodyBot = toY(Math.min(c.open, c.close));
      var bodyH   = Math.max(1, bodyBot - bodyTop);
      ctx.fillStyle = color;
      ctx.fillRect(Math.floor(cx - bodyW / 2), Math.floor(bodyTop), Math.ceil(bodyW), Math.ceil(bodyH));
    }

    ctx.restore();
  };

  window.CandlestickRenderer = CandlestickRenderer;
}());
