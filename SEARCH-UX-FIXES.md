# Search UX Fixes — 2026-04-05 (v2)

> Sessão anterior corrigiu parcialmente; esta sessão corrige definitivamente os 3 bugs.

## Bug 1 (P0): Links quebrados nos resultados de busca

**Problema:** URLs do Google Shopping cruas (google.com/search?ibp=oshop&q=...) sendo enviadas ao usuário em vez de links diretos do produto.

**Causa raiz:** `cleanProductUrl()` só detectava `google.com/search` literal e não extraía URLs reais embedadas nos parâmetros de redirect do Google. Para lojas desconhecidas (ex: "Scents Angel"), retornava a URL crua do Google.

**Correção:**
- **Arquivo:** `apps/api/src/services/search/unified-search.service.ts`
- Ampliado regex para detectar: `google.com/(search|shopping|url|aclk|imgres)`
- Extração de URL real dos parâmetros Google: `?url=`, `?adurl=`, `?merchant_purl=`, `murl:` dentro de `prds`
- Adicionado 9 lojas ao mapa de URLs de busca (nordstrom, costco, homedepot, lowes, newegg, nike, adidas, etc.)
- Fallback: para lojas desconhecidas, gera URL limpa de Google Shopping (`?tbm=shop&q=...`) em vez do redirect cru
- SerpAPI: prioriza `item.link` direto; se contém `google.com/`, usa `item.product_link`

## Bug 2 (P1): Respostas duplicadas (cupons + produtos separados)

**Problema:** Ao buscar produtos, o agente enviava duas mensagens: uma sobre cupons e outra sobre produtos/preços.

**Causa raiz:** O system prompt instruía Gemini a chamar 3 tools sequenciais após cada busca (`search_products` → `check_price_history` → `find_coupons`). O modelo gerava texto parcial entre iterações do function-calling loop, resultando em respostas fragmentadas.

**Correção:**
- **Arquivo:** `apps/api/src/services/jarvis-whatsapp.service.ts`
- System prompt: removida instrução "AFTER EVERY PRODUCT SEARCH — MANDATORY" que forçava 3 tool calls
- Nova instrução: "Call search_products ONCE → present results IMMEDIATELY in ONE message"
- Cupons agora integrados diretamente no handler `search_products` (inline lookup, 5s timeout, max 3 stores)
- Tool result inclui campo `coupons[]` junto com `products[]` → Gemini monta UMA resposta consolidada
- `find_coupons` permanece disponível como tool separada para quando o usuário pedir explicitamente

## Bug 3 (P1): Não filtra por marketplace quando usuário especifica loja

**Problema:** Usuário diz "Procure na Amazon" mas recebe resultados de Scents Angel, Jomashop, Google Shopping genérico.

**Causa raiz:** Gemini nem sempre passava o parâmetro `store` ao chamar `search_products`, mesmo quando o usuário mencionava explicitamente uma loja. A sessão anterior adicionou `filterByStore()` mas dependia do Gemini passar o param.

**Correção:**
- **Arquivo:** `apps/api/src/services/jarvis-whatsapp.service.ts`
- **Fallback detection no handler:** `search_products` agora detecta marketplace diretamente da query com regex:
  - "na Amazon" / "on Amazon" → store=amazon
  - "no Mercado Livre" → store=mercadolivre
  - "on eBay" / "at Walmart" / "na Best Buy" etc.
  - Suporta prefixos PT/EN/ES: "na", "no", "on", "from", "at"
- **System prompt:** instrução SHOPPING reescrita com exemplos explícitos:
  - `"Busca perfume na Amazon" → search_products(query="perfume", store="amazon")`
- **`filterByStore()` em unified-search.service.ts:** permanece ativo como segunda camada de filtro

## Arquivos alterados

| Arquivo | Mudança |
|---------|---------|
| `apps/api/src/services/search/unified-search.service.ts` | `cleanProductUrl()` reescrita completa, SerpAPI link priority |
| `apps/api/src/services/jarvis-whatsapp.service.ts` | System prompt (3 seções), marketplace detection fallback, inline coupons |

## Validação esperada

1. `"Busca Armaf Club de Nuit na Amazon"` → Apenas resultados Amazon, links amazon.com/s?k=..., UMA resposta
2. `"Busca perfume Dior Sauvage"` → Resultados de todos os marketplaces, links diretos de cada loja
3. Links clicáveis no WhatsApp/Telegram (sem URLs google.com/search?ibp=...)
4. Cupons incluídos na mesma mensagem dos produtos (não em mensagem separada)

## Build status

- TypeScript: 0 errors
- Build: successful (turbo 26s)
