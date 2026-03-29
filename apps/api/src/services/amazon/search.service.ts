/**
 * Amazon Search Service — Searches Amazon via browser-agent CDP
 *
 * Uses the local Chrome (already on Amazon) to search products
 * and extract ASINs, prices, ratings, and images.
 */

const BROWSER_AGENT_URL = process.env.BROWSER_AGENT_URL ?? "http://localhost:3003";

export interface AmazonProduct {
  asin: string;
  title: string;
  price: string;
  rating?: string;
  reviewCount?: string;
  imageUrl?: string;
  url: string;
  prime?: boolean;
}

export async function searchAmazon(
  query: string,
  domain: string = "amazon.com",
  maxResults: number = 3,
): Promise<AmazonProduct[]> {
  const max = Math.min(maxResults, 5);
  const searchUrl = `https://www.${domain}/s?k=${encodeURIComponent(query)}`;

  try {
    // Use browser-agent's scrape endpoint if available, otherwise use CDP directly
    const res = await fetch(`${BROWSER_AGENT_URL}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: searchUrl,
        extract: "amazon_search",
        maxResults: max,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) {
      const data = (await res.json()) as { success: boolean; products?: AmazonProduct[] };
      if (data.success && data.products?.length) {
        return data.products.slice(0, max);
      }
    }
  } catch {
    // Fallback to CDP
  }

  // Fallback: use CDP directly on local Chrome
  return searchViaCDP(searchUrl, domain, max);
}

async function searchViaCDP(
  searchUrl: string,
  domain: string,
  max: number,
): Promise<AmazonProduct[]> {
  const cdpPort = parseInt(process.env.OPENCLAW_CDP_PORT ?? "18800", 10);

  try {
    // Get available page
    const targetsRes = await fetch(`http://localhost:${cdpPort}/json/list`);
    const targets = (await targetsRes.json()) as Array<{ id: string; type: string; webSocketDebuggerUrl?: string }>;
    const pageTarget = targets.find(t => t.type === "page" && t.webSocketDebuggerUrl);
    if (!pageTarget?.webSocketDebuggerUrl) return [];

    const { default: WS } = await import("ws");

    return new Promise((resolve) => {
      const ws = new WS(pageTarget.webSocketDebuggerUrl!);
      let msgId = 0;
      const timeout = setTimeout(() => { try { ws.close(); } catch {} resolve([]); }, 12_000);

      const sendCmd = (method: string, params: Record<string, unknown> = {}): Promise<any> =>
        new Promise((res, rej) => {
          const id = ++msgId;
          const t = setTimeout(() => rej(new Error("timeout")), 8000);
          const handler = (data: Buffer) => {
            const msg = JSON.parse(data.toString());
            if (msg.id === id) {
              clearTimeout(t);
              ws.off("message", handler);
              res(msg.result);
            }
          };
          ws.on("message", handler);
          ws.send(JSON.stringify({ id, method, params }));
        });

      ws.on("open", async () => {
        try {
          await sendCmd("Page.enable");
          await sendCmd("Page.navigate", { url: searchUrl });

          // Wait for page load
          await new Promise(r => setTimeout(r, 4000));

          const result = await sendCmd("Runtime.evaluate", {
            expression: `(() => {
              const items = document.querySelectorAll('[data-asin]');
              const results = [];
              for (const item of items) {
                const asin = item.getAttribute('data-asin');
                if (!asin || asin.length < 5) continue;
                const titleEl = item.querySelector('h2 span, h2 a span');
                const title = titleEl?.textContent?.trim();
                if (!title) continue;
                const priceEl = item.querySelector('.a-price .a-offscreen');
                const price = priceEl?.textContent?.trim() || '';
                const ratingEl = item.querySelector('.a-icon-alt');
                const rating = ratingEl?.textContent?.split(' ')[0] || '';
                const reviewEl = item.querySelector('.a-size-base.s-underline-text, [aria-label*="stars"] + span');
                const reviewCount = reviewEl?.textContent?.trim()?.replace(/[()]/g, '') || '';
                const imgEl = item.querySelector('img.s-image');
                const imageUrl = imgEl?.getAttribute('src') || '';
                const prime = !!item.querySelector('[aria-label*="Prime"], .a-icon-prime');
                results.push({ asin, title: title.slice(0, 120), price, rating, reviewCount, imageUrl, prime });
                if (results.length >= ${max}) break;
              }
              return JSON.stringify(results);
            })()`,
            returnByValue: true,
          });

          const products = JSON.parse(result?.result?.value ?? "[]") as AmazonProduct[];
          clearTimeout(timeout);
          ws.close();
          resolve(
            products.map(p => ({
              ...p,
              url: `https://www.${domain}/dp/${p.asin}`,
            }))
          );
        } catch {
          clearTimeout(timeout);
          ws.close();
          resolve([]);
        }
      });

      ws.on("error", () => { clearTimeout(timeout); resolve([]); });
    });
  } catch {
    return [];
  }
}
