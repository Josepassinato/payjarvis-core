# Lessons Learned — PayJarvis

## Browserbase Live View — URL Correto para End-Users

**Data:** 2026-03-18
**Severidade:** Bug critico de UX — usuarios viam login do Browserbase em vez da Amazon

### Problema
Ao expor o browser remoto ao usuario final via iframe, usar a URL padrao do Browserbase:
`https://www.browserbase.com/sessions/{id}/live-view`
Requer que o viewer esteja autenticado no Browserbase → mostra "Welcome back!" (tela de login do Browserbase) em vez do browser remoto com a pagina da Amazon.

### Solucao
Usar `client.sessions.debug()` que retorna `debuggerFullscreenUrl` — uma URL com token embutido que concede acesso direto ao browser remoto sem autenticacao do Browserbase:

```typescript
// ❌ ANTES — requer auth do Browserbase
const liveUrl = `https://www.browserbase.com/sessions/${sessionId}/live-view`;

// ✅ DEPOIS — token embutido, acesso direto
const { debuggerFullscreenUrl } = await client.sessions.debug(sessionId);
// Usar debuggerFullscreenUrl no iframe — token-embedded, sem auth necessario
```

### Regra
- **NUNCA** usar `/sessions/{id}/live-view` para end-users
- **SEMPRE** usar `debuggerFullscreenUrl` via `client.sessions.debug()`
- A URL com token embutido expira com a sessao, entao e segura para uso temporario

### Contexto
O Browserbase tem dois modos de visualizacao:
1. `live-view` — requer auth do Browserbase (para desenvolvedores/debug interno)
2. `debuggerFullscreenUrl` — token embutido (para expor ao end-user)

### Arquivos corrigidos
- `apps/browser-agent/src/routes/bb-checkout.ts` — linha ~116, substituido URL hardcoded por `getLiveUrl(sessionId)`
- `apps/browser-agent/src/services/bb-context.service.ts` — funcao `getLiveUrl()` ja usava `debuggerFullscreenUrl` corretamente
