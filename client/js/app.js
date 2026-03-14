/* ═══════════════════════════════════════════
   app.js — Liquidation Heatmap Dashboard
   Orchestrates WebSocket, rendering, controls, and feed.
   ═══════════════════════════════════════════ */

(function () {
  'use strict';

  /* ─────────────────────────────────────────
     State
  ───────────────────────────────────────── */
  var state = {
    heatmapBuckets:      null,   // { [ts]: { [price]: { total, long, short } } }
    candles:             [],     // OHLC array
    currentPrice:        0,
    collectingSince:     null,   // ISO string from server
    recentLiquidations:  [],     // max 8
    lastRenderResult:    null    // cached heatmap render output
  };

  /* ─────────────────────────────────────────
     DOM refs
  ───────────────────────────────────────── */
  var canvas      = document.getElementById('mainCanvas');
  var yAxisEl     = document.getElementById('yAxis');
  var xAxisEl     = document.getElementById('xAxis');
  var feedListEl  = document.getElementById('feedList');
  var noticeTxtEl = document.getElementById('noticeText');
  var statusDot   = document.getElementById('statusDot');
  var priceEl     = document.getElementById('currentPrice');

  /* ─────────────────────────────────────────
     Renderers & Controls
  ───────────────────────────────────────── */
  var heatmap     = new window.HeatmapRenderer(canvas);
  var candlestick = new window.CandlestickRenderer(canvas);
  var controls    = new window.Controls();

  controls.init();

  /* ─────────────────────────────────────────
     WebSocket
  ───────────────────────────────────────── */
  var ws          = null;
  var pingTimer   = null;
  var reconnTimer = null;

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
  }

  function onMessage(event) {
    var msg;
    try { msg = JSON.parse(event.data); } catch (e) { return; }

    switch (msg.type) {
      case 'snapshot':      handleSnapshot(msg);          break;
      case 'liquidation':   handleLiquidation(msg);       break;
      case 'candle_update': handleCandleUpdate(msg);      break;
      case 'status':        handleStatus(msg);            break;
      case 'pong':                                        break;
      default:                                            break;
    }
  }

  function onClose() {
    clearInterval(pingTimer);
    pingTimer = null;
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

  /* ─────────────────────────────────────────
     Message Handlers
  ───────────────────────────────────────── */
  function handleSnapshot(msg) {
    if (msg.buckets !== undefined)     state.heatmapBuckets  = msg.buckets;
    if (msg.candles !== undefined)     state.candles         = msg.candles  || [];
    if (msg.price   !== undefined)     state.currentPrice    = Number(msg.price)  || 0;
    if (msg.collectingSince)           state.collectingSince = msg.collectingSince;

    updatePrice();
    updateDataNotice();
    scheduleRender();
  }

  function handleLiquidation(msg) {
    if (msg.price) state.currentPrice = Number(msg.price) || state.currentPrice;

    // Update bucket
    if (msg.priceLevel && msg.time && msg.side && msg.quantity) {
      var t = msg.time;
      var p = msg.priceLevel;
      if (!state.heatmapBuckets) state.heatmapBuckets = {};
      if (!state.heatmapBuckets[t]) state.heatmapBuckets[t] = {};
      var cell = state.heatmapBuckets[t][p] || { total: 0, long: 0, short: 0 };
      var qty  = Number(msg.quantity) || 0;
      cell.total += qty;
      if (msg.side === 'long')  cell.long  += qty;
      if (msg.side === 'short') cell.short += qty;
      state.heatmapBuckets[t][p] = cell;
    }

    addLiquidationToFeed(msg);
    updatePrice();
    scheduleRender();
  }

  function handleCandleUpdate(msg) {
    if (!msg.candle) return;
    var candle = msg.candle;
    if (candle.price) state.currentPrice = Number(candle.close || candle.price) || state.currentPrice;

    var candles = state.candles;
    if (candles.length > 0 && candles[candles.length - 1].time === candle.time) {
      // Update last candle (same period)
      candles[candles.length - 1] = candle;
    } else {
      candles.push(candle);
    }

    updatePrice();
    scheduleRender();
  }

  function handleStatus(msg) {
    if (msg.connected !== undefined) {
      setStatus(msg.connected ? 'connected' : 'disconnected');
    }
    if (msg.collectingSince) {
      state.collectingSince = msg.collectingSince;
      updateDataNotice();
    }
  }

  /* ─────────────────────────────────────────
     Rendering
  ───────────────────────────────────────── */
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

    var dpr    = window.devicePixelRatio || 1;
    var W      = canvas.width  / dpr;
    var H      = canvas.height / dpr;

    var result = heatmap.render(state.heatmapBuckets, {
      viewMode:     controls.viewMode,
      currentPrice: state.currentPrice,
      priceRange:   0.02
    });

    state.lastRenderResult = result;

    // Overlay candlesticks if mode is 'overlay'
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

  /* ─────────────────────────────────────────
     Axes
  ───────────────────────────────────────── */
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

    // Show ~6 evenly spaced time ticks
    var step = Math.max(1, Math.floor(times.length / 6));
    var html = '';
    for (var i = 0; i < times.length; i += step) {
      var t   = times[i];
      var dt  = new Date(t < 1e12 ? t * 1000 : t); // handle s or ms
      var str = dt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
      html += '<span class="x-tick">' + str + '</span>';
    }
    xAxisEl.innerHTML = html;
  }

  /* ─────────────────────────────────────────
     Price Display
  ───────────────────────────────────────── */
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

  /* ─────────────────────────────────────────
     Status Dot
  ───────────────────────────────────────── */
  function setStatus(status) {
    if (!statusDot) return;
    statusDot.classList.remove('connected', 'error');
    if (status === 'connected')    statusDot.classList.add('connected');
    if (status === 'error')        statusDot.classList.add('error');
  }

  /* ─────────────────────────────────────────
     Data Notice
  ───────────────────────────────────────── */
  function updateDataNotice() {
    if (!noticeTxtEl) return;
    var parts = [];

    if (state.collectingSince) {
      var since  = new Date(state.collectingSince);
      var sinceStr = since.toLocaleString('ko-KR', {
        month: 'numeric', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
      });
      parts.push('수집 시작: ' + sinceStr);
    }

    parts.push('데이터는 참고용이며 투자 결정의 근거로 사용하지 마십시오.');
    noticeTxtEl.textContent = parts.join('  ·  ');
  }

  /* ─────────────────────────────────────────
     Feed
  ───────────────────────────────────────── */
  function addLiquidationToFeed(liq) {
    state.recentLiquidations.unshift({
      price:    liq.price,
      side:     liq.side,
      quantity: liq.quantity || liq.qty,
      time:     liq.time ? (liq.time < 1e12 ? liq.time * 1000 : liq.time) : Date.now()
    });
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
      var side    = (liq.side || '').toLowerCase();
      var sideLabel = side === 'long' ? 'LONG' : (side === 'short' ? 'SHORT' : side.toUpperCase());
      var ago     = formatTimeAgo(now - liq.time);
      var qty     = liq.quantity ? Number(liq.quantity).toLocaleString('en-US', { maximumFractionDigits: 4 }) : '--';
      var price   = liq.price ? formatPrice(Number(liq.price)) : '--';

      html += '<div class="feed-item">' +
        '<div class="feed-item-price">$' + price + '</div>' +
        '<div class="feed-item-row">' +
          '<span class="feed-item-side ' + side + '">' + sideLabel + '</span>' +
          '<span class="feed-item-qty">' + qty + '</span>' +
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

  /* ─────────────────────────────────────────
     Controls → WebSocket + Re-render
  ───────────────────────────────────────── */
  controls.onChange(function () {
    sendSubscribe();
    scheduleRender();
  });

  /* ─────────────────────────────────────────
     Window resize
  ───────────────────────────────────────── */
  window.addEventListener('resize', function () {
    scheduleRender();
  });

  /* ─────────────────────────────────────────
     Periodic feed timestamp refresh (5s)
  ───────────────────────────────────────── */
  setInterval(function () {
    if (state.recentLiquidations.length > 0) {
      renderFeed();
    }
  }, 5000);

  /* ─────────────────────────────────────────
     Bootstrap
  ───────────────────────────────────────── */
  updateDataNotice();
  connect();

}());
