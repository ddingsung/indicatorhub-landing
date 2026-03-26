/* HeatmapRenderer — Coinglass-style liquidation heatmap
   Each price level draws a full-width horizontal band.
   Overlapping bands at nearby prices create bright concentration zones. */
(function () {
  'use strict';

  // Coinglass-inspired palette: dark → purple → blue → cyan → green → yellow → white
  var PALETTES = {
    all: [
      [5, 2, 20],       // near-black
      [30, 10, 80],     // deep purple
      [20, 40, 140],    // blue
      [0, 140, 180],    // cyan
      [0, 200, 100],    // green
      [200, 220, 50],   // yellow
      [255, 255, 200]   // bright white-yellow
    ],
    long: [
      [5, 2, 15],
      [50, 5, 30],
      [120, 10, 40],
      [200, 30, 60],
      [255, 60, 80],
      [255, 120, 100],
      [255, 200, 180]
    ],
    short: [
      [2, 5, 15],
      [5, 30, 50],
      [0, 80, 80],
      [0, 150, 100],
      [0, 220, 120],
      [100, 255, 150],
      [200, 255, 220]
    ]
  };

  function lerp(colors, t) {
    t = Math.max(0, Math.min(1, t));
    var n = colors.length - 1, s = t * n, i = Math.floor(s), f = s - i;
    if (i >= n) { i = n - 1; f = 1; }
    var a = colors[i], b = colors[i + 1];
    return [
      Math.round(a[0] + (b[0] - a[0]) * f),
      Math.round(a[1] + (b[1] - a[1]) * f),
      Math.round(a[2] + (b[2] - a[2]) * f)
    ];
  }

  function HeatmapRenderer() {
    this._offCanvas = null;
    this._offCtx    = null;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array} buckets - [{ time, priceLevels: { [price]: { long, short } } }]
   * @param {Object} coord - { drawX, drawW, drawH, timeStart, timeEnd, priceLow, priceHigh }
   * @param {string} viewMode - 'all' | 'long' | 'short'
   */
  HeatmapRenderer.prototype.render = function (ctx, buckets, coord, viewMode) {
    if (!buckets || buckets.length === 0) return;

    var drawX = coord.drawX, drawW = coord.drawW, drawH = coord.drawH;
    var priceLow = coord.priceLow, priceHigh = coord.priceHigh;
    var priceRange = priceHigh - priceLow;
    if (drawW <= 0 || drawH <= 0 || priceRange <= 0) return;

    // Detect price bucket width
    var priceBucketW = this._detectPriceBucketWidth(buckets);
    var cellH = Math.max(1, drawH * priceBucketW / priceRange);

    // Phase 1: Aggregate volumes by price level (collapse time dimension)
    var priceAgg = {};
    for (var bi = 0; bi < buckets.length; bi++) {
      var keys = Object.keys(buckets[bi].priceLevels);
      for (var ki = 0; ki < keys.length; ki++) {
        var pk = keys[ki];
        var cell = buckets[bi].priceLevels[pk];
        var vol = viewMode === 'long' ? (cell.long || 0)
                : viewMode === 'short' ? (cell.short || 0)
                : (cell.long || 0) + (cell.short || 0);
        if (vol <= 0) continue;
        priceAgg[pk] = (priceAgg[pk] || 0) + vol;
      }
    }

    // Phase 2: Find max for normalization
    var maxLog = 0;
    var priceKeys = Object.keys(priceAgg);
    for (var i = 0; i < priceKeys.length; i++) {
      var lv = Math.log1p(priceAgg[priceKeys[i]]);
      if (lv > maxLog) maxLog = lv;
    }
    if (maxLog === 0) return;

    var palette = PALETTES[viewMode] || PALETTES.all;

    // Ensure off-screen canvas
    var offW = Math.ceil(drawW);
    var offH = Math.ceil(drawH);
    if (!this._offCanvas || this._offCanvas.width !== offW || this._offCanvas.height !== offH) {
      this._offCanvas = document.createElement('canvas');
      this._offCanvas.width  = offW;
      this._offCanvas.height = offH;
      this._offCtx = this._offCanvas.getContext('2d');
    }

    var offCtx = this._offCtx;
    offCtx.clearRect(0, 0, offW, offH);
    offCtx.globalCompositeOperation = 'lighter';

    var overlapY = cellH * 0.3;

    // Phase 3: Draw full-width horizontal band per price level
    for (var i = 0; i < priceKeys.length; i++) {
      var pk  = Number(priceKeys[i]);
      var vol = priceAgg[priceKeys[i]];

      var cy = drawH * (1 - (pk + priceBucketW - priceLow) / priceRange);
      if (cy + cellH + overlapY < 0 || cy - overlapY > drawH) continue;

      var t   = Math.min(1, Math.log1p(vol) / maxLog);
      var rgb = lerp(palette, t);

      // Main band — full width
      var alpha = 0.2 + t * 0.7;
      offCtx.fillStyle = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + alpha.toFixed(3) + ')';
      offCtx.fillRect(0, Math.floor(cy - overlapY), offW, Math.ceil(cellH + overlapY * 2));

      // Extra glow for high-intensity levels
      if (t > 0.35) {
        var glowAlpha = (t - 0.35) * 0.35;
        offCtx.fillStyle = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + glowAlpha.toFixed(3) + ')';
        offCtx.fillRect(0, Math.floor(cy - overlapY * 3), offW, Math.ceil(cellH + overlapY * 6));
      }
    }

    offCtx.globalCompositeOperation = 'source-over';

    // Draw to main canvas with blur for smooth gradient feel
    ctx.save();
    ctx.beginPath();
    ctx.rect(drawX, 0, drawW, drawH);
    ctx.clip();

    var blurRadius = Math.max(2, Math.min(10, Math.floor(cellH * 0.6)));
    if (typeof ctx.filter !== 'undefined') {
      ctx.filter = 'blur(' + blurRadius + 'px)';
    }

    ctx.drawImage(this._offCanvas, drawX, 0);

    // Sharp overlay for highlights
    if (typeof ctx.filter !== 'undefined') {
      ctx.filter = 'none';
    }
    ctx.globalAlpha = 0.3;
    ctx.drawImage(this._offCanvas, drawX, 0);
    ctx.globalAlpha = 1;

    ctx.restore();
  };

  HeatmapRenderer.prototype._detectPriceBucketWidth = function (buckets) {
    var allKeys = {};
    for (var i = 0; i < buckets.length; i++) {
      var keys = Object.keys(buckets[i].priceLevels);
      for (var k = 0; k < keys.length; k++) allKeys[keys[k]] = true;
    }
    var sorted = Object.keys(allKeys).map(Number).sort(function (a, b) { return a - b; });
    var minGap = 35;
    for (var i = 1; i < sorted.length; i++) {
      var gap = sorted[i] - sorted[i - 1];
      if (gap > 0 && gap < minGap) minGap = gap;
    }
    return minGap;
  };

  window.HeatmapRenderer = HeatmapRenderer;
}());
