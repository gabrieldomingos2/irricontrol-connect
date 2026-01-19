// assets/js/auth.js
// Login overlay controller + particles (pure JS)
// Integra com backend: POST {API_PREFIX}/auth/login
// Requisitos no HTML: #login-overlay, #login-form, #email, #password, #togglePass, #errorBox, #submitBtn, #particles

(() => {
  const $ = (sel) => document.querySelector(sel);

  const AUTH_KEY = "IRRI_AUTH_TOKEN";

  const overlay = $("#login-overlay");
  const ui = $("#ui-wrapper");

  const form = $("#login-form");
  const email = $("#email");
  const pass = $("#password");
  const toggle = $("#togglePass");
  const errorBox = $("#errorBox");
  const submitBtn = $("#submitBtn");
  const logoutBtn = $("#btn-logout");

  // Canvas particles
  const canvas = $("#particles");
  const ctx = canvas?.getContext?.("2d");

  // ---------------------------
  // Helpers: show/hide overlay
  // ---------------------------
  function showLogin() {
    if (!overlay) return;
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
    ui?.classList.add("ui-locked");
  }

  function hideLogin() {
    if (!overlay) return;
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
    ui?.classList.remove("ui-locked");
  }

  function getToken() {
    return localStorage.getItem(AUTH_KEY);
  }

  function setToken(token) {
    localStorage.setItem(AUTH_KEY, token);
  }

  function clearToken() {
    localStorage.removeItem(AUTH_KEY);
  }

  function logout() {
    clearToken();
    showLogin();
  }

  // ---------------------------
  // UI: errors + loading state
  // ---------------------------
  function showError(msg) {
    if (!errorBox) return;
    errorBox.textContent = msg || "Erro ao autenticar.";
    errorBox.classList.add("is-on");

    // tremidinha suave no card (igual teu login demo)
    const card = document.querySelector("#login-overlay .card");
    card?.animate?.(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-4px)" },
        { transform: "translateX(4px)" },
        { transform: "translateX(-2px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 240, easing: "ease-out" }
    );
  }

  function clearError() {
    if (!errorBox) return;
    errorBox.textContent = "";
    errorBox.classList.remove("is-on");
  }

  function setLoading(isLoading) {
    if (!submitBtn) return;
    submitBtn.disabled = !!isLoading;
    const label = submitBtn.querySelector(".btn__text");
    if (label) label.textContent = isLoading ? "Entrando..." : "Entrar";
  }

  // ---------------------------
  // Toggle password + icons
  // ---------------------------
  function wireTogglePassword() {
    if (!toggle || !pass) return;
    toggle.addEventListener("click", () => {
      const isPass = pass.type === "password";
      pass.type = isPass ? "text" : "password";

      const eye = toggle.querySelector(".icon-eye");
      const eyeOff = toggle.querySelector(".icon-eye-off");

      if (eye && eyeOff) {
        if (isPass) {
          eye.style.display = "none";
          eyeOff.style.display = "block";
        } else {
          eye.style.display = "block";
          eyeOff.style.display = "none";
        }
      }
    });
  }

  // ---------------------------
  // Backend login
  // ---------------------------
  function computeApiBase() {
    // Mesmo padrão do seu api.js (pra não ter 2 mundos) :contentReference[oaicite:4]{index=4}
    const isLocal =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";

    const BACKEND_URL =
      window.BACKEND_URL ||
      (isLocal ? "http://localhost:8000" : "https://irricontrol-connect.onrender.com");

    const API_PREFIX = window.API_PREFIX || "/api/v1";

    return {
      backend: String(BACKEND_URL).replace(/\/+$/, ""),
      prefix: String(API_PREFIX).replace(/\/+$/, ""),
    };
  }

  async function loginRequest(username, password) {
    const { backend, prefix } = computeApiBase();
    const url = `${backend}${prefix}/auth/login`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      let msg = `Erro ${res.status}: senha inválida.`;
      try {
        const j = await res.json();
        msg = j?.detail || j?.message || msg;
      } catch {
        try {
          const t = await res.text();
          if (t) msg = t;
        } catch {}
      }
      throw new Error(msg);
    }

    const data = await res.json();
    if (!data?.access_token) throw new Error("Login falhou: token ausente.");
    return data.access_token;
  }

  function wireSubmit() {
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearError();

      const vEmail = (email?.value || "").trim();
      const vPass = (pass?.value || "").trim();

      if (!vEmail || !vPass) {
        showError("Preencha usuário e senha.");
        return;
      }

      setLoading(true);

      try {
        // Usuário é “enfeite” pro ambiente de teste; senha é o que manda.
        const token = await loginRequest(vEmail, vPass);
        setToken(token);

        // feedback legal
        const label = submitBtn?.querySelector?.(".btn__text");
        if (label) label.textContent = "Acesso liberado ✔";

        // fecha overlay
        setTimeout(() => {
          setLoading(false);
          hideLogin();

            window.dispatchEvent(new CustomEvent("auth:login"));

          // dica opcional
          if (typeof window.mostrarMensagem === "function") {
            window.mostrarMensagem("Login realizado.", "sucesso");
          }
        }, 250);
      } catch (err) {
        setLoading(false);

        // Se o backend ainda não tem /auth/login, isso costuma vir como 404/HTML.
        const msg = (err && err.message) ? err.message : "Falha ao autenticar.";
        showError(msg);

        // também espelha em toast do app, se existir
        if (typeof window.mostrarMensagem === "function") {
          window.mostrarMensagem(msg, "erro");
        }
      }
    });
  }

  // ---------------------------
  // Particles (adaptado do seu demo) :contentReference[oaicite:5]{index=5}
  // ---------------------------
  let W = 0, H = 0, DPR = 1;
  let particles = [];
  const N = 70;

  function resizeCanvas() {
    if (!canvas || !ctx) return;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.width = Math.floor(window.innerWidth * DPR);
    H = canvas.height = Math.floor(window.innerHeight * DPR);
    canvas.style.width = "100%";
    canvas.style.height = "100%";
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function seedParticles() {
    particles = Array.from({ length: N }, () => ({
      x: rand(0, W),
      y: rand(0, H),
      r: rand(1.2 * DPR, 2.8 * DPR),
      vx: rand(-0.12, 0.12) * DPR,
      vy: rand(-0.10, 0.10) * DPR,
      a: rand(0.18, 0.65),
    }));
  }

  function stepParticles() {
    if (!ctx) return;

    ctx.clearRect(0, 0, W, H);

    // bolinhas
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < -20) p.x = W + 20;
      if (p.x > W + 20) p.x = -20;
      if (p.y < -20) p.y = H + 20;
      if (p.y > H + 20) p.y = -20;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(60,255,106,${p.a})`;
      ctx.fill();
    }

    // linhas (sutil)
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i], b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const max = 140 * DPR;
        if (d < max) {
          const alpha = (1 - d / max) * 0.18;
          ctx.strokeStyle = `rgba(0,212,255,${alpha})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    requestAnimationFrame(stepParticles);
  }

  function startParticles() {
    if (!canvas || !ctx) return;
    resizeCanvas();
    seedParticles();
    requestAnimationFrame(stepParticles);
    window.addEventListener("resize", () => {
      resizeCanvas();
      seedParticles();
    });
  }

  // ---------------------------
  // Boot
  // ---------------------------
  function boot() {
    wireTogglePassword();
    wireSubmit();
    startParticles();
    logoutBtn?.addEventListener("click", () => logout());

    // Mostra/oculta login conforme token
    if (getToken()) {
      hideLogin();
    } else {
      showLogin();
    }
  }

  // Expor API global pra api.js injetar Authorization
  window.Auth = {
    showLogin,
    hideLogin,
    getToken,
    setToken,
    logout,
  };

  document.addEventListener("DOMContentLoaded", boot);
})();
