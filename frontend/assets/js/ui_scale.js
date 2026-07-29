// assets/js/ui_scale.js
// Reads the --ui-scale CSS custom property and exposes utilities for
// scaling pixel values and reacting to scale changes.

(function () {
  let lastScale = null;

  /** Returns the current UI scale factor from the root CSS custom property. */
  function getUiScale() {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue("--ui-scale")
      .trim();
    const n = parseFloat(value || "1");
    return Number.isFinite(n) ? n : 1;
  }

  /**
   * Scales a pixel value by the current UI scale factor.
   * Always returns at least 1 to avoid sub-pixel rendering.
   *
   * @param {number} n - Raw pixel value
   * @returns {number}
   */
  function px(n) {
    return Math.max(1, Math.round(n * getUiScale()));
  }

  function debounce(fn, ms) {
    let timerId;
    return (...args) => {
      clearTimeout(timerId);
      timerId = setTimeout(() => fn(...args), ms);
    };
  }

  /**
   * Registers a callback that fires whenever the UI scale changes.
   * The callback receives the new scale value as its only argument.
   *
   * @param {function(number): void} cb
   */
  function onScaleChange(cb) {
    const check = () => {
      const s = getUiScale();
      if (s !== lastScale) {
        lastScale = s;
        try { cb(s); } catch {}
      }
    };
    window.addEventListener("resize", debounce(check, 120));
    document.addEventListener("DOMContentLoaded", check);
    check();
  }

  window.UI_SCALE = { getUiScale, px, onScaleChange };
})();
