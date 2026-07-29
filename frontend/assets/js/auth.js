(() => {
  const qs = (sel) => document.querySelector(sel);
  const TOKEN_STORAGE_KEY = "IRRI_AUTH_TOKEN";

  const translate = (key, fallback) => {
    if (typeof window.t == "function") {
      const translated = window.t(key);
      if (translated && translated !== key) return translated;
    }
    return fallback;
  };

  const loginOverlay = qs("#login-overlay");
  const uiWrapper = qs("#ui-wrapper");
  const loginForm = qs("#login-form");
  const emailInput = qs("#email");
  const passwordInput = qs("#password");
  const togglePassBtn = qs("#togglePass");
  const errorBox = qs("#errorBox");
  const submitBtn = qs("#submitBtn");
  const logoutBtn = qs("#btn-logout");
  const particlesCanvas = qs("#particles");
  const particlesCtx = particlesCanvas?.getContext?.("2d");

  function showLogin() {
    loginOverlay && (
      loginOverlay.classList.remove("hidden"),
      loginOverlay.setAttribute("aria-hidden", "false"),
      uiWrapper?.classList.add("ui-locked")
    );
  }

  function hideLogin() {
    loginOverlay && (
      loginOverlay.classList.add("hidden"),
      loginOverlay.setAttribute("aria-hidden", "true"),
      uiWrapper?.classList.remove("ui-locked")
    );
  }

  function getToken() {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  }

  function setToken(token) {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    scheduleSessionExpiry(token);
  }

  function clearToken() {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  }

  function logout(errorOrMessage = {}) {
    const message = typeof errorOrMessage == "string" ? errorOrMessage : errorOrMessage && errorOrMessage.message;
    clearSessionExpiryTimer();
    clearToken();
    showLogin();
    if (message) {
      showError(message);
      typeof window.mostrarMensagem == "function" && window.mostrarMensagem(message, "erro");
    }
  }

  function showError(message) {
    if (!errorBox) return;
    errorBox.textContent = message || "Erro ao autenticar.";
    errorBox.classList.add("is-on");
    document.querySelector("#login-overlay .card")?.animate?.([
      { transform: "translateX(0)" },
      { transform: "translateX(-4px)" },
      { transform: "translateX(4px)" },
      { transform: "translateX(-2px)" },
      { transform: "translateX(0)" }
    ], {
      duration: 240,
      easing: "ease-out"
    });
  }

  function clearError() {
    errorBox && (errorBox.textContent = "", errorBox.classList.remove("is-on"));
  }

  function setSubmitLoading(isLoading) {
    if (!submitBtn) return;
    submitBtn.disabled = !!isLoading;
    const label = submitBtn.querySelector(".btn__text");
    label && (label.textContent = isLoading ? translate("ui.buttons.login_loading", "Entrando...") : translate("ui.buttons.login", "Entrar"));
  }

  let sessionExpiryTimer = null;

  function clearSessionExpiryTimer() {
    sessionExpiryTimer && (clearTimeout(sessionExpiryTimer), sessionExpiryTimer = null);
  }

  function decodeJwtExpiry(token) {
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length < 2) return null;
    try {
      const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
      const json = atob(padded);
      const payload = JSON.parse(json);
      if (typeof payload.exp == "number") return payload.exp * 1000;
    } catch {}
    return null;
  }

  function scheduleSessionExpiry(token) {
    clearSessionExpiryTimer();
    const expiresAtMs = decodeJwtExpiry(token);
    if (!expiresAtMs) return true;

    const now = Date.now();
    const msUntilExpiry = expiresAtMs - now - 5000;
    const expiredMessage = () => translate("messages.errors.session_expired", "Sessao expirada. Faca login novamente.");

    if (msUntilExpiry <= 0) {
      logout(expiredMessage());
      return false;
    }

    sessionExpiryTimer = setTimeout(() => {
      logout(expiredMessage());
    }, msUntilExpiry);
    return true;
  }

  function setupPasswordToggle() {
    if (!togglePassBtn || !passwordInput) return;
    togglePassBtn.addEventListener("click", () => {
      const isPassword = passwordInput.type === "password";
      passwordInput.type = isPassword ? "text" : "password";
      const eyeIcon = togglePassBtn.querySelector(".icon-eye");
      const eyeOffIcon = togglePassBtn.querySelector(".icon-eye-off");
      if (eyeIcon && eyeOffIcon) {
        if (isPassword) {
          eyeIcon.style.display = "none";
          eyeOffIcon.style.display = "block";
        } else {
          eyeIcon.style.display = "block";
          eyeOffIcon.style.display = "none";
        }
      }
    });
  }

  function getBackendConfig() {
    const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    const backend = window.BACKEND_URL || (isLocal ? "http://localhost:8000" : "https://irricontrol-connect.onrender.com");
    const prefix = window.API_PREFIX || "/api/v1";
    return {
      backend: String(backend).replace(/\/+$/, ""),
      prefix: String(prefix).replace(/\/+$/, "")
    };
  }

  async function loginRequest(username, password) {
    const { backend, prefix } = getBackendConfig();
    const url = `${backend}${prefix}/auth/login`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      let errorMessage = `Erro ${response.status}: senha inválida.`;
      try {
        const errorBody = await response.json();
        errorMessage = errorBody?.detail || errorBody?.message || errorMessage;
      } catch {
        try {
          const errorText = await response.text();
          errorText && (errorMessage = errorText);
        } catch {}
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    if (!data?.access_token) throw new Error("Login falhou: token ausente.");
    return data.access_token;
  }

  function setupLoginForm() {
    loginForm && loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearError();

      const username = (emailInput?.value || "").trim();
      const password = (passwordInput?.value || "").trim();
      if (!username || !password) {
        showError("Preencha usuário e senha.");
        return;
      }

      setSubmitLoading(true);
      try {
        const token = await loginRequest(username, password);
        setToken(token);
        const label = submitBtn?.querySelector?.(".btn__text");
        label && (label.textContent = translate("ui.buttons.login_success", "Acesso liberado ✔"));
        setTimeout(() => {
          setSubmitLoading(false);
          hideLogin();
          window.dispatchEvent(new CustomEvent("auth:login"));
          typeof window.mostrarMensagem == "function" && window.mostrarMensagem("Login realizado.", "sucesso");
        }, 250);
      } catch (err) {
        setSubmitLoading(false);
        const errorMessage = err?.message || "Falha ao autenticar.";
        showError(errorMessage);
        typeof window.mostrarMensagem == "function" && window.mostrarMensagem(errorMessage, "erro");
      }
    });
  }

  // --- Background particle animation on the login screen ---
  let canvasWidth = 0;
  let canvasHeight = 0;
  let pixelRatio = 1;
  let particles = [];

  const PARTICLE_COUNT = 600;
  const CLUSTER_COUNT = 8;
  const CLUSTER_SPREAD = 0.18;
  const mousePos = { x: -9999, y: -9999 };
  const MOUSE_REPEL_RADIUS = 140;
  const MOUSE_REPEL_STRENGTH = 2.8;
  const MAX_PARTICLE_SPEED = 2.2;

  function resizeCanvas() {
    if (!particlesCanvas || !particlesCtx) return;
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvasWidth = particlesCanvas.width = Math.floor(window.innerWidth * pixelRatio);
    canvasHeight = particlesCanvas.height = Math.floor(window.innerHeight * pixelRatio);
    particlesCanvas.style.width = "100%";
    particlesCanvas.style.height = "100%";
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function initParticles() {
    const clusters = Array.from({ length: CLUSTER_COUNT }, () => ({
      cx: randomBetween(0.1 * canvasWidth, 0.9 * canvasWidth),
      cy: randomBetween(0.1 * canvasHeight, 0.9 * canvasHeight)
    }));

    particles = Array.from({ length: PARTICLE_COUNT }, (_, index) => {
      let x, y;
      if (Math.random() < 0.25) {
        const cluster = clusters[index % clusters.length];
        const angle = randomBetween(0, Math.PI * 2);
        const distance = randomBetween(0, CLUSTER_SPREAD * Math.min(canvasWidth, canvasHeight));
        x = cluster.cx + Math.cos(angle) * distance;
        y = cluster.cy + Math.sin(angle) * distance;
      } else {
        x = randomBetween(0, canvasWidth);
        y = randomBetween(0, canvasHeight);
      }
      const vx = randomBetween(-0.14, 0.14) * pixelRatio;
      const vy = randomBetween(-0.12, 0.12) * pixelRatio;
      return {
        x, y,
        r: randomBetween(1 * pixelRatio, 2.6 * pixelRatio),
        vx, vy,
        bvx: vx, bvy: vy,
        a: randomBetween(0.45, 1)
      };
    });
  }

  function animateParticles() {
    if (!particlesCtx) return;
    particlesCtx.clearRect(0, 0, canvasWidth, canvasHeight);

    const repelRadius = MOUSE_REPEL_RADIUS * pixelRatio;
    for (const p of particles) {
      const dx = p.x - mousePos.x;
      const dy = p.y - mousePos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < repelRadius && dist > 0) {
        const force = (1 - dist / repelRadius) * MOUSE_REPEL_STRENGTH * pixelRatio;
        p.vx += dx / dist * force;
        p.vy += dy / dist * force;
      }

      p.vx += (p.bvx - p.vx) * 0.018;
      p.vy += (p.bvy - p.vy) * 0.018;

      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      const maxSpeed = MAX_PARTICLE_SPEED * pixelRatio;
      if (speed > maxSpeed) {
        p.vx = p.vx / speed * maxSpeed;
        p.vy = p.vy / speed * maxSpeed;
      }

      p.x += p.vx;
      p.y += p.vy;
      p.x < -20 && (p.x = canvasWidth + 20);
      p.x > canvasWidth + 20 && (p.x = -20);
      p.y < -20 && (p.y = canvasHeight + 20);
      p.y > canvasHeight + 20 && (p.y = -20);

      particlesCtx.shadowBlur = 8 * pixelRatio;
      particlesCtx.shadowColor = "rgba(60,255,106,0.9)";
      particlesCtx.beginPath();
      particlesCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      particlesCtx.fillStyle = `rgba(60,255,106,${p.a})`;
      particlesCtx.fill();
      particlesCtx.shadowBlur = 0;
    }

    const linkRadius = 140 * pixelRatio;
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i];
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < linkRadius) {
          const alpha = (1 - dist / linkRadius) * 0.18;
          particlesCtx.strokeStyle = `rgba(0,212,255,${alpha})`;
          particlesCtx.lineWidth = 1.2;
          particlesCtx.beginPath();
          particlesCtx.moveTo(a.x, a.y);
          particlesCtx.lineTo(b.x, b.y);
          particlesCtx.stroke();
        }
      }
    }

    const mouseLinkRadius = 160 * pixelRatio;
    for (const p of particles) {
      const dx = p.x - mousePos.x;
      const dy = p.y - mousePos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < mouseLinkRadius) {
        const alpha = (1 - dist / mouseLinkRadius) * 0.32;
        particlesCtx.strokeStyle = `rgba(60,255,106,${alpha})`;
        particlesCtx.lineWidth = 1;
        particlesCtx.beginPath();
        particlesCtx.moveTo(mousePos.x, mousePos.y);
        particlesCtx.lineTo(p.x, p.y);
        particlesCtx.stroke();
      }
    }

    requestAnimationFrame(animateParticles);
  }

  function setupParticles() {
    if (!particlesCanvas || !particlesCtx) return;
    resizeCanvas();
    initParticles();
    requestAnimationFrame(animateParticles);
    window.addEventListener("resize", () => {
      resizeCanvas();
      initParticles();
    });
    window.addEventListener("mousemove", (event) => {
      mousePos.x = event.clientX * pixelRatio;
      mousePos.y = event.clientY * pixelRatio;
    });
    window.addEventListener("mouseleave", () => {
      mousePos.x = -9999;
      mousePos.y = -9999;
    });
  }

  function init() {
    setupPasswordToggle();
    setupLoginForm();
    setupParticles();
    logoutBtn?.addEventListener("click", () => logout());

    const existingToken = getToken();
    existingToken && scheduleSessionExpiry(existingToken) ? hideLogin() : showLogin();
  }

  window.Auth = {
    showLogin,
    hideLogin,
    getToken,
    setToken,
    logout
  };

  document.addEventListener("DOMContentLoaded", init);
})();
