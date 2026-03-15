/**
 * Angi / Thumbtack — Home service professional search
 * Layer 4: Full browser automation via Browserbase
 */

import type { Page } from "playwright-core";

export interface HomeServicePro {
  name: string;
  service: string;
  rating: number;
  reviewCount: number;
  priceRange: string;
  phone?: string;
  url: string;
  verified: boolean;
}

export async function searchProfessionals(
  page: Page,
  service: string,
  zipCode: string
): Promise<HomeServicePro[]> {
  const slug = service.toLowerCase().replace(/\s+/g, "-");
  await page.goto(`https://www.angi.com/companylist/${slug}.htm?postalCode=${zipCode}`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await page.waitForTimeout(3000);

  const results = await page.evaluate(() => {
    const cards = document.querySelectorAll('[data-testid="provider-card"], .provider-card, .search-result');
    return Array.from(cards).slice(0, 10).map((card) => {
      const name = card.querySelector("h2, h3, .provider-name")?.textContent?.trim() || "";
      const rating = parseFloat(card.querySelector(".rating, [data-testid='rating']")?.textContent || "0");
      const reviews = card.querySelector(".review-count, .reviews")?.textContent?.match(/\d+/)?.[0] || "0";
      const price = card.querySelector(".price, .price-range")?.textContent?.trim() || "Contact for quote";
      const link = card.querySelector("a")?.getAttribute("href") || "";
      const verified = !!card.querySelector(".verified, .badge-verified");

      return {
        name,
        rating,
        reviewCount: parseInt(reviews),
        priceRange: price,
        url: link.startsWith("http") ? link : `https://www.angi.com${link}`,
        verified,
      };
    });
  });

  return results.map((r) => ({ ...r, service }));
}

export async function getQuotes(
  page: Page,
  service: string,
  zipCode: string,
  details: string
): Promise<{ message: string; url: string }> {
  const slug = service.toLowerCase().replace(/\s+/g, "-");
  const url = `https://www.angi.com/companylist/${slug}.htm?postalCode=${zipCode}`;
  return {
    message: `To get quotes for ${service}, visit Angi and request estimates from top-rated professionals.`,
    url,
  };
}
