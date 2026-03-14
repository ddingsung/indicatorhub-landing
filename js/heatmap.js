/* ═══════════════════════════════════════════
   HeatmapRenderer
   Renders liquidation volume as a color-coded heatmap on a canvas.

   Accepts bucket data in array format from server:
     [{ time, priceLevels: { [priceKey]: { long, short } } }]
   ═══════════════════════════════════════════ */

(function () {
  'use strict';

  var AXIS_LEFT   = 70;
  var AXIS_RIGHT  = 60;
  var AXIS_BOTTOM = 28;

  var PALETTES = {
    all:   [[10,14,28], [26,58,92], [240,192,64], [255,61,61]],
    long:  [[10,14,28], [80,20,20], [200,40,40], [255,61,113]],
    short: [[10,14,28], [15,60,30], [0,180,90], [0,255,135]]
  };

  function lerpColor(colors, t) {
    if (t <= 0) return colors[0].slice();
    if (t >= 1) return colors[colors.length - 1].slice();

    var segments = colors.length - 1;
    var scaled   = t * segments;
    var idx      = Math.floor(scaled);
    var frac     = scaled - idx;

    if (idx >= segments) { idx = segments - 1; frac = 1; }

    var a = colors[idx];
    var b = colors[idx + 1];
    return [
      Math.round(a[0] + (b[0] - a[0]) * frac),
      Math.round(a[1] + (b[1] - a[1]) * frac),
      Math.round(a[2] + (b[2] - a[2]) * frac)
    ];
  }

  function HeatmapRenderer(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.dpr    = window.devicePixelRatio || 1;
  }

  HeatmapRenderer.prototype.resize = function () {
    var container = this.canvas.parentElement;
    if (!container) return;

    var w   = container.clientWidth;
    var h   = container.clientHeight;
    var dpr = window.devicePixelRatio || 1;

    this.dpr          = dpr;
    this.canvas.width  = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width  = w + 'px';
    this.canvas.style.height = h + 'px';

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  /**
   * Render heatmap buckets onto the canvas.
   *
   * @param {Array} buckets - Array of { time, priceLevels: { [price]: { long, short } } }
   * @param {Object} opts
   *   - viewMode: 'all' | 'long' | 'short'
   *   - currentPrice: number
   *   - priceRange: number (fraction, default 0.02 = ±2%)
   * @returns {{ priceLow, priceHigh, times, bucketWidth }}
   */
  HeatmapRenderer.prototype.render = function (buckets, opts) {
    opts = opts || {};
    var viewMode     = opts.viewMode     || 'all';
    var currentPrice = opts.currentPrice || 0;
    var priceRange   = opts.priceRange   != null ? opts.priceRange : 0.02;

    var ctx    = this.ctx;
    var canvas = this.canvas;
    var W      = canvas.width  / this.dpr;
    var H      = canvas.height / this.dpr;

    ctx.clearRect(0, 0, W, H);

    var drawX = AXIS_LEFT;
    var drawW = W - AXIS_LEFT - AXIS_RIGHT;
    var drawH = H - AXIS_BOTTOM;

    if (!buckets || buckets.length === 0) {
      this._drawMessage(ctx, drawX + drawW / 2, drawH / 2, '데이터 수집 중...');
      return { priceLow: 0, priceHigh: 0, times: [], bucketWidth: 0 };
    }

    // Extract sorted times from array
    var times = buckets.map(function (b) { return b.time; });

    // Price range
    var priceLow, priceHigh;
    if (currentPrice > 0) {
      priceLow  = currentPrice * (1 - priceRange);
      priceHigh = currentPrice * (1 + priceRange);
    } else {
      var allPrices = [];
      buckets.forEach(function (b) {
        Object.keys(b.priceLevels).forEach(function (p) { allPrices.push(Number(p)); });
      });
      if (allPrices.length === 0) {
        this._drawMessage(ctx, drawX + drawW / 2, drawH / 2, '범위 내 청산 데이터 없음');
        return { priceLow: 0, priceHigh: 0, times: times, bucketWidth: 0 };
      }
      priceLow  = Math.min.apply(null, allPrices);
      priceHigh = Math.max.apply(null, allPrices);
      var margin = (priceHigh - priceLow) * 0.05 || 50;
      priceLow  -= margin;
      priceHigh += margin;
    }

    // Collect price keys in range
    var priceKeysSet = {};
    buckets.forEach(function (b) {
      Object.keys(b.priceLevels).forEach(function (pk) {
        var p = Number(pk);
        if (p >= priceLow && p <= priceHigh) {
          priceKeysSet[pk] = true;
        }
      });
    });
    var priceKeys = Object.keys(priceKeysSet).map(Number).sort(function (a, b) { return a - b; });

    if (priceKeys.length === 0) {
      this._drawMessage(ctx, drawX + drawW / 2, drawH / 2, '범위 내 청산 데이터 없음');
      return { priceLow: priceLow, priceHigh: priceHigh, times: times, bucketWidth: 0 };
    }

    // Find max log-volume in viewport
    var maxLogVol = 0;
    buckets.forEach(function (b) {
      priceKeys.forEach(function (pk) {
        var cell = b.priceLevels[pk] || b.priceLevels[String(pk)];
        if (!cell) return;
        var vol = 0;
        if (viewMode === 'all')       vol = (cell.long || 0) + (cell.short || 0);
        else if (viewMode === 'long') vol = cell.long || 0;
        else                          vol = cell.short || 0;
        var logVol = Math.log1p(vol);
        if (logVol > maxLogVol) maxLogVol = logVol;
      });
    });

    if (maxLogVol === 0) maxLogVol = 1;

    var nCols       = buckets.length;
    var colWidth    = drawW / nCols;
    var palette     = PALETTES[viewMode] || PALETTES.all;

    // Draw cells
    buckets.forEach(function (bucket, colIdx) {
      var cellX = drawX + colIdx * colWidth;

      priceKeys.forEach(function (pk) {
        var cell = bucket.priceLevels[pk] || bucket.priceLevels[String(pk)];
        if (!cell) return;

        var vol = 0;
        if (viewMode === 'all')       vol = (cell.long || 0) + (cell.short || 0);
        else if (viewMode === 'long') vol = cell.long || 0;
        else                          vol = cell.short || 0;

        if (vol <= 0) return;

        var logVol = Math.log1p(vol);
        var t01    = Math.min(1, logVol / maxLogVol);
        var rgb    = lerpColor(palette, t01);

        var priceFrac = (pk - priceLow) / (priceHigh - priceLow);
        var cellY     = drawH * (1 - priceFrac);

        var priceStep = (priceHigh - priceLow) / priceKeys.length;
        var cellH     = Math.max(1, drawH * priceStep / (priceHigh - priceLow));

        ctx.fillStyle = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0.9)';
        ctx.fillRect(
          Math.floor(cellX),
          Math.floor(cellY - cellH),
          Math.ceil(colWidth) + 1,
          Math.ceil(cellH) + 1
        );
      });
    });

    // Current price line
    if (currentPrice >= priceLow && currentPrice <= priceHigh) {
      var priceFracLine = (currentPrice - priceLow) / (priceHigh - priceLow);
      var lineY = drawH * (1 - priceFracLine);

      ctx.save();
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth   = 1;
      ctx.setLineDash([4, 4]);
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(drawX, lineY);
      ctx.lineTo(drawX + drawW, lineY);
      ctx.stroke();
      ctx.restore();
    }

    return {
      priceLow:    priceLow,
      priceHigh:   priceHigh,
      times:       times,
      bucketWidth: colWidth
    };
  };

  HeatmapRenderer.prototype._drawMessage = function (ctx, x, y, msg) {
    ctx.save();
    ctx.font      = '13px "JetBrains Mono", monospace';
    ctx.fillStyle = '#4a5568';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(msg, x, y);
    ctx.restore();
  };

  window.HeatmapRenderer = HeatmapRenderer;

}());
