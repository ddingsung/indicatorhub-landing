/* VPVRRenderer — Volume Profile Visible Range
   Cyberpunk-styled horizontal volume bars with neon glow. */
(function () {
  'use strict';

  var NUM_BINS      = 80;
  var MAX_BAR_RATIO = 0.45; // max bar width = 45% of chart width

  function VPVRRenderer() {}

  VPVRRenderer.prototype.render = function (ctx, candles, coord) {
    if (!candles || candles.length === 0) return;

    var drawX = coord.drawX, drawW = coord.drawW, drawH = coord.drawH;
    var priceLow = coord.priceLow, priceHigh = coord.priceHigh;
    var priceRange = priceHigh - priceLow;
    if (priceRange <= 0 || drawW <= 0 || drawH <= 0) return;

    var binSize = priceRange / NUM_BINS;

    var bins = new Array(NUM_BINS);
    for (var i = 0; i < NUM_BINS; i++) {
      bins[i] = { buy: 0, sell: 0 };
    }

    for (var ci = 0; ci < candles.length; ci++) {
      var c = candles[ci];
      if (c.time < coord.timeStart || c.time > coord.timeEnd) continue;
      if (!c.volume || c.volume <= 0) continue;

      var cLow  = Math.max(c.low, priceLow);
      var cHigh = Math.min(c.high, priceHigh);
      if (cLow >= cHigh) continue;

      var isBull = c.close >= c.open;
      var binLow  = Math.max(0, Math.floor((cLow - priceLow) / binSize));
      var binHigh = Math.min(NUM_BINS - 1, Math.floor((cHigh - priceLow) / binSize));
      var numBins = binHigh - binLow + 1;
      var volPerBin = c.volume / numBins;

      for (var b = binLow; b <= binHigh; b++) {
        if (isBull) bins[b].buy += volPerBin;
        else bins[b].sell += volPerBin;
      }
    }

    var maxVol = 0, pocIdx = 0;
    for (var i = 0; i < NUM_BINS; i++) {
      var total = bins[i].buy + bins[i].sell;
      if (total > maxVol) { maxVol = total; pocIdx = i; }
    }
    if (maxVol === 0) return;

    var maxBarW = drawW * MAX_BAR_RATIO;
    var barH = drawH / NUM_BINS;

    ctx.save();
    ctx.beginPath();
    ctx.rect(drawX, 0, drawW, drawH);
    ctx.clip();

    // Draw bars with neon cyberpunk gradients
    for (var i = 0; i < NUM_BINS; i++) {
      var buy  = bins[i].buy;
      var sell = bins[i].sell;
      var total = buy + sell;
      if (total <= 0) continue;

      var ratio = total / maxVol;
      var barW = ratio * maxBarW;
      var y = drawH - (i + 1) * barH;
      var x = drawX + drawW - barW;
      var isPoc = i === pocIdx;

      var buyW  = (buy / total) * barW;
      var sellW = barW - buyW;

      // Glow layer (behind the bar)
      if (ratio > 0.3) {
        var glowAlpha = ratio * 0.15;
        ctx.shadowColor = isPoc ? 'rgba(255,215,0,0.6)' : 'rgba(255,0,200,0.3)';
        ctx.shadowBlur = 8;
      } else {
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
      }

      // Sell portion — neon gold / yellow
      if (sellW > 0.5) {
        var sellGrad = ctx.createLinearGradient(x, 0, x + sellW, 0);
        sellGrad.addColorStop(0, 'rgba(255,215,0,' + (0.12 + ratio * 0.3).toFixed(2) + ')');
        sellGrad.addColorStop(1, 'rgba(255,180,0,' + (0.15 + ratio * 0.35).toFixed(2) + ')');
        ctx.fillStyle = sellGrad;
        ctx.fillRect(x, y, sellW, barH - 0.5);
      }

      // Buy portion — electric pink / fuchsia
      if (buyW > 0.5) {
        var buyGrad = ctx.createLinearGradient(x + sellW, 0, x + sellW + buyW, 0);
        buyGrad.addColorStop(0, 'rgba(255,0,200,' + (0.15 + ratio * 0.35).toFixed(2) + ')');
        buyGrad.addColorStop(1, 'rgba(200,0,255,' + (0.12 + ratio * 0.3).toFixed(2) + ')');
        ctx.fillStyle = buyGrad;
        ctx.fillRect(x + sellW, y, buyW, barH - 0.5);
      }

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;

      // Bright edge line on high-volume bars
      if (ratio > 0.5) {
        ctx.strokeStyle = isPoc
          ? 'rgba(255,215,0,' + (ratio * 0.6).toFixed(2) + ')'
          : 'rgba(255,0,200,' + (ratio * 0.4).toFixed(2) + ')';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, barW - 1, barH - 1.5);
      }
    }

    // POC line — neon magenta
    var pocY = drawH - (pocIdx + 0.5) * barH;
    ctx.shadowColor = 'rgba(255,215,0,0.7)';
    ctx.shadowBlur = 6;
    ctx.strokeStyle = 'rgba(255,215,0,0.8)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(drawX, Math.round(pocY) + 0.5);
    ctx.lineTo(drawX + drawW, Math.round(pocY) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    // POC label
    ctx.font = '700 9px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,215,0,0.9)';
    ctx.textAlign = 'left';
    ctx.fillText('POC', drawX + 4, pocY - 4);

    ctx.restore();
  };

  window.VPVRRenderer = VPVRRenderer;
}());
