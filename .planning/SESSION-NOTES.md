# SESSION-NOTES — PayJarvis

> Atualizado automaticamente ao final de cada sessão ou tarefa significativa.
> A próxima sessão DEVE ler este arquivo antes de qualquer ação.

## Última Sessão

- **Data**: 2026-04-04
- **Objetivo**: Completar pendências do rebranding Sniffer (system prompts, banners, Twilio templates)
- **Status**: CONCLUÍDO + DEPLOYED

## O Que Foi Feito

### System Prompts Migrados (2 arquivos)
- `voice/twilio-voice.service.ts` — "You are Jarvis" → "You are Sniffer 🐕" (live phone call prompt)
- `inner-circle/inner-circle.service.ts` — "You are Jarvis 🦀" → "You are Sniffer 🐕" (specialist intro prompt)

### Banners Regenerados (32 imagens)
- 8 landscape `sniffer_*.png` (1200x630) — badge laranja, "SNIFFER / sniffershop.com" no footer
- 8 square `banner_day*.png` (1080x1080) — "S N I F F E R" em laranja, ícone de cachorro, CTA laranja
- Copiados em `apps/api/public/banners/` e `public/banners/`
- Script: `scripts/generate_sniffer_banners.py` (PIL) para regenerar no futuro

### Twilio WhatsApp Templates
- Criados 2 novos templates com branding Sniffer:
  - Welcome: `HXfaa69a88c20c21c84270d42e53385261` (sniffer_welcome)
  - Referral: `HX00f539bb78f8f9f392c50d8933a6044a` (sniffer_referral)
- Submetidos para aprovação WhatsApp (status: received)
- .env e .env.production atualizados com novos SIDs
- Templates antigos (Jarvis) ainda existem no Twilio mas não são mais referenciados

### Deploy
- Build: turbo build API — OK
- PM2 restart: payjarvis-api — OK
- Smoke test: **16/16 passou**, 0 falhas, 2 warnings non-critical

## Pendências

- [ ] WhatsApp Business profile display name — mudar para "Sniffer" no Twilio Console ou Meta Business Manager (requer ação manual)
- [ ] Aguardar aprovação dos 2 Twilio templates (sniffer_welcome, sniffer_referral) — até aprovação, os templates antigos (Jarvis) seriam usados se alguém tentasse enviar via WhatsApp template
- [ ] Deletar templates antigos do Twilio após aprovação dos novos

## Estado dos Serviços
- payjarvis-api: online (port 3001)
- payjarvis-web: online (port 3000)
- openclaw: online (Telegram bot)
- browser-agent: online (port 3003)
- Todos PM2 processes: healthy

## Sandboxes
- `/root/sandbox/Payjarvis_20260404/` — backup pré-deploy desta sessão
- `/root/sandbox/Payjarvis_20260402/` — backup do rebranding anterior

## Contexto Para Próxima Sessão
- Rebranding B2C agora está ~99% completo. Todos os textos, system prompts, banners e templates migrados.
- Única pendência real é o display name do WhatsApp Business (manual).
- Os templates Twilio novos estão pendentes de aprovação do WhatsApp — enquanto não aprovados, tentativas de envio via template podem falhar (mas mensagens normais funcionam).
- Todos os 4 system prompts (Grok, Gemini e-commerce, Twilio voice, Inner Circle) agora usam "Sniffer".
