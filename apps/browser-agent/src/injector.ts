/**
 * Page Injector — Injeta elementos visuais na página via CDP.
 *
 * Cria overlays, badges e banners diretamente no DOM
 * da página monitorada usando Runtime.evaluate.
 */

import type { CdpMonitor } from "./cdp-monitor.js";

export class PageInjector {
  constructor(
    private cdpMonitor: CdpMonitor,
    private targetId: string
  ) {}

  private async evaluate(expression: string): Promise<void> {
    await this.cdpMonitor.evaluate(this.targetId, expression);
  }

  /** Overlay de pausa — bloqueia toda interação com a página */
  async injectPauseOverlay(message: string): Promise<void> {
    await this.evaluate(`
      (function() {
        if (document.getElementById('payjarvis-overlay')) return;

        var overlay = document.createElement('div');
        overlay.id = 'payjarvis-overlay';
        overlay.style.cssText =
          'position:fixed;inset:0;z-index:999999;' +
          'background:rgba(0,0,0,0.7);' +
          'display:flex;flex-direction:column;' +
          'align-items:center;justify-content:center;' +
          'font-family:system-ui,-apple-system,sans-serif;' +
          'color:white;backdrop-filter:blur(4px);';

        overlay.innerHTML =
          '<div style="text-align:center;max-width:400px;">' +
            '<div style="font-size:48px;margin-bottom:16px;">\\u{1F6E1}\\uFE0F</div>' +
            '<div style="font-size:20px;font-weight:700;margin-bottom:8px;">PayJarvis</div>' +
            '<div style="font-size:15px;opacity:0.9;margin-bottom:24px;">' +
              ${JSON.stringify(message)} +
            '</div>' +
            '<div id="payjarvis-spinner" style="' +
              'width:32px;height:32px;margin:0 auto;' +
              'border:3px solid rgba(255,255,255,0.2);' +
              'border-top-color:white;border-radius:50%;' +
              'animation:payjarvis-spin 0.8s linear infinite;' +
            '"></div>' +
          '</div>';

        var style = document.createElement('style');
        style.textContent = '@keyframes payjarvis-spin{to{transform:rotate(360deg)}}';
        overlay.appendChild(style);

        // Bloquear todos os eventos
        overlay.addEventListener('click', function(e){e.stopPropagation();}, true);
        overlay.addEventListener('keydown', function(e){e.stopPropagation();}, true);

        document.body.appendChild(overlay);
      })()
    `);
  }

  /** Remove overlay de pausa */
  async removePauseOverlay(): Promise<void> {
    await this.evaluate(`
      (function() {
        var el = document.getElementById('payjarvis-overlay');
        if (el) el.remove();
      })()
    `);
  }

  /** Badge de aprovação — canto superior direito */
  async injectApprovedBadge(bot: {
    name: string;
    trustScore: number;
    amount: number;
    currency: string;
  }): Promise<void> {
    const currencySymbol =
      bot.currency === "BRL" ? "R$"
      : bot.currency === "EUR" ? "\\u20AC"
      : bot.currency === "GBP" ? "\\u00A3"
      : "$";

    await this.evaluate(`
      (function() {
        // Remover overlay se existir
        var overlay = document.getElementById('payjarvis-overlay');
        if (overlay) overlay.remove();

        // Remover badge anterior
        var old = document.getElementById('payjarvis-badge');
        if (old) old.remove();

        var badge = document.createElement('div');
        badge.id = 'payjarvis-badge';
        badge.style.cssText =
          'position:fixed;top:16px;right:16px;z-index:999998;' +
          'background:#15803d;color:white;padding:12px 20px;' +
          'border-radius:12px;font-family:system-ui,sans-serif;' +
          'box-shadow:0 4px 20px rgba(0,0,0,0.3);' +
          'transform:translateX(120%);transition:transform 0.4s ease;' +
          'max-width:320px;';

        badge.innerHTML =
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
            '<span style="font-size:16px;">\\u{1F916} \\u2713</span>' +
            '<strong style="font-size:14px;">Bot Verificado \\u2014 ' +
              ${JSON.stringify(bot.name)} +
            '</strong>' +
          '</div>' +
          '<div style="font-size:12px;opacity:0.85;">' +
            'Trust Score: ' + ${bot.trustScore} + '/100 | ' +
            'Valor: ${currencySymbol}' + ${bot.amount.toFixed(2)} +
          '</div>';

        document.body.appendChild(badge);

        // Slide in
        requestAnimationFrame(function() {
          requestAnimationFrame(function() {
            badge.style.transform = 'translateX(0)';
          });
        });

        // Auto-remover após 10s
        setTimeout(function() {
          badge.style.transform = 'translateX(120%)';
          setTimeout(function() { badge.remove(); }, 500);
        }, 10000);
      })()
    `);
  }

