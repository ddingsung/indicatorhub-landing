/* ═══════════════════════════════════════════
   Controls
   Manages timeframe, chart mode, and view mode button groups.
   ═══════════════════════════════════════════ */

(function () {
  'use strict';

  function Controls() {
    this.timeframe  = '15m';
    this.chartMode  = 'heatmap';
    this.viewMode   = 'all';
    this._callbacks = [];
  }

  /**
   * Bind click handlers to all button groups and initialise state.
   */
  Controls.prototype.init = function () {
    var self = this;

    /* ── timeframe buttons ──────────────────────────────────────── */
    var tfGroup = document.getElementById('timeframeBtns');
    if (tfGroup) {
      tfGroup.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-tf]');
        if (!btn) return;
        self.timeframe = btn.getAttribute('data-tf');
        self._activateBtn(tfGroup, btn);
        self._notify();
      });
    }

    /* ── chart mode buttons ──────────────────────────────────────── */
    var modeGroup = document.getElementById('chartModeBtns');
    if (modeGroup) {
      modeGroup.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-mode]');
        if (!btn) return;
        self.chartMode = btn.getAttribute('data-mode');
        self._activateBtn(modeGroup, btn);
        self._notify();
      });
    }

    /* ── view mode buttons ───────────────────────────────────────── */
    var viewGroup = document.getElementById('viewModeBtns');
    if (viewGroup) {
      viewGroup.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-view]');
        if (!btn) return;
        self.viewMode = btn.getAttribute('data-view');
        self._activateBtn(viewGroup, btn);
        self._updateLegend();
        self._notify();
      });
    }

    // Initialise legend gradient
    this._updateLegend();
  };

  /**
   * Register a callback to be called whenever any control changes.
   * @param {Function} fn - Called with { timeframe, chartMode, viewMode }
   */
  Controls.prototype.onChange = function (fn) {
    if (typeof fn === 'function') {
      this._callbacks.push(fn);
    }
  };

  /* ── private helpers ─────────────────────────────────────────────── */

  Controls.prototype._activateBtn = function (group, activeBtn) {
    var btns = group.querySelectorAll('.btn-ctrl');
    btns.forEach(function (b) { b.classList.remove('active'); });
    activeBtn.classList.add('active');
  };

  Controls.prototype._updateLegend = function () {
    var gradient = document.getElementById('legendGradient');
    if (!gradient) return;
    gradient.classList.remove('long', 'short');
    if (this.viewMode === 'long')  gradient.classList.add('long');
    if (this.viewMode === 'short') gradient.classList.add('short');
  };

  Controls.prototype._notify = function () {
    var state = {
      timeframe:  this.timeframe,
      chartMode:  this.chartMode,
      viewMode:   this.viewMode
    };
    this._callbacks.forEach(function (fn) {
      try { fn(state); } catch (e) { /* ignore */ }
    });
  };

  /* ── expose globally ─────────────────────────────────────────────── */
  window.Controls = Controls;

}());
