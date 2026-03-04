/**
 * PayJarvis Adapter — Vanilla JS (standalone, production)
 *
 * Inject via:
 *   <script src="https://api.payjarvis.com/adapter.js"
 *     data-merchant-id="YOUR_ID"
 *     data-min-trust-score="0"
 *     async></script>
 *
 * Detects BDIT tokens from cookies, localStorage, meta tags,
 * hidden inputs, and URL params. Calls /v1/verify and injects
 * a visual badge + detail modal.
 *
 * Events dispatched on window:
 *   payjarvis:verified   — token valid
 *   payjarvis:unverified — token invalid
 *   payjarvis:no_token   — no token found
 *   payjarvis:error      — API error
 */
(function () {
  "use strict";

  var PAYJARVIS_API = "https://api.payjarvis.com";
  var BADGE_ID = "__payjarvis_badge";
  var MODAL_ID = "__payjarvis_modal";
  var STYLES_ID = "__pj_styles";

  var script =
    document.currentScript ||
    document.querySelector("script[data-merchant-id]");

  var MERCHANT_ID = script
    ? script.getAttribute("data-merchant-id") ||
      script.getAttribute("data-merchant")
    : "";

  var MIN_TRUST = parseInt(
    (script && script.getAttribute("data-min-trust-score")) || "0",
    10
  );

  var CUSTOM_API = script && script.getAttribute("data-api");
  if (CUSTOM_API) PAYJARVIS_API = CUSTOM_API;

  // ─── Token extraction ──────────────────────────

  function getToken() {
    // 1. Cookie
    var cookies = document.cookie.split(";");
    for (var i = 0; i < cookies.length; i++) {
      var parts = cookies[i].trim().split("=");
      if (parts[0] === "__payjarvis_bdit")
        return decodeURIComponent(parts.slice(1).join("="));
    }

    // 2. localStorage
    try {
      var t = localStorage.getItem("payjarvis_bdit");
      if (t) return t;
    } catch (e) {
      /* blocked */
    }

    // 3. Meta tag
    var meta = document.querySelector('meta[name="payjarvis-token"]');
    if (meta) return meta.getAttribute("content");

    // 4. Hidden input
    var input = document.querySelector('input[name="payjarvis_token"]');
    if (input && input.value) return input.value;

    // 5. URL parameter
    try {
      var params = new URLSearchParams(window.location.search);
      var fromUrl = params.get("payjarvis_token");
      if (fromUrl) return fromUrl;
    } catch (e) {
      /* old browser */
    }

    return null;
  }

  // ─── Styles ────────────────────────────────────

  function injectStyles() {
    if (document.getElementById(STYLES_ID)) return;
    var style = document.createElement("style");
    style.id = STYLES_ID;
    style.textContent = [
      "#" + BADGE_ID + "{position:fixed;top:16px;right:16px;z-index:2147483647;",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;",
      "font-size:13px;border-radius:10px;padding:10px 14px;cursor:pointer;",
      "box-shadow:0 4px 16px rgba(0,0,0,.18);transition:opacity .3s;",
      "animation:pjSlide .35s ease;}",
      "@keyframes pjSlide{from{opacity:0;transform:translateX(40px)}",
      "to{opacity:1;transform:none}}",
      "#" + BADGE_ID + ".verified{background:#052e16;border:1px solid #22c55e;color:#86efac;}",
      "#" + BADGE_ID + ".unverified{background:#1c1917;border:1px solid #eab308;color:#fde047;}",
      "#" + MODAL_ID + "{display:none;position:fixed;inset:0;z-index:2147483646;",
      "background:rgba(0,0,0,.7);align-items:center;justify-content:center;}",
      "#" + MODAL_ID + ".open{display:flex;}",
      "#__pj_modal_box{background:#111;border:1px solid #333;border-radius:16px;",
      "padding:28px;max-width:380px;width:90%;color:#f5f5f5;font-family:-apple-system,",
      "BlinkMacSystemFont,'Segoe UI',sans-serif;}",
      "#__pj_modal_box h3{margin:0 0 16px;font-size:16px;color:#22c55e;}",
      "#__pj_modal_box p{margin:4px 0;font-size:13px;color:#aaa;}",
      "#__pj_modal_box strong{color:#f5f5f5;}",
      "#__pj_close{margin-top:20px;background:#333;border:none;color:#fff;",
      "padding:8px 20px;border-radius:8px;cursor:pointer;font-size:13px;width:100%;}",
      "#__pj_close:hover{background:#444;}",
    ].join("\n");
    document.head.appendChild(style);
  }

  // ─── HTML helpers ──────────────────────────────

  function escHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function dispatchEvent(name, detail) {
    try {
      window.dispatchEvent(
        new CustomEvent("payjarvis:" + name, { detail: detail })
      );
    } catch (e) {
      /* old browser */
    }
  }

  // ─── Badge & Modal ─────────────────────────────

  function removeBadge() {
    var b = document.getElementById(BADGE_ID);
    if (b) b.remove();
    var m = document.getElementById(MODAL_ID);
    if (m) m.remove();
  }

  function createBadge(data) {
    removeBadge();
    injectStyles();

    var badge = document.createElement("div");
    badge.id = BADGE_ID;

    if (data.verified) {
      badge.className = "verified";
      var botName = escHtml(
        (data.bot && (data.bot.name || data.bot.id)) || "Agente AI"
      );
      var trustScore =
        (data.bot && (data.bot.trustScore || data.bot.trust_score)) || "?";
      var amount =
        data.authorization && data.authorization.amount != null
          ? "$" + data.authorization.amount
          : "";

      badge.innerHTML =
        '<span style="font-size:15px">&#x1F916;</span> ' +
        '<span style="color:#22c55e">&#x2713;</span> Bot Verificado &mdash; <strong>' +
        botName +
        "</strong>" +
        "<br><small>Trust Score: " +
        trustScore +
        "/100" +
        (amount ? " &middot; " + amount : "") +
        "</small>";

      document.body.setAttribute("data-payjarvis-verified", "true");
    } else {
      badge.className = "unverified";
      badge.innerHTML =
        '<span style="font-size:15px">&#x26A0;</span> Agente n&atilde;o verificado pelo Payjarvis';
    }

    // Modal
    var modal = document.createElement("div");
    modal.id = MODAL_ID;

    var mc = '<div id="__pj_modal_box">';
    if (data.verified) {
      var bot = data.bot || {};
      var auth = data.authorization || {};
      mc +=
        "<h3>&#x1F6E1;&#xFE0F; Payjarvis &mdash; Detalhes do Bot</h3>" +
        "<p>Bot: <strong>" + escHtml(bot.name || bot.id || "&mdash;") + "</strong></p>" +
        "<p>Trust Score: <strong>" + (bot.trustScore || bot.trust_score || "&mdash;") + "/100</strong></p>" +
        "<p>Plataforma: <strong>" + escHtml(bot.platform || "&mdash;") + "</strong></p>" +
        "<p>Valor autorizado: <strong>$" + (auth.amount != null ? auth.amount : "&mdash;") + "</strong></p>" +
        "<p>Categoria: <strong>" + escHtml(auth.category || "&mdash;") + "</strong></p>" +
        "<p>V&aacute;lido at&eacute;: <strong>" +
        (auth.validUntil ? new Date(auth.validUntil).toLocaleString() : "&mdash;") +
        "</strong></p>" +
        "<p>Uso &uacute;nico: <strong>" + (auth.oneTimeUse ? "Sim" : "N&atilde;o") + "</strong></p>";
    } else {
      mc +=
        '<h3 style="color:#eab308">&#x26A0; Agente N&atilde;o Verificado</h3>' +
        "<p>Este agente AI n&atilde;o possui certificado Payjarvis v&aacute;lido.</p>" +
        "<p>Motivo: <strong>" + escHtml(data.error || "Token inv&aacute;lido") + "</strong></p>";
    }
    mc += '<button id="__pj_close">Fechar</button></div>';
    modal.innerHTML = mc;

    badge.onclick = function () {
      modal.classList.add("open");
    };
    modal.addEventListener("click", function (e) {
      if (e.target === modal || e.target.id === "__pj_close") {
        modal.classList.remove("open");
      }
    });

    document.body.appendChild(badge);
    document.body.appendChild(modal);
  }

  // ─── Verification ──────────────────────────────

  function verify(token) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", PAYJARVIS_API + "/v1/verify", true);
    xhr.setRequestHeader("X-Bdit-Token", token);
    xhr.setRequestHeader("X-Merchant-Id", MERCHANT_ID);
    xhr.timeout = 10000;

    xhr.onload = function () {
      try {
        var data = JSON.parse(xhr.responseText);

        // Check min trust score
        if (
          data.verified &&
          MIN_TRUST > 0 &&
          data.bot &&
          (data.bot.trustScore || data.bot.trust_score || 0) < MIN_TRUST
        ) {
          data.verified = false;
          data.error = "Trust score below minimum (" + MIN_TRUST + ")";
        }

        createBadge(data);

        if (data.verified) {
          dispatchEvent("verified", data);
        } else {
          dispatchEvent("unverified", data);
        }
      } catch (e) {
        dispatchEvent("error", { message: "Parse error: " + e.message });
      }
    };

    xhr.onerror = function () {
      dispatchEvent("error", { message: "Payjarvis API unavailable" });
    };

    xhr.ontimeout = function () {
      dispatchEvent("error", { message: "Payjarvis API timeout" });
    };

    xhr.send();
  }

  // ─── Init ──────────────────────────────────────

  function init() {
    if (!MERCHANT_ID) {
      console.error("[PayJarvis] data-merchant-id attribute required");
      return;
    }

    var token = getToken();
    if (token) {
      verify(token);
    } else {
      dispatchEvent("no_token", {});
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // ─── Public API ────────────────────────────────

  window.Payjarvis = {
    verify: verify,
    getToken: getToken,
    createBadge: createBadge,
    removeBadge: removeBadge,
    merchantId: MERCHANT_ID,
    version: "1.0.0",
  };
})();
