(function() {
  const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  window.BACKEND_URL = isLocal ? "http://localhost:8000" : "https://irricontrol-connect.onrender.com";
  window.API_PREFIX = "/api/v1";
})();
