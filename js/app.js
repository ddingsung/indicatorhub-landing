/* ═══════════════════════════════════════════
   app.js — Liquidation Heatmap Dashboard
   Orchestrates WebSocket, rendering, controls, and feed.

   Server protocol (version: 1):
     snapshot:      { heatmap: { buckets }, candles, currentPrice, binanceConnected, collectingSince }
     liquidation:   { side, price, quantity, timestamp }
     candle_update: { candle: { open, high, low, close, volume, time } }
     status:        { binanceConnected, collectingSince }
   ═══════════════════════════════════════════ */

(function () {
  'use strict';

  var SNAPSHOT_REFRESH_MS = 30000; // re-fetch snapshot every 30s for heatmap updates

  var state = {
    heatmapBuckets:      [],     // array of { time, priceLevels }
    candles:             [],     // OHLC array
    currentPrice:        0,
    collectingSince:     null,
    recentLiquidations:  [],
    lastRenderResult:    null
  };

  /* ── DOM refs ──────────────────────────── */
  var canvas      = document.getElementById('mainCanvas');
  var yAxisEl     = document.getElementById('yAxis');
  var xAxisEl     = document.getElementById('xAxis');
  var feedListEl  = document.getElementById('feedList');
  var noticeTxtEl = document.getElementById('noticeText');
  var statusDot   = document.getElementById('statusDot');
  var priceEl     = document.getElementById('currentPrice');

  /* ── Renderers & Controls ──────────────── */
  var heatmap     = new window.HeatmapRenderer(canvas);
  var candlestick = new window.CandlestickRenderer(canvas);
  var controls    = new window.Controls();

  controls.init();

  /* ── WebSocket ─────────────────────────── */
  var ws            = null;
  var pingTimer     = null;
  var reconnTimer   = null;
  var snapshotTimer = null;

  function wsUrl() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host;
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

    try {
      ws = new WebSocket(wsUrl());
    } catch (e) {
      scheduleReconnect();
      return;
    }

    ws.addEventListener('open', onOpen);
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', onError);
  }

  function onOpen() {
    setStatus('connected');
    sendSubscribe();
    pingTimer = setInterval(function () {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 5000);

    // Periodic snapshot refresh for heatmap updates
    clearInterval(snapshotTimer);
    snapshotTimer = setInterval(function () {
      sendSubscribe();
    }, SNAPSHOT_REFRESH_MS);
  }

  function onMessage(event) {
    var msg;
    try { msg = JSON.parse(event.data); } catch (e) { return; }

    switch (msg.type) {
      case 'snapshot':      handleSnapshot(msg);     break;
      case 'liquidation':   handleLiquidation(msg);  break;
      case 'candle_update': handleCandleUpdate(msg); break;
      case 'status':        handleStatus(msg);       break;
      case 'pong':                                   break;
    }
  }

  function onClose() {
    clearInterval(pingTimer);
    clearInterval(snapshotTimer);
    pingTimer = null;
    snapshotTimer = null;
    setStatus('disconnected');
    scheduleReconnect();
  }

  function onError() {
    setStatus('error');
  }

  function scheduleReconnect() {
    if (reconnTimer) return;
    reconnTimer = setTimeout(function () {
      reconnTimer = null;
      connect();
    }, 3000);
  }

  function sendSubscribe() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type:      'subscribe',
      timeframe: controls.timeframe
    }));
  }

  /* ── Message Handlers ──────────────────── */

  function handleSnapshot(msg) {
    // Server sends: { heatmap: { symbol, timeframe, buckets: [...] }, candles, currentPrice, binanceConnected, collectingSince }
    if (msg.heatmap && msg.heatmap.buckets) {
      state.heatmapBuckets = msg.heatmap.buckets;
    }
    if (msg.candles) {
      state.candles = msg.candles;
    }
    if (msg.currentPrice) {
      state.currentPrice = Number(msg.currentPrice) || 0;
    }
    if (msg.collectingSince) {
      state.collectingSince = msg.collectingSince;
    }
    if (msg.binanceConnected) {
      setStatus('connected');
    }

    updatePrice();
    updateDataNotice();
    scheduleRender();
  }

  function handleLiquidation(msg) {
    // Server sends: { side, price, quantity, timestamp }
    if (msg.price) state.currentPrice = Number(msg.price) || state.currentPrice;

    addLiquidationToFeed({
      price:    Number(msg.price),
      side:     msg.side,
      quantity: Number(msg.quantity),
      time:     msg.timestamp || Date.now()
    });

    updatePrice();
  }

  function handleCandleUpdate(msg) {
    if (!msg.candle) return;
    var candle = msg.candle;
    state.currentPrice = Number(candle.close) || state.currentPrice;

    var candles = state.candles;
    if (candles.length > 0 && candles[candles.length - 1].time === candle.time) {
      candles[candles.length - 1] = candle;
    } else {
      candles.push(candle);
    }

    updatePrice();
    scheduleRender();
  }

  function handleStatus(msg) {
    // Server sends: { binanceConnected, collectingSince }
    if (msg.binanceConnected !== undefined) {
      setStatus(msg.binanceConnected ? 'connected' : 'disconnected');
    }
    if (msg.collectingSince) {
      state.collectingSince = msg.collectingSince;
      updateDataNotice();
    }
  }

  /* ── Rendering ─────────────────────────── */
  var rafPending = false;

  function scheduleRender() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false;
      render();
    });
  }

  function render() {
    heatmap.resize();

    var dpr = window.devicePixelRatio || 1;
    var W   = canvas.width  / dpr;
    var H   = canvas.height / dpr;

    var result = heatmap.render(state.heatmapBuckets, {
      viewMode:     controls.viewMode,
      currentPrice: state.currentPrice,
      priceRange:   0.02
    });

    state.lastRenderResult = result;

    if (controls.chartMode === 'overlay' && state.candles.length > 0 && result.priceLow && result.priceHigh) {
      var ctx = canvas.getContext('2d');
      ctx.save();
      ctx.globalAlpha = 0.6;
      candlestick.render(state.candles, {
        priceLow:  result.priceLow,
        priceHigh: result.priceHigh,
        W: W,
        H: H
      });
      ctx.restore();
    }

    updateAxes(result);
  }

  /* ── Axes ───────────────────────────────── */
  function updateAxes(result) {
    if (!result) return;
    updateYAxis(result.priceLow, result.priceHigh);
    updateXAxis(result.times);
  }

  function updateYAxis(priceLow, priceHigh) {
    if (!yAxisEl) return;
    if (!priceLow || !priceHigh || priceLow >= priceHigh) {
      yAxisEl.innerHTML = '';
      return;
    }

    var ticks = 8;
    var html  = '';
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

  function updateXAxis(times) {
    if (!xAxisEl) return;
    if (!times || times.length === 0) {
      xAxisEl.innerHTML = '';
      return;
    }

    var step = Math.max(1, Math.floor(times.length / 6));
    var html = '';
    for (var i = 0; i < times.length; i += step) {
      var t   = times[i];
      var dt  = new Date(t < 1e12 ? t * 1000 : t);
      var str = dt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
      html += '<span class="x-tick">' + str + '</span>';
    }
    xAxisEl.innerHTML = html;
  }

  /* ── Price Display ─────────────────────── */
  var lastDisplayedPrice = 0;

  function updatePrice() {
    if (!priceEl || !state.currentPrice) return;
    var p    = state.currentPrice;
    var text = formatPrice(p);

    if (p > lastDisplayedPrice) {
      priceEl.className = 'price up';
    } else if (p < lastDisplayedPrice && lastDisplayedPrice > 0) {
      priceEl.className = 'price down';
    }
    lastDisplayedPrice = p;
    priceEl.textContent = text;
  }

  function formatPrice(p) {
    if (!p) return '--';
    if (p >= 1000) {
      return p.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    }
    return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }

  /* ── Status Dot ────────────────────────── */
  function setStatus(status) {
    if (!statusDot) return;
    statusDot.classList.remove('connected', 'error');
    if (status === 'connected') statusDot.classList.add('connected');
    if (status === 'error')     statusDot.classList.add('error');
  }

  /* ── Data Notice ───────────────────────── */
  function updateDataNotice() {
    if (!noticeTxtEl) return;
    var parts = [];

    if (state.collectingSince) {
      var since = new Date(state.collectingSince);
      var sinceStr = since.toLocaleString('ko-KR', {
        month: 'numeric', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
      });
      parts.push('수집 시작: ' + sinceStr);
    }

    parts.push('데이터는 거래소 제공 기준이며, 고변동 구간에서 일부 누락될 수 있습니다');
    noticeTxtEl.textContent = parts.join('  ·  ');
  }

  /* ── Feed ───────────────────────────────── */
  function addLiquidationToFeed(liq) {
    state.recentLiquidations.unshift(liq);
    if (state.recentLiquidations.length > 8) {
      state.recentLiquidations.length = 8;
    }
    renderFeed();
  }

  function renderFeed() {
    if (!feedListEl) return;
    var liqs = state.recentLiquidations;

    if (liqs.length === 0) {
      feedListEl.innerHTML = '<div class="feed-empty">청산 데이터 수신 대기 중...</div>';
      return;
    }

    var now  = Date.now();
    var html = '';

    liqs.forEach(function (liq) {
      var side      = (liq.side || '').toLowerCase();
      var sideLabel = side === 'long' ? 'LONG' : (side === 'short' ? 'SHORT' : side.toUpperCase());
      var ago       = formatTimeAgo(now - liq.time);
      var qty       = liq.quantity ? Number(liq.quantity).toLocaleString('en-US', { maximumFractionDigits: 4 }) : '--';
      var price     = liq.price ? formatPrice(Number(liq.price)) : '--';

      html += '<div class="feed-item">' +
        '<div class="feed-item-price">$' + price + '</div>' +
        '<div class="feed-item-row">' +
          '<span class="feed-item-side ' + side + '">' + sideLabel + '</span>' +
          '<span class="feed-item-qty">' + qty + ' BTC</span>' +
        '</div>' +
        '<div class="feed-item-time">' + ago + '</div>' +
      '</div>';
    });

    feedListEl.innerHTML = html;
  }

  function formatTimeAgo(ms) {
    var s = Math.floor(ms / 1000);
    if (s < 60)  return s + '초 전';
    var m = Math.floor(s / 60);
    if (m < 60)  return m + '분 전';
    var h = Math.floor(m / 60);
    return h + '시간 전';
  }

  /* ── Controls → WebSocket + Re-render ──── */
  controls.onChange(function () {
    sendSubscribe();
    scheduleRender();
  });

  /* ── Window resize ─────────────────────── */
  window.addEventListener('resize', function () {
    scheduleRender();
  });

  /* ── Periodic feed timestamp refresh ───── */
  setInterval(function () {
    if (state.recentLiquidations.length > 0) {
      renderFeed();
    }
  }, 5000);

  /* ── Bootstrap ─────────────────────────── */
  updateDataNotice();
  connect();

}());
