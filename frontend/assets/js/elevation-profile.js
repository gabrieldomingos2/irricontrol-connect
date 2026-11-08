/*
 * Perfil de elevação estilo Google Earth — VERSÃO DE TESTE
 * ---------------------------------------------------------------------------
 * Tudo roda no navegador:
 *   1. TerrainProvider  -> baixa tiles de terreno (SRTM ~30 m, formato Terrarium,
 *                          mesmo bucket "elevation-tiles-prod" que o backend já usa)
 *                          e guarda em cache. Depois disso a elevação de qualquer
 *                          ponto sai na hora (interpolação bilinear).
 *   2. sampleProfile    -> amostra a linha (vários segmentos) a cada ~10–15 m.
 *   3. ProfileChart     -> gráfico em <canvas> igual ao do Google Earth
 *                          (hover, seleção de trecho, estatísticas).
 *   4. ElevationPathTool-> régua "Caminho" no Leaflet: clica pra criar pontos,
 *                          arrasta vértices, insere pelo meio, botão direito remove.
 *
 * Sem dependências além do Leaflet (já usado no app). Não toca no AppState.
 * Exposto em window.ElevationProfile pra depois plugar no app principal.
 */
(function (global) {
  "use strict";

  // Tradução: usa o t() global do i18n.js (chaves em locales/*.json -> "elevation_profile").
  const tr = (key, params = {}) => (typeof global.t === "function" ? global.t(`elevation_profile.${key}`, params) : key);

  // Passo das linhas de grade do eixo Y (metros). Mude aqui se quiser outro intervalo.
  const Y_GRID_STEP_M = 3;

  const R_EARTH = 6371008.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // =========================================================================
  // 1) TERRENO
  // =========================================================================
  class TerrainProvider {
    constructor(opts = {}) {
      this.zoom = opts.zoom ?? 14; // z14 ≈ 9 m/pixel no Brasil (fonte SRTM 30 m)
      this.url =
        opts.url ??
        ((z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`);
      this.decode = opts.decode ?? ((r, g, b) => r * 256 + g + b / 256 - 32768);
      this.maxTiles = opts.maxTiles ?? 600;
      this.tiles = new Map(); // "x/y" -> Float32Array(256*256)
      this.pending = new Map(); // "x/y" -> Promise
      this.failed = new Map(); // "x/y" -> horário da falha (tile está "zerado" provisoriamente)
      this.retryMs = opts.retryMs ?? 15000;
      this.onError = opts.onError || null;
    }

    /** Tile utilizável: carregado e, se for um "zero" de falha, ainda dentro do intervalo de nova tentativa. */
    _fresh(key) {
      if (!this.tiles.has(key)) return false;
      const t = this.failed.get(key);
      return t === undefined || Date.now() - t < this.retryMs;
    }

    _pixel(lat, lon) {
      const n = 256 * 2 ** this.zoom;
      const s = Math.sin(toRad(clamp(lat, -85, 85)));
      return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
    }

    /** Chaves de tile necessárias pra interpolar todos esses pontos. */
    keysFor(lats, lons) {
      const keys = new Set();
      for (let i = 0; i < lats.length; i++) {
        const [x, y] = this._pixel(lats[i], lons[i]);
        const x0 = Math.floor((x - 0.5) / 256), x1 = Math.floor((x + 0.5) / 256);
        const y0 = Math.floor((y - 0.5) / 256), y1 = Math.floor((y + 0.5) / 256);
        keys.add(x0 + "/" + y0); keys.add(x1 + "/" + y0);
        keys.add(x0 + "/" + y1); keys.add(x1 + "/" + y1);
      }
      return keys;
    }

    missing(keys) {
      const out = [];
      keys.forEach((k) => !this._fresh(k) && out.push(k));
      return out;
    }

    load(key) {
      if (this._fresh(key)) return Promise.resolve();
      if (this.pending.has(key)) return this.pending.get(key);
      const [x, y] = key.split("/").map(Number);
      const p = fetch(this.url(this.zoom, x, y))
        .then((r) => {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.blob();
        })
        .then((b) => createImageBitmap(b))
        .then((bmp) => {
          const c = document.createElement("canvas");
          c.width = c.height = 256;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(bmp, 0, 0);
          const px = ctx.getImageData(0, 0, 256, 256).data;
          const arr = new Float32Array(256 * 256);
          for (let i = 0, j = 0; i < arr.length; i++, j += 4) arr[i] = this.decode(px[j], px[j + 1], px[j + 2]);
          this.failed.delete(key);
          this._store(key, arr);
        })
        .catch((err) => {
          // Tile com erro vira "zero" provisório pra não travar a ferramenta;
          // depois de retryMs ele volta a ser baixado. Avisa quem usa.
          if (!this.tiles.has(key)) this._store(key, new Float32Array(256 * 256));
          this.failed.set(key, Date.now());
          this.onError && this.onError(key, err);
        })
        .finally(() => this.pending.delete(key));
      this.pending.set(key, p);
      return p;
    }

    _store(key, arr) {
      this.tiles.set(key, arr);
      if (this.tiles.size > this.maxTiles) {
        const old = this.tiles.keys().next().value;
        this.tiles.delete(old);
        this.failed.delete(old);
      }
    }

    ensure(keys) {
      return Promise.all([...keys].map((k) => this.load(k)));
    }

    /** Baixa antes os tiles de uma área (ex.: em volta do caminho) pra arrastar sem "engasgar". */
    prefetchBounds(south, west, north, east, cap = 120) {
      const [x0, y0] = this._pixel(north, west), [x1, y1] = this._pixel(south, east);
      const tx0 = Math.floor(x0 / 256), tx1 = Math.floor(x1 / 256);
      const ty0 = Math.floor(y0 / 256), ty1 = Math.floor(y1 / 256);
      if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > cap) return Promise.resolve();
      const keys = [];
      for (let x = tx0; x <= tx1; x++) for (let y = ty0; y <= ty1; y++) keys.push(x + "/" + y);
      return this.ensure(this.missing(new Set(keys)));
    }

    _val(gx, gy) {
      const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
      const t = this.tiles.get(tx + "/" + ty);
      if (!t) return NaN;
      return t[(gy - ty * 256) * 256 + (gx - tx * 256)];
    }

    /** Elevação (m) com interpolação bilinear. NaN se o tile ainda não chegou. */
    elevation(lat, lon) {
      let [x, y] = this._pixel(lat, lon);
      x -= 0.5; y -= 0.5;
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const fx = x - x0, fy = y - y0;
      const a = this._val(x0, y0), b = this._val(x0 + 1, y0);
      const c = this._val(x0, y0 + 1), d = this._val(x0 + 1, y0 + 1);
      return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
    }
  }

  // =========================================================================
  // 2) AMOSTRAGEM + ESTATÍSTICAS
  // =========================================================================
  function haversine(a, b) {
    const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R_EARTH * Math.asin(Math.sqrt(s));
  }

  /** Posições (lat/lon/distância) ao longo do caminho. Elevação vem depois. */
  function samplePositions(latlngs, opts = {}) {
    const step = opts.step ?? 10;
    const maxSamples = opts.maxSamples ?? 1500;
    const segLen = [];
    let total = 0;
    for (let i = 1; i < latlngs.length; i++) {
      const d = haversine(latlngs[i - 1], latlngs[i]);
      segLen.push(d);
      total += d;
    }
    const n = clamp(Math.round(total / step) + 1, 2, maxSamples);
    const lat = new Float64Array(n), lon = new Float64Array(n), dist = new Float64Array(n);
    let seg = 0, segStart = 0;
    for (let i = 0; i < n; i++) {
      const d = (total * i) / (n - 1);
      while (seg < segLen.length - 1 && d > segStart + segLen[seg]) { segStart += segLen[seg]; seg++; }
      const f = segLen[seg] > 0 ? clamp((d - segStart) / segLen[seg], 0, 1) : 0;
      const A = latlngs[seg], B = latlngs[seg + 1];
      lat[i] = A.lat + (B.lat - A.lat) * f;
      lon[i] = A.lng + (B.lng - A.lng) * f;
      dist[i] = d;
    }
    // distância acumulada de cada vértice (pra marcar no gráfico)
    const vertexDist = [0];
    segLen.forEach((l) => vertexDist.push(vertexDist[vertexDist.length - 1] + l));
    return { lat, lon, dist, total, vertexDist, n };
  }

  function fillElevation(pos, terrain) {
    const elev = new Float64Array(pos.n);
    for (let i = 0; i < pos.n; i++) {
      const e = terrain.elevation(pos.lat[i], pos.lon[i]);
      if (Number.isNaN(e)) return null;
      elev[i] = e;
    }
    return { ...pos, elev };
  }

  /** Mesmas métricas do Google Earth, para o trecho [i0, i1]. */
  function computeStats(p, i0 = 0, i1 = p.n - 1) {
    let min = Infinity, max = -Infinity, sum = 0, gain = 0, loss = 0;
    for (let i = i0; i <= i1; i++) {
      const e = p.elev[i];
      if (e < min) min = e;
      if (e > max) max = e;
      sum += e;
      if (i > i0) { const de = e - p.elev[i - 1]; de > 0 ? (gain += de) : (loss -= de); }
    }
    // Inclinação medida em janelas de ~30 m (resolução real do SRTM) pra não pegar ruído.
    const step = p.n > 1 ? p.dist[1] - p.dist[0] : 1;
    const k = Math.max(1, Math.round(30 / step));
    let maxUp = 0, maxDown = 0, upRise = 0, upRun = 0, dnRise = 0, dnRun = 0;
    for (let i = i0; i + k <= i1; i += k) {
      const rise = p.elev[i + k] - p.elev[i], run = p.dist[i + k] - p.dist[i];
      if (run <= 0) continue;
      const s = rise / run;
      if (s > maxUp) maxUp = s;
      if (s < maxDown) maxDown = s;
      if (rise >= 0) { upRise += rise; upRun += run; } else { dnRise += rise; dnRun += run; }
    }
    return {
      min, max, avg: sum / (i1 - i0 + 1),
      distance: p.dist[i1] - p.dist[i0],
      gain, loss,
      maxUp: maxUp * 100, maxDown: maxDown * 100,
      avgUp: upRun ? (upRise / upRun) * 100 : 0,
      avgDown: dnRun ? (dnRise / dnRun) * 100 : 0,
    };
  }

  /** Inclinação local (%) em torno da amostra i (janela ~30 m). */
  function localSlope(p, i) {
    const step = p.n > 1 ? p.dist[1] - p.dist[0] : 1;
    const k = Math.max(1, Math.round(15 / step));
    const a = Math.max(0, i - k), b = Math.min(p.n - 1, i + k);
    const run = p.dist[b] - p.dist[a];
    return run > 0 ? ((p.elev[b] - p.elev[a]) / run) * 100 : 0;
  }

  /**
   * Visada de rádio (extra p/ estudo de sinal): curvatura da Terra (k=4/3),
   * 1ª zona de Fresnel e vegetação somada ao terreno.
   */
  function computeLink(p, o) {
    const D = p.total, kR = (o.kFactor ?? 4 / 3) * R_EARTH;
    const fGHz = (o.freqMHz ?? 915) / 1000;
    const hA = p.elev[0] + o.txHeight, hB = p.elev[p.n - 1] + o.rxHeight;
    const los = new Float64Array(p.n), fres = new Float64Array(p.n);
    let worstIdx = -1, worstClear = Infinity, blocked = false, fresnelHit = false, worstRatio = Infinity;
    for (let i = 0; i < p.n; i++) {
      const d1 = p.dist[i], d2 = D - d1;
      // linha reta menos a "barriga" da Terra -> fica curva pra baixo no gráfico
      los[i] = hA + ((hB - hA) * d1) / D - (d1 * d2) / (2 * kR);
      fres[i] = D > 0 ? 17.32 * Math.sqrt(((d1 / 1000) * (d2 / 1000)) / (fGHz * (D / 1000))) : 0;
      if (i === 0 || i === p.n - 1) continue;
      const top = p.elev[i] + (o.clutter ?? 0);
      const clear = los[i] - top; // folga acima do obstáculo
      if (clear < 0) blocked = true;
      const ratio = fres[i] > 0 ? clear / fres[i] : Infinity;
      if (ratio < 0.6) fresnelHit = true;
      if (ratio < worstRatio) { worstRatio = ratio; worstClear = clear; worstIdx = i; }
    }
    return { los, fres, blocked, fresnelHit, worstIdx, worstClear, worstRatio };
  }

  // =========================================================================
  // 3) GRÁFICO (canvas)
  // =========================================================================
  function niceStep(range, target) {
    const raw = range / Math.max(1, target);
    const mag = 10 ** Math.floor(Math.log10(raw));
    const n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  }
  const fmtKm = (m) => (m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 1 : 2) + " km" : Math.round(m) + " m");

  class ProfileChart {
    constructor(canvas, cb = {}) {
      this.cv = canvas;
      this.ctx = canvas.getContext("2d");
      this.cb = cb;
      this.p = null;
      this.link = null;
      this.clutter = 0;
      this.cursor = null;
      this.sel = null; // [i0, i1]
      this._drag = null;
      this.m = { l: 46, r: 14, t: 10, b: 24 };
      this._bind();
      new ResizeObserver(() => this.render()).observe(canvas);
    }

    setData(p, link = null, clutter = 0) {
      const sameLen = this.p && p && this.p.n === p.n;
      this.p = p; this.link = link; this.clutter = clutter;
      if (!sameLen) this.sel = null;
      if (this.cursor != null && p && this.cursor >= p.n) this.cursor = null;
      this.render();
    }
    setCursor(i) { if (this.cursor !== i) { this.cursor = i; this.render(); } }

    _plot() {
      const w = this.cv.clientWidth, h = this.cv.clientHeight, m = this.m;
      return { x: m.l, y: m.t, w: w - m.l - m.r, h: h - m.t - m.b, W: w, H: h };
    }
    _yRange() {
      const p = this.p;
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < p.n; i++) {
        lo = Math.min(lo, p.elev[i]);
        hi = Math.max(hi, p.elev[i] + this.clutter);
        if (this.link) { hi = Math.max(hi, this.link.los[i]); lo = Math.min(lo, this.link.los[i] - this.link.fres[i]); }
      }
      // relevo muito plano: garante pelo menos ~12 m de faixa (senão o gráfico vira serrote)
      const mid = (lo + hi) / 2;
      if (hi - lo < 12) { lo = mid - 6; hi = mid + 6; }
      const pad = Math.max(1, (hi - lo) * 0.08);
      return [lo - pad, hi + pad];
    }
    _idxAtX(px) {
      const pl = this._plot();
      const f = clamp((px - pl.x) / pl.w, 0, 1);
      return clamp(Math.round(f * (this.p.n - 1)), 0, this.p.n - 1);
    }

    _bind() {
      const cv = this.cv;
      // Converte o mouse (px de tela) pra px do CSS do canvas. Sem isso, com a
      // escala da UI do app (ui_scale.js, ~0.8) a linha ficava atrás do mouse.
      const xOf = (e) => {
        const r = cv.getBoundingClientRect();
        const k = r.width ? cv.clientWidth / r.width : 1;
        return (e.clientX - r.left) * k;
      };
      cv.addEventListener("pointermove", (e) => {
        if (!this.p) return;
        const i = this._idxAtX(xOf(e));
        if (this._drag != null) {
          this.sel = [Math.min(this._drag, i), Math.max(this._drag, i)];
          this.cb.onSelect && this.cb.onSelect(this.sel[1] - this.sel[0] > 1 ? this.sel : null);
        }
        this.cursor = i;
        this.render();
        this.cb.onHover && this.cb.onHover(i);
      });
      cv.addEventListener("pointerleave", () => {
        if (this._drag != null) return;
        this.cursor = null; this.render();
        this.cb.onHover && this.cb.onHover(null);
      });
      cv.addEventListener("pointerdown", (e) => {
        if (!this.p || e.button !== 0) return;
        cv.setPointerCapture(e.pointerId);
        this._drag = this._idxAtX(xOf(e));
        this.sel = null;
        this.cb.onSelect && this.cb.onSelect(null);
      });
      cv.addEventListener("pointerup", () => {
        if (this._drag == null) return;
        this._drag = null;
        if (this.sel && this.sel[1] - this.sel[0] < 2) { this.sel = null; this.cb.onSelect && this.cb.onSelect(null); }
        this.render();
      });
      cv.addEventListener("dblclick", () => { this.sel = null; this.cb.onSelect && this.cb.onSelect(null); this.render(); });
    }

    render() {
      const dpr = global.devicePixelRatio || 1;
      const pl = this._plot();
      if (this.cv.width !== Math.round(pl.W * dpr) || this.cv.height !== Math.round(pl.H * dpr)) {
        this.cv.width = Math.round(pl.W * dpr); this.cv.height = Math.round(pl.H * dpr);
      }
      const c = this.ctx;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = "#f3f3f3"; c.fillRect(0, 0, pl.W, pl.H);
      c.fillStyle = "#fff"; c.fillRect(pl.x, pl.y, pl.w, pl.h);
      const p = this.p;
      if (!p) {
        c.fillStyle = "#777"; c.font = "13px system-ui, sans-serif"; c.textAlign = "center";
        c.fillText(tr("empty_chart"), pl.W / 2, pl.H / 2);
        return;
      }
      const [y0, y1] = this._yRange();
      const X = (d) => pl.x + (d / p.total) * pl.w;
      const Y = (e) => pl.y + pl.h - ((e - y0) / (y1 - y0)) * pl.h;
      const xi = (i) => X(p.dist[i]);

      // grade
      c.font = "11px system-ui, sans-serif";
      c.strokeStyle = "#d6d6d6"; c.lineWidth = 1; c.fillStyle = "#8b1a1a";
      // Grade em múltiplos de Y_GRID_STEP_M (3 m). Se o relevo for muito alto e as linhas
      // ficarem coladas (menos de ~18 px entre elas), pula para 6, 9, 12 m... sempre múltiplo de 3.
      const minGapPx = 18;
      const pxPerMeter = pl.h / Math.max(1e-6, y1 - y0);
      const ys = Y_GRID_STEP_M * Math.max(1, Math.ceil(minGapPx / (Y_GRID_STEP_M * pxPerMeter)));
      c.textAlign = "right"; c.textBaseline = "middle";
      for (let v = Math.ceil(y0 / ys) * ys; v <= y1; v += ys) {
        const yy = Math.round(Y(v)) + 0.5;
        c.beginPath(); c.moveTo(pl.x, yy); c.lineTo(pl.x + pl.w, yy); c.stroke();
        c.fillText(Math.round(v) + " m", pl.x - 4, yy);
      }
      const xs = niceStep(p.total, Math.max(3, pl.w / 95));
      c.textAlign = "center"; c.textBaseline = "top"; c.fillStyle = "#333";
      for (let v = xs; v < p.total; v += xs) {
        const xx = Math.round(X(v)) + 0.5;
        if (xx > pl.x + pl.w - 60) break; // não encosta no rótulo do total
        c.beginPath(); c.moveTo(xx, pl.y); c.lineTo(xx, pl.y + pl.h); c.stroke();
        c.fillText(fmtKm(v), xx, pl.y + pl.h + 5);
      }
      c.textAlign = "right"; c.fillText(fmtKm(p.total), pl.x + pl.w, pl.y + pl.h + 5);

      // vértices intermediários (linhas tracejadas, igual ao GE)
      c.save(); c.setLineDash([3, 3]); c.strokeStyle = "#b0b0b0";
      for (let k = 1; k < p.vertexDist.length - 1; k++) {
        const xx = Math.round(X(p.vertexDist[k])) + 0.5;
        c.beginPath(); c.moveTo(xx, pl.y); c.lineTo(xx, pl.y + pl.h); c.stroke();
      }
      c.restore();

      // seleção
      if (this.sel) {
        c.fillStyle = "rgba(60,120,220,0.13)";
        c.fillRect(xi(this.sel[0]), pl.y, xi(this.sel[1]) - xi(this.sel[0]), pl.h);
      }

      c.save();
      c.beginPath(); c.rect(pl.x, pl.y, pl.w, pl.h); c.clip();

      // vegetação (camada verde em cima do terreno)
      if (this.clutter > 0) {
        c.beginPath();
        for (let i = 0; i < p.n; i++) c.lineTo(xi(i), Y(p.elev[i] + this.clutter));
        for (let i = p.n - 1; i >= 0; i--) c.lineTo(xi(i), Y(p.elev[i]));
        c.closePath(); c.fillStyle = "rgba(46,140,60,0.35)"; c.fill();
      }

      // terreno: área rosa + linha vinho (visual do Google Earth)
      const g = c.createLinearGradient(0, pl.y, 0, pl.y + pl.h);
      g.addColorStop(0, "#f4b6b6"); g.addColorStop(1, "#fde4e4");
      c.beginPath(); c.moveTo(xi(0), pl.y + pl.h);
      for (let i = 0; i < p.n; i++) c.lineTo(xi(i), Y(p.elev[i]));
      c.lineTo(xi(p.n - 1), pl.y + pl.h); c.closePath();
      c.fillStyle = g; c.fill();
      c.beginPath();
      for (let i = 0; i < p.n; i++) c.lineTo(xi(i), Y(p.elev[i]));
      c.strokeStyle = "#8b1a1a"; c.lineWidth = 1.4; c.stroke();

      // visada + Fresnel
      if (this.link) {
        const L = this.link;
        c.beginPath();
        for (let i = 0; i < p.n; i++) c.lineTo(xi(i), Y(L.los[i] - 0.6 * L.fres[i]));
        c.setLineDash([5, 4]); c.strokeStyle = "rgba(37,99,235,0.8)"; c.lineWidth = 1; c.stroke();
        c.setLineDash([]);
        c.beginPath();
        for (let i = 0; i < p.n; i++) c.lineTo(xi(i), Y(L.los[i]));
        c.strokeStyle = L.blocked ? "#dc2626" : L.fresnelHit ? "#d97706" : "#16a34a"; c.lineWidth = 2; c.stroke();
        if (L.worstIdx > 0) {
          c.fillStyle = c.strokeStyle;
          c.beginPath(); c.arc(xi(L.worstIdx), Y(p.elev[L.worstIdx] + this.clutter), 4, 0, Math.PI * 2); c.fill();
        }
      }
      c.restore();

      // borda
      c.strokeStyle = "#999"; c.lineWidth = 1; c.strokeRect(pl.x + 0.5, pl.y + 0.5, pl.w - 1, pl.h - 1);

      // cursor (linha vertical + etiquetas vermelhas igual ao GE)
      if (this.cursor != null) {
        const i = this.cursor, xx = Math.round(xi(i)) + 0.5;
        c.strokeStyle = "#555"; c.beginPath(); c.moveTo(xx, pl.y); c.lineTo(xx, pl.y + pl.h); c.stroke();
        c.fillStyle = "#8b1a1a";
        c.beginPath(); c.arc(xx, Y(p.elev[i]), 3, 0, Math.PI * 2); c.fill();
        const tag = (txt, x, y) => {
          c.font = "bold 11px system-ui, sans-serif";
          const w = c.measureText(txt).width + 8;
          const bx = clamp(x - w / 2, 0, pl.W - w);
          c.fillStyle = "#8b0000"; c.fillRect(bx, y, w, 15);
          c.fillStyle = "#fff"; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText(txt, bx + 4, y + 8);
        };
        tag(Math.round(p.elev[i]) + " m", xx, Math.max(pl.y, Y(p.elev[i]) - 22));
        tag(localSlope(p, i).toFixed(1) + "%", xx, pl.y + pl.h - 16);
        tag(fmtKm(p.dist[i]), xx, pl.y + pl.h + 3);
      }
    }
  }

  // =========================================================================
  // 4) RÉGUA "CAMINHO" NO MAPA
  // =========================================================================
  class ElevationPathTool {
    /**
     * @param {L.Map} map
     * @param {object} ui  { canvas, statsEl, onLength(m), onState(state) }
     */
    constructor(map, ui, opts = {}) {
      this.map = map;
      this.ui = ui;
      this.terrain = opts.terrain || new TerrainProvider(opts.terrainOptions);
      this.vertices = [];
      this.drawing = false;
      this.preview = null;
      this.profile = null;
      this.selection = null;
      this.link = null;
      this.linkOpts = { enabled: false, txHeight: 15, rxHeight: 3, freqMHz: 915, clutter: 0 };
      this._gen = 0;
      this._raf = 0;

      this.layer = L.layerGroup().addTo(map);
      // Panes próprios, ACIMA de tudo no mapa (pivôs, ícones = 600, nomes/tooltips = 650)
      // e abaixo só dos popups (700): a régua fica sempre por cima.
      const pane = (name, z) => {
        if (!map.getPane(name)) map.createPane(name).style.zIndex = String(z);
        return name;
      };
      this.paneLine = pane("epLinePane", 660);
      this.paneHandles = pane("epHandlePane", 670);
      this.paneHover = pane("epHoverPane", 680);
      map.getPane(this.paneHover).style.pointerEvents = "none";
      // Renderer SVG só da régua: o mapa do app usa preferCanvas, e no canvas
      // compartilhado cada movimento da linha redesenhava TODOS os pivôs (travava).
      const renderer = L.svg({ padding: 0.5, pane: this.paneLine });
      this.line = L.polyline([], { renderer, color: "#ffff00", weight: 3, opacity: 1, interactive: false }).addTo(this.layer);
      this.selLine = L.polyline([], { renderer, color: "#00e5ff", weight: 5, opacity: 0.9, interactive: false }).addTo(this.layer);
      this.hit = L.polyline([], { renderer, color: "#000", weight: 18, opacity: 0, interactive: true }).addTo(this.layer);
      this.ghostLine = L.polyline([], { renderer, color: "#ffff00", weight: 2, dashArray: "6 6", interactive: false }).addTo(this.layer);
      this.markers = [];
      this.ghosts = [];
      this.hoverMarker = null;

      this.chart = new ProfileChart(ui.canvas, {
        onHover: (i) => this._showHover(i),
        onSelect: (sel) => { this.selection = sel; this._drawSelection(); this._renderStats(); },
      });

      this.hit.on("mousemove", (e) => this._onLineHover(e));
      this.hit.on("mouseout", () => { this.chart.setCursor(null); this._showHover(null); });

      this._onClick = (e) => this._handleClick(e);
      this._onMove = (e) => { if (this.drawing && this.vertices.length) { this.preview = e.latlng; this._refreshGeometry(false); this.schedule(); } };
      this._onKey = (e) => {
        if (!this.drawing) return;
        // Não rouba teclas de campos de texto (busca de coordenadas, renomear, etc.).
        const el = e.target;
        if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
        if (e.key === "Escape" || e.key === "Enter") this.finish();
        if (e.key === "Backspace" && this.vertices.length) { e.preventDefault(); this.vertices.pop(); this._rebuild(); }
      };
      map.on("click", this._onClick);
      map.on("mousemove", this._onMove);
      document.addEventListener("keydown", this._onKey);
    }

    // ---------- ciclo de desenho ----------
    start() {
      this.clear();
      this.drawing = true;
      this.map.doubleClickZoom.disable();
      this.map.getContainer().style.cursor = "crosshair";
      this._emitState();
    }
    finish() {
      this.drawing = false;
      this.preview = null;
      this.map.doubleClickZoom.enable();
      this.map.getContainer().style.cursor = "";
      this._rebuild();
      this._emitState();
    }
    clear() {
      this.vertices = [];
      this.preview = null;
      this.profile = null;
      this.selection = null;
      this._rebuild();
      this.chart.setData(null);
      this._renderStats();
    }
    setPath(latlngs) {
      this.vertices = latlngs.map((p) => L.latLng(p));
      this.drawing = false;
      this._rebuild();
      this._emitState();
    }
    setLinkOptions(o) { Object.assign(this.linkOpts, o); this.schedule(); }

    _handleClick(e) {
      if (!this.drawing) return;
      const last = this.vertices[this.vertices.length - 1];
      // clicar perto do último ponto (ou duplo clique) = terminar
      if (last && this.map.latLngToContainerPoint(last).distanceTo(e.containerPoint) < 8) {
        if (this.vertices.length >= 2) this.finish();
        return;
      }
      this.vertices.push(e.latlng);
      this._rebuild();
    }

    // ---------- geometria / marcadores ----------
    _pathForProfile() {
      const v = this.vertices.slice();
      if (this.drawing && this.preview && v.length) v.push(this.preview);
      return v;
    }

    _refreshGeometry(rebuildMarkers) {
      this.line.setLatLngs(this.vertices);
      this.hit.setLatLngs(this.vertices);
      const last = this.vertices[this.vertices.length - 1];
      this.ghostLine.setLatLngs(this.drawing && this.preview && last ? [last, this.preview] : []);
      if (!rebuildMarkers) {
        this.ghosts.forEach((g, k) => {
          const a = this.vertices[k], b = this.vertices[k + 1];
          a && b && g.setLatLng([(a.lat + b.lat) / 2, (a.lng + b.lng) / 2]);
        });
      }
      this.ui.onLength && this.ui.onLength(this._length(this._pathForProfile()));
    }

    _length(v) { let s = 0; for (let i = 1; i < v.length; i++) s += haversine(v[i - 1], v[i]); return s; }

    _vertexIcon(k, n) {
      const cls = k === 0 ? "ep-v ep-v-start" : k === n - 1 ? "ep-v ep-v-end" : "ep-v";
      return L.divIcon({ className: "", html: `<div class="${cls}"></div>`, iconSize: [12, 12], iconAnchor: [6, 6] });
    }

    _rebuild() {
      this.markers.forEach((m) => this.layer.removeLayer(m));
      this.ghosts.forEach((m) => this.layer.removeLayer(m));
      this.markers = []; this.ghosts = [];
      const n = this.vertices.length;

      this.vertices.forEach((ll, k) => {
        const m = L.marker(ll, { pane: this.paneHandles, draggable: true, icon: this._vertexIcon(k, n), zIndexOffset: 1000, keyboard: false });
        m.on("dragstart", () => this._dragStarted());
        m.on("drag", (e) => { this.vertices[k] = e.target.getLatLng(); this._refreshGeometry(false); this.schedule(); });
        m.on("dragend", () => this._rebuild());
        m.on("contextmenu", (e) => {
          L.DomEvent.preventDefault(e.originalEvent);
          if (this.vertices.length > 2 || this.drawing) { this.vertices.splice(k, 1); this._rebuild(); }
        });
        m.on("click", (e) => { if (this.drawing && k === n - 1 && n >= 2) { L.DomEvent.stop(e); this.finish(); } });
        m.addTo(this.layer);
        this.markers.push(m);
      });

      // "fantasmas" no meio dos segmentos: arrastar cria um vértice novo (igual GE/Google Maps)
      if (!this.drawing) {
        for (let k = 0; k < n - 1; k++) {
          const a = this.vertices[k], b = this.vertices[k + 1];
          const g = L.marker([(a.lat + b.lat) / 2, (a.lng + b.lng) / 2], {
            pane: this.paneHandles, draggable: true, keyboard: false,
            icon: L.divIcon({ className: "", html: '<div class="ep-ghost"></div>', iconSize: [10, 10], iconAnchor: [5, 5] }),
          });
          let inserted = false;
          g.on("dragstart", () => { this._dragStarted(); this.vertices.splice(k + 1, 0, g.getLatLng()); inserted = true; });
          g.on("drag", () => { if (inserted) { this.vertices[k + 1] = g.getLatLng(); this.line.setLatLngs(this.vertices); this.hit.setLatLngs(this.vertices); this.ui.onLength && this.ui.onLength(this._length(this.vertices)); this.schedule(); } });
          g.on("dragend", () => this._rebuild());
          g.addTo(this.layer);
          this.ghosts.push(g);
        }
      }
      this._refreshGeometry(true);
      this._prefetchAround();
      this.schedule();
    }

    _dragStarted() {
      this.chart.setCursor(null);
      this._showHover(null);
    }

    /** Pré-carrega o terreno numa folga de ~50% em volta do caminho. */
    _prefetchAround() {
      if (this.vertices.length < 1) return;
      const b = L.latLngBounds(this.vertices);
      const dLat = Math.max(0.01, (b.getNorth() - b.getSouth()) * 0.5);
      const dLng = Math.max(0.01, (b.getEast() - b.getWest()) * 0.5);
      this.terrain
        .prefetchBounds(b.getSouth() - dLat, b.getWest() - dLng, b.getNorth() + dLat, b.getEast() + dLng)
        .then(() => this._reportLoading());
      this._reportLoading();
    }

    _reportLoading() {
      const n = this.terrain.pending.size;
      this.ui.onState && this.ui.onState({ loading: n > 0, tiles: n });
    }

    // ---------- cálculo (no máximo 1x por frame) ----------
    schedule() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; this._update(); });
    }

    _update() {
      const path = this._pathForProfile();
      if (path.length < 2 || this._length(path) < 1) {
        this.profile = null; this.selection = null; this.chart.setData(null); this._drawSelection(); this._renderStats(); return;
      }
      const pos = samplePositions(path);
      const keys = this.terrain.keysFor(pos.lat, pos.lon);
      const missing = this.terrain.missing(keys);
      if (missing.length) {
        const gen = ++this._gen;
        this.terrain.ensure(missing).then(() => {
          this._reportLoading();
          if (gen === this._gen) this.schedule();
        });
        this._reportLoading();
        return; // mantém o gráfico anterior na tela enquanto carrega
      }
      const p = fillElevation(pos, this.terrain);
      if (!p) return;
      this.profile = p;
      const o = this.linkOpts;
      this.link = o.enabled ? computeLink(p, o) : null;
      this.chart.setData(p, this.link, o.enabled ? o.clutter : 0);
      // O gráfico descarta a seleção quando o nº de amostras muda; acompanha ele.
      if (this.selection && (!this.chart.sel || this.selection[1] >= p.n)) this.selection = null;
      if (this.hoverMarker) this._showHover(this.chart.cursor);
      this._drawSelection();
      this._renderStats();
    }

    // ---------- hover sincronizado mapa <-> gráfico ----------
    _onLineHover(e) {
      const p = this.profile;
      if (!p) return;
      const pt = e.containerPoint;
      let best = 0, bd = Infinity;
      const stride = Math.max(1, Math.floor(p.n / 400));
      for (let i = 0; i < p.n; i += stride) {
        const d = this.map.latLngToContainerPoint([p.lat[i], p.lon[i]]).distanceTo(pt);
        if (d < bd) { bd = d; best = i; }
      }
      for (let i = Math.max(0, best - stride); i <= Math.min(p.n - 1, best + stride); i++) {
        const d = this.map.latLngToContainerPoint([p.lat[i], p.lon[i]]).distanceTo(pt);
        if (d < bd) { bd = d; best = i; }
      }
      this.chart.setCursor(best);
      this._showHover(best);
    }

    _showHover(i) {
      const p = this.profile;
      if (i == null || !p) { if (this.hoverMarker) { this.layer.removeLayer(this.hoverMarker); this.hoverMarker = null; } return; }
      const html =
        `<div class="ep-hover"><div class="ep-hover-label">${Math.round(p.elev[i])} m<br>` +
        `<span>${fmtKm(p.dist[i])}</span> <span>${localSlope(p, i).toFixed(1)}%</span></div>` +
        `<div class="ep-hover-arrow"></div></div>`;
      const icon = L.divIcon({ className: "", html, iconSize: [0, 0], iconAnchor: [0, 0] });
      if (!this.hoverMarker) {
        this.hoverMarker = L.marker([p.lat[i], p.lon[i]], { pane: this.paneHover, icon, interactive: false, zIndexOffset: 2000 }).addTo(this.layer);
      } else {
        this.hoverMarker.setLatLng([p.lat[i], p.lon[i]]);
        this.hoverMarker.setIcon(icon);
      }
    }

    _drawSelection() {
      const p = this.profile, s = this.selection;
      if (!p || !s) { this.selLine.setLatLngs([]); return; }
      const pts = [];
      for (let i = s[0]; i <= s[1]; i++) pts.push([p.lat[i], p.lon[i]]);
      this.selLine.setLatLngs(pts);
    }

    // ---------- barra de estatísticas (igual cabeçalho do GE) ----------
    _renderStats() {
      const el = this.ui.statsEl;
      if (!el) return;
      const p = this.profile;
      if (!p) { el.innerHTML = `<span class="ep-muted">${tr("no_path")}</span>`; return; }
      const all = computeStats(p);
      const s = this.selection ? computeStats(p, this.selection[0], this.selection[1]) : all;
      const f1 = (v) => v.toFixed(1);
      const r = Math.round;
      let html =
        `<div class="ep-row"><span class="ep-cell">${tr("chart_min_avg_max")}</span>` +
        `<span class="ep-cell ep-hl">${tr("elevation", { min: r(all.min), avg: r(all.avg), max: r(all.max) })}</span></div>` +
        `<div class="ep-row"><span class="ep-cell">${this.selection ? tr("selected_segment") : tr("path_totals")}:</span>` +
        `<span class="ep-cell">${tr("distance", { value: fmtKm(s.distance) })}</span>` +
        `<span class="ep-cell">${tr("gain_loss", { gain: f1(s.gain), loss: f1(s.loss) })}</span>` +
        `<span class="ep-cell">${tr("max_slope", { up: f1(s.maxUp), down: f1(s.maxDown) })}</span>` +
        `<span class="ep-cell">${tr("avg_slope", { up: f1(s.avgUp), down: f1(s.avgDown) })}</span></div>`;
      if (this.link) {
        const L2 = this.link, o = this.linkOpts;
        const where = L2.worstIdx > 0 ? fmtKm(p.dist[L2.worstIdx]) : "-";
        const status = L2.blocked
          ? `<b class="ep-bad">${tr("los_blocked")}</b> — ${tr("los_blocked_detail", { where, value: f1(-L2.worstClear) })}`
          : L2.fresnelHit
          ? `<b class="ep-warn">${tr("fresnel_hit")}</b> — ${tr("fresnel_hit_detail", { clear: f1(L2.worstClear), where, pct: Math.round(L2.worstRatio * 100) })}`
          : `<b class="ep-ok">${tr("los_clear")}</b> — ${tr("los_clear_detail", { clear: f1(L2.worstClear), where, pct: Math.round(L2.worstRatio * 100) })}`;
        html += `<div class="ep-row"><span class="ep-cell">${tr("link_params", { freq: o.freqMHz, tx: o.txHeight, rx: o.rxHeight, clutter: o.clutter })}</span><span class="ep-cell">${status}</span></div>`;
      }
      el.innerHTML = html;
    }

    _emitState() { this.ui.onState && this.ui.onState({ drawing: this.drawing }); }
  }

  global.ElevationProfile = { TerrainProvider, ProfileChart, ElevationPathTool, samplePositions, fillElevation, computeStats, computeLink };
})(window);