  /** Banner de bloqueio — fullscreen permanente */
  async injectBlockedBanner(reason: string): Promise<void> {
    await this.evaluate(`
      (function() {
        // Remover overlay de loading
        var overlay = document.getElementById('payjarvis-overlay');
        if (overlay) overlay.remove();

        var banner = document.createElement('div');
        banner.id = 'payjarvis-blocked';
        banner.style.cssText =
          'position:fixed;inset:0;z-index:999999;' +
          'background:rgba(239,68,68,0.95);' +
          'display:flex;flex-direction:column;' +
          'align-items:center;justify-content:center;' +
          'font-family:system-ui,-apple-system,sans-serif;' +
          'color:white;backdrop-filter:blur(8px);';

        banner.innerHTML =
          '<div style="text-align:center;max-width:480px;padding:32px;">' +
            '<div style="font-size:64px;margin-bottom:16px;">\\u274C</div>' +
            '<div style="font-size:24px;font-weight:700;margin-bottom:12px;">' +
              'Compra Bloqueada pelo Payjarvis' +
            '</div>' +
            '<div style="font-size:15px;opacity:0.9;margin-bottom:24px;line-height:1.5;">' +
              ${JSON.stringify(reason)} +
            '</div>' +
            '<div style="font-size:13px;opacity:0.7;margin-bottom:24px;">' +
              'Esta compra n\\u00E3o foi autorizada pelo propriet\\u00E1rio do bot.' +
            '</div>' +
            '<button id="payjarvis-blocked-ack" style="' +
              'background:rgba(255,255,255,0.15);color:white;' +
              'border:1px solid rgba(255,255,255,0.3);' +
              'padding:10px 32px;border-radius:8px;' +
              'font-size:14px;cursor:pointer;' +
            '">Entendi</button>' +
          '</div>';

        // Bloquear eventos
        banner.addEventListener('click', function(e) { e.stopPropagation(); }, true);

        document.body.appendChild(banner);

        // Botão "Entendi" — registra mas NÃO remove
        document.getElementById('payjarvis-blocked-ack').addEventListener('click', function() {
          this.textContent = 'Registrado';
          this.disabled = true;
          this.style.opacity = '0.5';
          // Disparar evento para o bot saber
          window.dispatchEvent(new CustomEvent('payjarvis:blocked:acknowledged'));
        });
      })()
    `);
  }

  /** Mensagem de aguardando aprovação humana */
  async injectPendingMessage(): Promise<void> {
    await this.evaluate(`
      (function() {
        // Atualizar overlay existente ou criar novo
        var overlay = document.getElementById('payjarvis-overlay');
        if (!overlay) return;

        var content = overlay.querySelector('div');
        if (!content) return;

        content.innerHTML =
          '<div style="font-size:48px;margin-bottom:16px;">\\u23F3</div>' +
          '<div style="font-size:20px;font-weight:700;margin-bottom:8px;">PayJarvis</div>' +
          '<div style="font-size:15px;opacity:0.9;margin-bottom:8px;">' +
            'Aguardando aprova\\u00E7\\u00E3o no app Payjarvis...' +
          '</div>' +
          '<div id="payjarvis-countdown" style="font-size:13px;opacity:0.6;">' +
            'Timeout em 5:00' +
          '</div>' +
          '<div style="' +
            'width:32px;height:32px;margin:16px auto 0;' +
            'border:3px solid rgba(255,255,255,0.2);' +
            'border-top-color:#fbbf24;border-radius:50%;' +
            'animation:payjarvis-spin 0.8s linear infinite;' +
          '"></div>';
      })()
    `);
  }

  /** Atualizar countdown na mensagem de pending */
  async updatePendingMessage(secondsLeft: number): Promise<void> {
    const mins = Math.floor(secondsLeft / 60);
    const secs = secondsLeft % 60;
    const timeStr = `${mins}:${secs.toString().padStart(2, "0")}`;

    await this.evaluate(`
      (function() {
        var el = document.getElementById('payjarvis-countdown');
        if (el) el.textContent = 'Timeout em ${timeStr}';
      })()
    `);
  }
}
