/* ═══════════════════════════════════════════
   app.js — Liquidation Heatmap Dashboard
   Orchestrates WebSocket, rendering, controls, feed, and viewport.

   Server protocol (version: 1):
     snapshot:      { heatmap: { buckets }, candles, currentPrice, binanceConnected, collectingSince }
     liquidation:   { side, price, quantity, timestamp }
     candle_update: { candle: { open, high, low, close, volume, time } }
     status:        { binanceConnected, collectingSince }
   ═══════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Constants ───────────────────────────── */
  var AXIS_LEFT   = 0;
  var AXIS_RIGHT  = 70;
  var AXIS_BOTTOM = 24;
  var SNAPSHOT_REFRESH_MS = 30000;

  /* ── Application state ──────────────────── */
  var state = {
    heatmapBuckets:     [],
    candles:            [],
    currentPrice:       0,
    collectingSince:    null,
    recentLiquidations: [],
    activeTimeframe:    '24h'  // track which timeframe we last subscribed
  };

  /* ── DOM refs ────────────────────────────── */
  var canvas       = document.getElementById('mainCanvas');
  var ctx          = canvas.getContext('2d');
  var overlayCV    = document.getElementById('overlayCanvas');
  var overlayCtx   = overlayCV.getContext('2d');
  var chartCont    = document.getElementById('chartContainer');
  var yAxisEl      = document.getElementById('yAxis');
  var xAxisEl      = document.getElementById('xAxis');
  var priceTagEl   = document.getElementById('priceTag');
  var crosshairXEl = document.getElementById('crosshairX');
  var crosshairYEl = document.getElementById('crosshairY');
  var feedListEl   = document.getElementById('feedList');
  var noticeTxtEl  = document.getElementById('noticeText');
  var statusDot    = document.getElementById('statusDot');
  var priceEl      = document.getElementById('currentPrice');

  /* ── Indicator state ────────────────────── */
  var indicators = {
    vpvr:      true,   // ON by default
    ema:       false,  // OFF by default
    bollinger: false,  // OFF by default
    rsi:       false,  // OFF by default
    macd:      false,  // OFF by default
    volume:    false   // OFF by default
  };

  /* ── Renderers & Controls ────────────────── */
  var candlestick  = new window.CandlestickRenderer();
  var vpvr         = new window.VPVRRenderer();
  var signals      = new window.SignalRenderer();
  var emaRenderer  = new window.EMARenderer();
  var bollinger    = new window.BollingerRenderer();
  var rsiPanel     = new window.RSIPanelRenderer();
  var macdPanel    = new window.MACDPanelRenderer();
  var volumeBars   = new window.VolumeBarRenderer();
  var controls     = new window.Controls();
  controls.init();

  /* ── Indicator panel DOM refs ──────────── */
  var rsiPanelEl   = document.getElementById('rsiPanel');
  var rsiCanvasEl  = document.getElementById('rsiCanvas');
  var rsiCtx       = rsiCanvasEl ? rsiCanvasEl.getContext('2d') : null;
  var macdPanelEl  = document.getElementById('macdPanel');
  var macdCanvasEl = document.getElementById('macdCanvas');
  var macdCtx      = macdCanvasEl ? macdCanvasEl.getContext('2d') : null;

  /* ═══════════════════════════════════════════
     Canvas sizing (devicePixelRatio aware)
  ═══════════════════════════════════════════ */
  function resizeCanvas() {
    var dpr = window.devicePixelRatio || 1;
    var rect = chartCont.getBoundingClientRect();
    var w = Math.floor(rect.width);
    var h = Math.floor(rect.height);
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Overlay canvas (crosshair lines)
    overlayCV.width  = w * dpr;
    overlayCV.height = h * dpr;
    overlayCV.style.width  = w + 'px';
    overlayCV.style.height = h + 'px';
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { W: w, H: h };
  }

  /* ═══════════════════════════════════════════
     Coordinate system — single source of truth
  ═══════════════════════════════════════════ */

  function computeCoord(W, H) {
    var drawX = AXIS_LEFT;
    var drawW = W - AXIS_LEFT - AXIS_RIGHT;
    var drawH = H - AXIS_BOTTOM;
    if (drawW <= 0 || drawH <= 0) return null;

    if (state.candles.length === 0) return null;

    var candleInterval = 3600000; // default 1h
    if (state.candles.length > 1) {
      candleInterval = state.candles[1].time - state.candles[0].time;
    }

    var timeStart = state.candles[0].time;
    var timeEnd   = state.candles[state.candles.length - 1].time + candleInterval;

    // Price range from candles within the visible time window
    var dataPriceLow = Infinity, dataPriceHigh = -Infinity;
    for (var i = 0; i < state.candles.length; i++) {
      var c = state.candles[i];
      if (c.time + candleInterval >= timeStart && c.time <= timeEnd) {
        if (c.low  < dataPriceLow)  dataPriceLow  = c.low;
        if (c.high > dataPriceHigh) dataPriceHigh = c.high;
      }
    }

    // Fallback: currentPrice ±2%
    if (dataPriceLow >= dataPriceHigh && state.currentPrice > 0) {
      dataPriceLow  = state.currentPrice * 0.98;
      dataPriceHigh = state.currentPrice * 1.02;
    }
    if (dataPriceLow >= dataPriceHigh) return null;

    // Minimal padding so wicks aren't clipped
    var pricePad = (dataPriceHigh - dataPriceLow) * 0.005;
    var priceLow  = dataPriceLow  - pricePad;
    var priceHigh = dataPriceHigh + pricePad;

    return {
      drawX: drawX, drawW: drawW, drawH: drawH,
      timeStart: timeStart, timeEnd: timeEnd,
      priceLow: priceLow, priceHigh: priceHigh
    };
  }

  /* ═══════════════════════════════════════════
     WebSocket
  ═══════════════════════════════════════════ */
  var ws = null, pingTimer = null, reconnTimer = null, snapshotTimer = null;

  function wsUrl() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host;
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
    try { ws = new WebSocket(wsUrl()); } catch (e) { scheduleReconnect(); return; }
    ws.addEventListener('open', onOpen);
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', onError);
  }

  function onOpen() {
    setStatus('connected');
    sendSubscribe();
    pingTimer = setInterval(function () {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
    }, 5000);
    clearInterval(snapshotTimer);
    snapshotTimer = setInterval(function () { sendSubscribe(); }, SNAPSHOT_REFRESH_MS);
  }

  function onMessage(event) {
    var msg;
    try { msg = JSON.parse(event.data); } catch (e) { return; }
    switch (msg.type) {
      case 'snapshot':      handleSnapshot(msg);     break;
      case 'liquidation':   handleLiquidation(msg);  break;
      case 'candle_update': handleCandleUpdate(msg); break;
      case 'status':        handleStatus(msg);       break;
      case 'marker':        handleMarker(msg);       break;
    }
  }

  function onClose() {
    clearInterval(pingTimer); clearInterval(snapshotTimer);
    pingTimer = null; snapshotTimer = null;
    setStatus('disconnected');
    scheduleReconnect();
  }
  function onError() { setStatus('error'); scheduleReconnect(); }

  var wsFailCount = 0;

  function scheduleReconnect() {
    wsFailCount++;
    // After 2 failed attempts, fall back to direct Binance API
    if (wsFailCount >= 2 && state.candles.length === 0) {
      fetchBinanceDirect();
      return;
    }
    if (reconnTimer) return;
    reconnTimer = setTimeout(function () { reconnTimer = null; connect(); }, 3000);
  }

  /* ── Binance REST API fallback (for static hosting) ── */
  function fetchBinanceDirect() {
    var tf = controls.timeframe;
    var interval = tf === '12h' ? '5m' : '15m';
    var limit = tf === '12h' ? 144 : 96;
    var url = 'https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=' + interval + '&limit=' + limit;

    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!Array.isArray(data)) return;
        state.candles = data.map(function (k) {
          return {
            time: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5])
          };
        });
        state.currentPrice = state.candles[state.candles.length - 1].close;
        window._analysisCandles = state.candles;
        window._analysisPrice = state.currentPrice;
        updatePrice();
        setStatus('connected');
        scheduleRender();

        // Refresh every 30s
        setTimeout(fetchBinanceDirect, 30000);
      })
      .catch(function () {
        setTimeout(fetchBinanceDirect, 10000);
      });
  }

  function sendSubscribe() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'subscribe', timeframe: controls.timeframe }));
  }

  /* ── Message Handlers ──────────────────── */
  function handleSnapshot(msg) {
    var timeframeChanged = false;
    if (msg.timeframe && msg.timeframe !== state.activeTimeframe) {
      state.activeTimeframe = msg.timeframe;
      timeframeChanged = true;
    }

    if (msg.heatmap && msg.heatmap.buckets) {
      // Sort buckets by time (Map insertion order is NOT chronological)
      var buckets = msg.heatmap.buckets;
      buckets.sort(function (a, b) { return a.time - b.time; });
      state.heatmapBuckets = buckets;
    }
    if (msg.candles)         state.candles         = msg.candles;
    if (msg.currentPrice)    state.currentPrice    = Number(msg.currentPrice) || 0;
    if (msg.collectingSince) state.collectingSince = msg.collectingSince;
    if (msg.binanceConnected) setStatus('connected');

    // Expose candle data for analysis panel
    window._analysisCandles = state.candles;
    window._analysisPrice = state.currentPrice;

    updatePrice(); updateDataNotice(); scheduleRender();
  }

  function handleLiquidation(msg) {
    if (msg.price) state.currentPrice = Number(msg.price) || state.currentPrice;
    addLiquidationToFeed({
      price: Number(msg.price),
      side: msg.side,
      quantity: Number(msg.quantity),
      time: msg.timestamp || Date.now()
    });
    updatePrice();
  }

  function handleCandleUpdate(msg) {
    if (!msg.candle) return;
    var candle = msg.candle;
    state.currentPrice = Number(candle.close) || state.currentPrice;

    // The stream sends 1m kline updates, but state.candles may hold 1h/4h/etc.
    // Update the last candle's close and extend high/low if needed.
    var candles = state.candles;
    if (candles.length > 0) {
      var last = candles[candles.length - 1];
      last.close = Number(candle.close);
      var h = Number(candle.high), l = Number(candle.low);
      if (h > last.high) last.high = h;
      if (l < last.low)  last.low  = l;
    }

    // Keep analysis panel in sync
    window._analysisCandles = state.candles;
    window._analysisPrice = state.currentPrice;

    updatePrice(); scheduleRender();
  }

  function handleStatus(msg) {
    if (msg.binanceConnected !== undefined) setStatus(msg.binanceConnected ? 'connected' : 'disconnected');
    if (msg.collectingSince) { state.collectingSince = msg.collectingSince; updateDataNotice(); }
  }

  function handleMarker(msg) {
    if (!msg.markerType || !msg.price) return;
    // Find x position: use last candle's x position (current price)
    var coord = lastCoord;
    var cx = coord ? coord.drawX + coord.drawW - 30 : 200;

    manualMarkers.push({
      type: msg.markerType === 'buy' ? 'buy' : 'sell',
      price: Number(msg.price),
      x: cx
    });
    scheduleRender();
  }

  /* ═══════════════════════════════════════════
     Rendering
  ═══════════════════════════════════════════ */
  var rafPending = false;

  function scheduleRender() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () { rafPending = false; render(); });
  }

  function render() {
    var size  = resizeCanvas();
    var coord = computeCoord(size.W, size.H);

    // Clear entire canvas
    ctx.clearRect(0, 0, size.W, size.H);

    if (!coord) return;

    // Store for crosshair use
    lastCoord = coord;

    var hasCandles = state.candles.length > 0;

    // 1. Grid
    drawGrid(coord);

    // 2. Volume bars (behind everything, at chart bottom)
    if (hasCandles && indicators.volume) {
      volumeBars.render(ctx, state.candles, coord);
    }

    // 3. Bollinger Bands (behind candles, above volume)
    if (hasCandles && indicators.bollinger) {
      bollinger.render(ctx, state.candles, coord);
    }

    // 4. VPVR (behind candles)
    if (hasCandles && indicators.vpvr) {
      vpvr.render(ctx, state.candles, coord);
    }

    // 5. Candles
    if (hasCandles) {
      candlestick.render(ctx, state.candles, coord);
    }

    // 6. EMA overlay (on top of candles)
    if (hasCandles && indicators.ema) {
      emaRenderer.render(ctx, state.candles, coord);
    }

    // 7. Manual markers
    if (manualMarkers.length > 0) {
      signals.renderManual(ctx, manualMarkers, coord);
    }

    // 8. Axes
    updateYAxis(coord.priceLow, coord.priceHigh);
    updateXAxis(coord.timeStart, coord.timeEnd);

    // 9. Price tag on right axis
    updatePriceTag(coord);

    // 10. RSI panel
    renderRsiPanel(coord);

    // 11. MACD panel
    renderMacdPanel(coord);
  }

  /* ── Grid ─────────────────────────────── */
  function drawGrid(coord) {
    ctx.save();
    ctx.strokeStyle = 'rgba(42,46,57,0.7)';
    ctx.lineWidth = 1;

    var hTicks = 6;
    for (var i = 1; i < hTicks; i++) {
      var y = Math.round(coord.drawH * i / hTicks) + 0.5;
      ctx.beginPath();
      ctx.moveTo(coord.drawX, y);
      ctx.lineTo(coord.drawX + coord.drawW, y);
      ctx.stroke();
    }

    var vTicks = 6;
    for (var j = 1; j < vTicks; j++) {
      var x = Math.round(coord.drawX + coord.drawW * j / vTicks) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, coord.drawH);
      ctx.stroke();
    }

    // Current price line
    if (state.currentPrice > coord.priceLow && state.currentPrice < coord.priceHigh) {
      var priceY = Math.round(coord.drawH * (1 - (state.currentPrice - coord.priceLow) / (coord.priceHigh - coord.priceLow))) + 0.5;
      ctx.strokeStyle = 'rgba(41,98,255,0.5)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(coord.drawX, priceY);
      ctx.lineTo(coord.drawX + coord.drawW, priceY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  /* ── Indicator Panel Rendering ─────────── */
  function resizeIndicatorCanvas(canvasEl, panelEl) {
    if (!canvasEl || !panelEl) return null;
    var dpr = window.devicePixelRatio || 1;
    var rect = panelEl.getBoundingClientRect();
    var w = Math.floor(rect.width);
    var h = Math.floor(rect.height);
    if (w <= 0 || h <= 0) return null;
    canvasEl.width  = w * dpr;
    canvasEl.height = h * dpr;
    canvasEl.style.width  = w + 'px';
    canvasEl.style.height = h + 'px';
    var panelCtx = canvasEl.getContext('2d');
    panelCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { W: w, H: h, ctx: panelCtx };
  }

  function renderRsiPanel(coord) {
    if (!indicators.rsi || !rsiPanelEl || !rsiCanvasEl) return;
    rsiPanelEl.style.display = '';
    var info = resizeIndicatorCanvas(rsiCanvasEl, rsiPanelEl);
    if (!info) return;
    info.ctx.clearRect(0, 0, info.W, info.H);
    if (state.candles.length > 0 && coord) {
      rsiPanel.render(info.ctx, state.candles, coord, info.H);
    }
  }

  function renderMacdPanel(coord) {
    if (!indicators.macd || !macdPanelEl || !macdCanvasEl) return;
    macdPanelEl.style.display = '';
    var info = resizeIndicatorCanvas(macdCanvasEl, macdPanelEl);
    if (!info) return;
    info.ctx.clearRect(0, 0, info.W, info.H);
    if (state.candles.length > 0 && coord) {
      macdPanel.render(info.ctx, state.candles, coord, info.H);
    }
  }

  /* ── Indicator Toggle ──────────────────── */
  function toggleIndicator(name) {
    if (!(name in indicators)) return;
    indicators[name] = !indicators[name];

    // Show/hide sub-panels
    if (name === 'rsi' && rsiPanelEl) {
      rsiPanelEl.style.display = indicators.rsi ? '' : 'none';
    }
    if (name === 'macd' && macdPanelEl) {
      macdPanelEl.style.display = indicators.macd ? '' : 'none';
    }

    // Update toggle button states
    updateToggleButtons();
    scheduleRender();
  }

  function updateToggleButtons() {
    var toggleBtns = document.querySelectorAll('.menu-toggle[data-indicator]');
    for (var i = 0; i < toggleBtns.length; i++) {
      var btn = toggleBtns[i];
      var key = btn.getAttribute('data-indicator');
      var stateEl = btn.querySelector('.toggle-state');
      if (stateEl && key in indicators) {
        if (indicators[key]) {
          stateEl.textContent = '[ON]';
          stateEl.className = 'toggle-state on';
        } else {
          stateEl.textContent = '[OFF]';
          stateEl.className = 'toggle-state off';
        }
      }
    }
  }

  // Wire up toggle buttons
  var toggleBtns = document.querySelectorAll('.menu-toggle[data-indicator]');
  for (var ti = 0; ti < toggleBtns.length; ti++) {
    (function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var key = btn.getAttribute('data-indicator');
        toggleIndicator(key);
      });
    })(toggleBtns[ti]);
  }

  // Expose toggle for external use
  window.toggleIndicator = toggleIndicator;

  /* ── Axes ─────────────────────────────── */
  function updateYAxis(priceLow, priceHigh) {
    if (!yAxisEl || !priceLow || !priceHigh || priceLow >= priceHigh) {
      if (yAxisEl) yAxisEl.innerHTML = '';
      return;
    }
    var ticks = 8;
    var html = '';
    for (var i = 0; i <= ticks; i++) {
      var frac  = i / ticks;
      var price = priceHigh - frac * (priceHigh - priceLow);
      var isCP  = state.currentPrice > 0 &&
        Math.abs(price - state.currentPrice) < (priceHigh - priceLow) / (ticks * 2);
      html += '<div class="y-tick' + (isCP ? ' current-price-label' : '') + '">' +
        formatPrice(price) + '</div>';
    }
    yAxisEl.innerHTML = html;
  }

  function updateXAxis(timeStart, timeEnd) {
    if (!xAxisEl || !timeStart || !timeEnd || timeStart >= timeEnd) {
      if (xAxisEl) xAxisEl.innerHTML = '';
      return;
    }
    var ticks = 6;
    var range = timeEnd - timeStart;
    var showDate = range > 24 * 3600000;
    var html = '';
    for (var i = 0; i <= ticks; i++) {
      var t  = timeStart + range * i / ticks;
      var dt = new Date(t);
      var hh = String(dt.getHours()).padStart(2, '0');
      var mm = String(dt.getMinutes()).padStart(2, '0');
      var label;
      if (showDate) {
        label = (dt.getMonth() + 1) + '/' + dt.getDate() + ' ' + hh + ':' + mm;
      } else {
        label = hh + ':' + mm;
      }
      html += '<span class="x-tick">' + label + '</span>';
    }
    xAxisEl.innerHTML = html;
  }

  /* ── Price Display ───────────────────── */
  var lastDisplayedPrice = 0;

  function updatePrice() {
    if (!priceEl || !state.currentPrice) return;
    var p = state.currentPrice;
    if (p > lastDisplayedPrice) priceEl.className = 'price up';
    else if (p < lastDisplayedPrice && lastDisplayedPrice > 0) priceEl.className = 'price down';
    lastDisplayedPrice = p;
    priceEl.textContent = formatPrice(p);
  }

  function formatPrice(p) {
    if (!p) return '--';
    if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }

  /* ── Status Dot ──────────────────────── */
  function setStatus(status) {
    if (!statusDot) return;
    statusDot.classList.remove('connected', 'error');
    if (status === 'connected') statusDot.classList.add('connected');
    if (status === 'error')     statusDot.classList.add('error');
  }

  /* ── Data Notice ─────────────────────── */
  function updateDataNotice() {
    if (!noticeTxtEl) return;
    if (state.collectingSince) {
      var since = new Date(state.collectingSince);
      noticeTxtEl.textContent = '데이터 수집 시작: ' + since.toLocaleString('ko-KR', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
      });
    } else {
      noticeTxtEl.textContent = '서버에 연결하는 중...';
    }
  }

  /* ── Feed ─────────────────────────────── */
  function addLiquidationToFeed(liq) {
    state.recentLiquidations.unshift(liq);
    if (state.recentLiquidations.length > 8) state.recentLiquidations.length = 8;
    renderFeed();
  }

  function renderFeed() {
    if (!feedListEl) return;
    var liqs = state.recentLiquidations;
    if (liqs.length === 0) {
      feedListEl.innerHTML = '<div class="feed-empty">청산 데이터 수신 대기 중...</div>';
      return;
    }
    var now = Date.now(), html = '';
    liqs.forEach(function (liq) {
      var side = (liq.side || '').toLowerCase();
      var sideLabel = side === 'long' ? 'LONG' : (side === 'short' ? 'SHORT' : side.toUpperCase());
      html += '<div class="feed-item">' +
        '<div class="feed-item-price">$' + (liq.price ? formatPrice(Number(liq.price)) : '--') + '</div>' +
        '<div class="feed-item-row"><span class="feed-item-side ' + side + '">' + sideLabel + '</span>' +
        '<span class="feed-item-qty">' + (liq.quantity ? Number(liq.quantity).toLocaleString('en-US', { maximumFractionDigits: 4 }) + ' BTC' : '--') + '</span></div>' +
        '<div class="feed-item-time">' + formatTimeAgo(now - liq.time) + '</div></div>';
    });
    feedListEl.innerHTML = html;
  }

  function formatTimeAgo(ms) {
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + '초 전';
    var m = Math.floor(s / 60);
    if (m < 60) return m + '분 전';
    return Math.floor(m / 60) + '시간 전';
  }

  /* ═══════════════════════════════════════════
     Crosshair + Price Tag
  ═══════════════════════════════════════════ */
  var lastCoord = null;

  function drawCrosshair(mx, my) {
    var rect = chartCont.getBoundingClientRect();
    var W = Math.floor(rect.width);
    var H = Math.floor(rect.height);
    overlayCtx.clearRect(0, 0, W, H);

    var coord = lastCoord;
    if (!coord) return;

    // Convert mouse position to chart coordinates
    var x = mx - rect.left;
    var y = my - rect.top;

    // Only draw when inside draw area
    if (x < coord.drawX || x > coord.drawX + coord.drawW || y < 0 || y > coord.drawH) {
      hideCrosshair();
      return;
    }

    // Dashed crosshair lines
    overlayCtx.save();
    overlayCtx.strokeStyle = 'rgba(120,123,134,0.6)';
    overlayCtx.lineWidth = 0.5;
    overlayCtx.setLineDash([4, 3]);

    // Vertical line
    overlayCtx.beginPath();
    overlayCtx.moveTo(Math.round(x) + 0.5, 0);
    overlayCtx.lineTo(Math.round(x) + 0.5, coord.drawH);
    overlayCtx.stroke();

    // Horizontal line
    overlayCtx.beginPath();
    overlayCtx.moveTo(coord.drawX, Math.round(y) + 0.5);
    overlayCtx.lineTo(coord.drawX + coord.drawW, Math.round(y) + 0.5);
    overlayCtx.stroke();

    overlayCtx.restore();

    // Compute time and price from mouse position
    var timeFrac = (x - coord.drawX) / coord.drawW;
    var time = coord.timeStart + timeFrac * (coord.timeEnd - coord.timeStart);
    var priceFrac = 1 - y / coord.drawH;
    var price = coord.priceLow + priceFrac * (coord.priceHigh - coord.priceLow);

    // X label (time)
    if (crosshairXEl) {
      var dt = new Date(time);
      var hh = String(dt.getHours()).padStart(2, '0');
      var mm = String(dt.getMinutes()).padStart(2, '0');
      var tRange = coord.timeEnd - coord.timeStart;
      var label;
      if (tRange > 24 * 3600000) {
        label = (dt.getMonth() + 1) + '/' + dt.getDate() + ' ' + hh + ':' + mm;
      } else {
        label = hh + ':' + mm;
      }
      crosshairXEl.textContent = label;
      crosshairXEl.style.display = 'block';
      crosshairXEl.style.left = x + 'px';
    }

    // Y label (price)
    if (crosshairYEl) {
      crosshairYEl.textContent = formatPrice(price);
      crosshairYEl.style.display = 'block';
      crosshairYEl.style.top = y + 'px';
    }
  }

  function hideCrosshair() {
    var rect = chartCont.getBoundingClientRect();
    overlayCtx.clearRect(0, 0, Math.floor(rect.width), Math.floor(rect.height));
    if (crosshairXEl) crosshairXEl.style.display = 'none';
    if (crosshairYEl) crosshairYEl.style.display = 'none';
  }

  function updatePriceTag(coord) {
    if (!priceTagEl || !coord) { if (priceTagEl) priceTagEl.style.display = 'none'; return; }
    var cp = state.currentPrice;
    if (!cp || cp <= coord.priceLow || cp >= coord.priceHigh) {
      priceTagEl.style.display = 'none';
      return;
    }
    var y = coord.drawH * (1 - (cp - coord.priceLow) / (coord.priceHigh - coord.priceLow));
    priceTagEl.textContent = formatPrice(cp);
    priceTagEl.style.display = 'block';
    priceTagEl.style.top = y + 'px';
  }

  // Mousemove — crosshair
  chartCont.addEventListener('mousemove', function (e) {
    drawCrosshair(e.clientX, e.clientY);
  });

  chartCont.addEventListener('mouseleave', function () {
    hideCrosshair();
  });

  /* ═══════════════════════════════════════════
     Menu Dropdown
  ═══════════════════════════════════════════ */
  var menuBtn = document.getElementById('menuBtn');
  var menuDropdown = document.getElementById('menuDropdown');

  if (menuBtn && menuDropdown) {
    menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      menuDropdown.classList.toggle('open');
    });
    document.addEventListener('click', function (e) {
      if (!menuDropdown.contains(e.target) && e.target !== menuBtn) {
        menuDropdown.classList.remove('open');
      }
    });
  }

  /* ═══════════════════════════════════════════
     Manual Markers
  ═══════════════════════════════════════════ */
  var manualMarkers = [];
  var markerMode = null; // null | 'buy' | 'sell'

  var addBuyBtn = document.getElementById('addBuyBtn');
  var addSellBtn = document.getElementById('addSellBtn');
  var clearMarkersBtn = document.getElementById('clearMarkersBtn');

  function setMarkerMode(mode) {
    markerMode = markerMode === mode ? null : mode;
    if (addBuyBtn) addBuyBtn.classList.toggle('active', markerMode === 'buy');
    if (addSellBtn) addSellBtn.classList.toggle('active', markerMode === 'sell');
    chartCont.classList.toggle('placing', markerMode !== null);
    // Close menu after selection
    if (menuDropdown) menuDropdown.classList.remove('open');
  }

  if (addBuyBtn) addBuyBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    setMarkerMode('buy');
  });
  if (addSellBtn) addSellBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    setMarkerMode('sell');
  });
  if (clearMarkersBtn) clearMarkersBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    manualMarkers = [];
    if (menuDropdown) menuDropdown.classList.remove('open');
    scheduleRender();
  });

  chartCont.addEventListener('click', function (e) {
    if (!markerMode || !lastCoord) return;

    var rect = chartCont.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;
    var coord = lastCoord;

    if (x < coord.drawX || x > coord.drawX + coord.drawW || y < 0 || y > coord.drawH) return;

    var price = coord.priceHigh - (y / coord.drawH) * (coord.priceHigh - coord.priceLow);

    manualMarkers.push({
      type: markerMode,
      price: price,
      x: x
    });

    scheduleRender();
  });

  /* ── Controls → WebSocket + Re-render ── */
  controls.onChange(function () {
    sendSubscribe();
  });

  /* ── Window resize ──────────────────── */
  window.addEventListener('resize', function () { scheduleRender(); });

  /* ── Periodic feed timestamp refresh ── */
  setInterval(function () {
    if (state.recentLiquidations.length > 0) renderFeed();
  }, 5000);

  /* ── Bootstrap ─────────────────────── */
  updateDataNotice();
  connect();

  // Re-render when dashboard becomes visible (after gate entry)
  var dashEl = document.getElementById('mainDashboard');
  if (dashEl) {
    var observer = new MutationObserver(function () {
      if (dashEl.style.display !== 'none') {
        setTimeout(function () { scheduleRender(); }, 100);
        setTimeout(function () { scheduleRender(); }, 500);
      }
    });
    observer.observe(dashEl, { attributes: true, attributeFilter: ['style'] });
  }

}());
