/**
 * Amazon Checkout Service — Real purchases via authenticated CDP session
 */

import { prisma } from "@payjarvis/database";
import { getSession, invalidateSession } from "../vault/vault.service.js";
import { getAmazonBaseUrl } from "./domains.js";

const BROWSER_AGENT_URL =
  process.env.BROWSER_AGENT_URL ?? "http://localhost:3003";

export type CheckoutStatus =
  | "READY_TO_CONFIRM"
  | "NO_SESSION"
  | "SESSION_EXPIRED"
  | "CAPTCHA_REQUIRED"
  | "OUT_OF_STOCK"
  | "PRICE_CHANGED"
  | "CHECKOUT_FAILED";

export interface CheckoutResult {
  status: CheckoutStatus;
  orderId?: string;
  summary?: {
    title: string;
    price: number;
    address?: string;
    paymentMethod?: string;
    estimatedDelivery?: string;
  };
  newPrice?: number;
  message?: string;
  handoffUrl?: string;
}

export interface OrderResult {
  status: "PLACED" | "FAILED";
  amazonOrderId?: string;
  estimatedDelivery?: string;
  errorMsg?: string;
}

interface StartCheckoutParams {
  userId: string;
  botId: string;
  asin: string;
  title: string;
  price: number;
  quantity?: number;
}

/**
 * Send a CDP command to the browser-agent and execute a JS expression
 */
async function cdpEval(expression: string, cookies?: object, userAgent?: string): Promise<any> {
  const res = await fetch(`${BROWSER_AGENT_URL}/cdp-eval`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expression, cookies, userAgent }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json();
  return data;
}

/**
 * Navigate to a URL with injected cookies
 */
