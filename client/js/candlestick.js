/* ═══════════════════════════════════════════
   CandlestickRenderer
   Draws OHLC candlesticks on top of the heatmap canvas.
   ═══════════════════════════════════════════ */

(function () {
  'use strict';

  var AXIS_LEFT   = 70;
  var AXIS_BOTTOM = 28;

  var COLOR_BULL = '#00ff87'; // bullish / green
  var COLOR_BEAR = '#ff3d71'; // bearish / red

  /**
   * CandlestickRenderer
   * @param {HTMLCanvasElement} canvas - Same canvas as HeatmapRenderer
   */
  function CandlestickRenderer(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
  }

  /**
   * Draw candlesticks over the existing heatmap.
   *
   * @param {Array} candles - Array of candle objects:
   *   { open, high, low, close, time (unix ms or s) }
   * @param {Object} opts
   *   - priceLow:  number  (bottom of price viewport)
   *   - priceHigh: number  (top of price viewport)
   *   - W:         number  (total canvas CSS width)
   *   - H:         number  (total canvas CSS height)
   */
  CandlestickRenderer.prototype.render = function (candles, opts) {
    if (!candles || candles.length === 0) return;

    opts = opts || {};
    var priceLow  = opts.priceLow;
    var priceHigh = opts.priceHigh;
    var W         = opts.W;
    var H         = opts.H;

    if (priceLow == null || priceHigh == null || priceLow >= priceHigh) return;

    var ctx    = this.ctx;
    var drawX  = AXIS_LEFT;
    var drawW  = W - AXIS_LEFT - 60; // AXIS_RIGHT = 60
    var drawH  = H - AXIS_BOTTOM;

    var nCandles   = candles.length;
    var candleW    = drawW / nCandles;
    var bodyMinW   = Math.max(1, candleW * 0.6);
    var bodyOffset = (candleW - bodyMinW) / 2;

    /**
     * Map a price value to a Y pixel coordinate.
     * Higher price → smaller Y (top of canvas).
     */
    function priceToY(price) {
      var frac = (price - priceLow) / (priceHigh - priceLow);
      return drawH * (1 - frac);
    }

    candles.forEach(function (candle, i) {
      var open  = candle.open;
      var high  = candle.high;
      var low   = candle.low;
      var close = candle.close;

      var isBull = close >= open;
      var color  = isBull ? COLOR_BULL : COLOR_BEAR;

      var x = drawX + i * candleW;

      // Wick
      var wickX  = x + candleW / 2;
      var highY  = priceToY(high);
      var lowY   = priceToY(low);

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(wickX) + 0.5, Math.round(highY));
      ctx.lineTo(Math.round(wickX) + 0.5, Math.round(lowY));
      ctx.stroke();

      // Body
      var bodyTop    = priceToY(Math.max(open, close));
      var bodyBottom = priceToY(Math.min(open, close));
      var bodyH      = Math.max(1, bodyBottom - bodyTop);

      ctx.fillStyle = color;
      ctx.fillRect(
        Math.floor(x + bodyOffset),
        Math.floor(bodyTop),
        Math.ceil(bodyMinW),
        Math.ceil(bodyH)
      );

      ctx.restore();
    });
  };

  /* ── expose globally ─────────────────────────────────────────────── */
  window.CandlestickRenderer = CandlestickRenderer;

}());
