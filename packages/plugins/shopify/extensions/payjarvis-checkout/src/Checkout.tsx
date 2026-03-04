/**
 * PayJarvis Shopify Checkout UI Extension
 *
 * Verifica BDIT tokens no checkout do Shopify.
 * Se um bot AI está comprando, valida o token antes
 * de permitir que o checkout prossiga.
 */

import {
  reactExtension,
  useBuyerJourneyIntercept,
  useExtensionApi,
  Banner,
  BlockStack,
  Text,
  InlineStack,
  Icon,
} from "@shopify/ui-extensions-react/checkout";

const PAYJARVIS_API = "https://api.payjarvis.com";

interface VerifyResult {
  valid: boolean;
  reason?: string;
  bot?: {
    bot_id: string;
    trust_score: number;
    merchant_id: string;
  };
}

export default reactExtension(
  "purchase.checkout.block.render",
  () => <PayjarvisCheckout />
);

function PayjarvisCheckout() {
  const { sessionToken, shop } = useExtensionApi();

  useBuyerJourneyIntercept(async ({ canBlockProgress }) => {
    // Extrair BDIT token dos metafields ou note attributes
    const bditToken = await extractBditToken();

    // Sem token = compra humana normal, permitir
    if (!bditToken) {
      return { behavior: "allow" };
    }

    // Verificar token com a API do PayJarvis
    const result = await verifyToken(bditToken, shop.myshopifyDomain);

    if (result.valid) {
      return { behavior: "allow" };
    }

    if (canBlockProgress) {
      return {
        behavior: "block",
        reason: `PayJarvis: ${result.reason ?? "Token inválido"}`,
        errors: [
          {
            message: `Transação bloqueada pelo PayJarvis: ${result.reason}`,
          },
        ],
      };
    }

    return { behavior: "allow" };
  });

  return (
    <BlockStack spacing="tight">
      <InlineStack spacing="extraTight" blockAlignment="center">
        <Icon source="lock" size="small" />
        <Text size="small" appearance="subdued">
          Protegido por PayJarvis
        </Text>
      </InlineStack>
    </BlockStack>
  );
}

async function extractBditToken(): Promise<string | null> {
  // O bot AI envia o token como note attribute no checkout
  // ou via custom attribute no cart
  try {
    const params = new URLSearchParams(window.location?.search ?? "");
    const token = params.get("payjarvis_token");
    if (token) return token;
  } catch {
    // Sandbox pode bloquear window.location
  }
  return null;
}

async function verifyToken(
  token: string,
  shopDomain: string
): Promise<VerifyResult> {
  try {
    const res = await fetch(`${PAYJARVIS_API}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        platform: "shopify",
        merchantDomain: shopDomain,
      }),
    });

    if (!res.ok) {
      return { valid: false, reason: "Falha na verificação" };
    }

    return (await res.json()) as VerifyResult;
  } catch {
    // Se a API estiver fora, permitir a compra (fail-open)
    return { valid: true };
  }
}