async function navigateWithSession(
  url: string,
  cookies: object,
  userAgent: string
): Promise<{
  success: boolean;
  content?: string;
  obstacle?: { type: string; description: string };
  error?: string;
}> {
  const res = await fetch(`${BROWSER_AGENT_URL}/navigate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, injectCookies: cookies, userAgent }),
    signal: AbortSignal.timeout(45_000),
  });
  return (await res.json()) as any;
}

/**
 * Start checkout flow — adds item to cart and proceeds to checkout
 * Does NOT place the order — waits for confirmation
 */
export async function startCheckout(
  params: StartCheckoutParams
): Promise<CheckoutResult> {
  const { userId, botId, asin, title, price, quantity = 1 } = params;

  // 1. Get session from vault
  const session = await getSession(userId, "amazon");
  if (!session) {
    return {
      status: "NO_SESSION",
      message: "Connect your Amazon account first.",
    };
  }

  if (!session.isValid) {
    return {
      status: "SESSION_EXPIRED",
      message: "Your Amazon session has expired. Please reconnect.",
    };
  }

  // Determine Amazon domain from bot owner's country
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    include: { owner: { select: { country: true } } },
  });
  const amazonBase = getAmazonBaseUrl(bot?.owner?.country);

  // 2. Create order record
  const order = await prisma.amazonOrder.create({
    data: {
      botId,
      userId,
      asin,
      title,
      price,
      quantity,
      status: "CHECKOUT_STARTED",
    },
  });

  try {
    // 3. Navigate to product page with session cookies
    const productUrl = `${amazonBase}/dp/${asin}`;
    const navResult = await navigateWithSession(
      productUrl,
      session.cookies,
      session.userAgent
    );

    if (!navResult.success) {
      await updateOrderStatus(order.id, "FAILED", navResult.error);
      return {
        status: "CHECKOUT_FAILED",
        orderId: order.id,
        message: navResult.error ?? "Failed to load product page",
      };
    }

    // Handle obstacles
    if (navResult.obstacle) {
      if (navResult.obstacle.type === "CAPTCHA") {
        return {
          status: "CAPTCHA_REQUIRED",
          orderId: order.id,
          message: "Amazon is requesting verification.",
        };
      }
      if (navResult.obstacle.type === "AUTH") {
        await invalidateSession(userId, "amazon");
        await updateOrderStatus(order.id, "FAILED", "Session expired");
        return {
          status: "SESSION_EXPIRED",
          orderId: order.id,
          message: "Your Amazon session has expired. Please reconnect.",
        };
      }
    }

    // 4. Check availability and current price
    const content = navResult.content ?? "";
    if (
      content.includes("Currently unavailable") ||
      content.includes("out of stock")
    ) {
      await updateOrderStatus(order.id, "FAILED", "Out of stock");
      return {
        status: "OUT_OF_STOCK",
        orderId: order.id,
        message: `"${title}" is currently out of stock.`,
      };
    }

    // 5. Extract current price from page
    const currentPrice = extractPrice(content);
    if (currentPrice && Math.abs(currentPrice - price) > 0.5) {
      return {
        status: "PRICE_CHANGED",
        orderId: order.id,
        newPrice: currentPrice,
        message: `Price changed from $${price.toFixed(2)} to $${currentPrice.toFixed(2)}.`,
      };
    }

    // 6. Add to cart via browser-agent
    const addToCartResult = await navigateWithSession(
      `${amazonBase}/gp/aws/cart/add.html?ASIN.1=${asin}&Quantity.1=${quantity}`,
      session.cookies,
      session.userAgent
    );

    if (!addToCartResult.success) {
      await updateOrderStatus(order.id, "FAILED", "Failed to add to cart");
      return {
        status: "CHECKOUT_FAILED",
        orderId: order.id,
        message: "Failed to add item to cart.",
      };
    }

    // 7. Proceed to checkout
    const checkoutResult = await navigateWithSession(
      `${amazonBase}/gp/buy/spc/handlers/display.html?hasWorkingJavascript=1`,
      session.cookies,
      session.userAgent
    );

    if (!checkoutResult.success) {
      await updateOrderStatus(order.id, "FAILED", "Failed to reach checkout");
      return {
        status: "CHECKOUT_FAILED",
        orderId: order.id,
        message: "Failed to proceed to checkout.",
      };
    }

    // Handle auth redirect at checkout
    if (checkoutResult.obstacle?.type === "AUTH") {
      await invalidateSession(userId, "amazon");
      await updateOrderStatus(order.id, "FAILED", "Session expired at checkout");
      return {
        status: "SESSION_EXPIRED",
        orderId: order.id,
        message: "Session expired during checkout. Please reconnect.",
      };
    }

    // 8. Extract checkout summary
    const checkoutContent = checkoutResult.content ?? "";
    const summary = extractCheckoutSummary(checkoutContent, title, price);

    return {
      status: "READY_TO_CONFIRM",
      orderId: order.id,
      summary,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Checkout failed";
    await updateOrderStatus(order.id, "FAILED", errorMsg);
    return {
      status: "CHECKOUT_FAILED",
      orderId: order.id,
      message: errorMsg,
    };
  }
}

/**
 * Confirm and place the order (after PayJarvis approval)
 */
export async function confirmOrder(
  orderId: string,
  userId: string
): Promise<OrderResult> {
  const order = await prisma.amazonOrder.findFirst({
    where: { id: orderId, userId },
  });

  if (!order || order.status !== "CHECKOUT_STARTED") {
    return { status: "FAILED", errorMsg: "Order not found or invalid status" };
  }

  // Determine Amazon domain from bot owner's country
  const bot = await prisma.bot.findUnique({
    where: { id: order.botId },
    include: { owner: { select: { country: true } } },
  });
  const amazonBase = getAmazonBaseUrl(bot?.owner?.country);

  const session = await getSession(userId, "amazon");
  if (!session || !session.isValid) {
    await updateOrderStatus(orderId, "FAILED", "Session expired");
    return { status: "FAILED", errorMsg: "Amazon session expired" };
  }

  try {
    // Click "Place your order" via CDP
    const placeOrderResult = await navigateWithSession(
      `${amazonBase}/gp/buy/spc/handlers/static-submit-decoupled.html/ref=ox_spc_place_order`,
      session.cookies,
      session.userAgent
    );

    if (!placeOrderResult.success) {
      await updateOrderStatus(orderId, "FAILED", "Failed to place order");
      return { status: "FAILED", errorMsg: "Failed to place order" };
    }

    const content = placeOrderResult.content ?? "";

    // Extract order confirmation
    const orderIdMatch = content.match(
      /(?:order|pedido)\s*(?:#|number|número)?\s*[:.]?\s*(\d{3}-\d{7}-\d{7})/i
    );
    const deliveryMatch = content.match(
      /(?:delivery|entrega|arriving)\s*(?:by|:)?\s*([A-Za-z]+\s+\d{1,2}(?:,?\s+\d{4})?)/i
    );

    const amazonOrderId = orderIdMatch?.[1] ?? null;
    const estimatedDelivery = deliveryMatch?.[1] ?? null;

    if (
      amazonOrderId ||
      content.includes("Thank you") ||
      content.includes("order has been placed")
    ) {
      await prisma.amazonOrder.update({
        where: { id: orderId },
        data: {
          status: "PLACED",
          amazonOrderId,
          updatedAt: new Date(),
        },
      });

      return {
        status: "PLACED",
        amazonOrderId: amazonOrderId ?? undefined,
        estimatedDelivery: estimatedDelivery ?? undefined,
      };
    }

    // Order might have failed
    await updateOrderStatus(orderId, "FAILED", "Order confirmation not detected");
    return {
      status: "FAILED",
      errorMsg: "Could not confirm order was placed. Check your Amazon account.",
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Order placement failed";
    await updateOrderStatus(orderId, "FAILED", errorMsg);
    return { status: "FAILED", errorMsg };
  }
}

/**
 * Get order status
 */
export async function getOrderStatus(orderId: string) {
  return prisma.amazonOrder.findUnique({ where: { id: orderId } });
}

// ── Helpers ────────────────────────────────────────────

async function updateOrderStatus(
  orderId: string,
  status: string,
  errorMsg?: string | null
) {
  await prisma.amazonOrder.update({
    where: { id: orderId },
    data: { status, errorMsg, updatedAt: new Date() },
  });
}

function extractPrice(content: string): number | null {
  // Match common Amazon price patterns
  const match = content.match(/\$(\d+(?:\.\d{2})?)/);
  return match ? parseFloat(match[1]) : null;
}

function extractCheckoutSummary(
  content: string,
  fallbackTitle: string,
  fallbackPrice: number
) {
  // Extract delivery address
  const addressMatch = content.match(
    /(?:Delivering to|Ship to|Entregar em)[:\s]+([^\n]+)/i
  );
  // Extract payment method
  const paymentMatch = content.match(
    /(?:Payment method|Método de pagamento|ending in)[:\s]+([^\n]+)/i
  );
  // Extract estimated delivery
  const deliveryMatch = content.match(
    /(?:Estimated delivery|Entrega estimada|Arriving)[:\s]+([^\n]+)/i
  );

  return {
    title: fallbackTitle,
    price: fallbackPrice,
    address: addressMatch?.[1]?.trim(),
    paymentMethod: paymentMatch?.[1]?.trim(),
    estimatedDelivery: deliveryMatch?.[1]?.trim(),
  };
}
