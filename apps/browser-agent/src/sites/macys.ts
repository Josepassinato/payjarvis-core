/**
 * Macy's — Product search, sale section, store inventory, store locator
 * Layer 4: Full browser automation via Browserbase
 */

import type { Page } from "playwright-core";

export interface MacysProduct {
  name: string;
  brand: string;
  price: string;
  salePrice: string;
  imageUrl: string;
  rating: string;
}

export interface MacysStore {
  name: string;
  address: string;
  phone: string;
  hours: string;
  distance: string;
}

export interface StoreInventoryResult {
  productName: string;
  productId: string;
  inStoreAvailable: boolean;
  price: string;
  fulfillmentOptions: string[];
}

export async function searchProducts(
  page: Page,
  query: string,
  filters?: { brand?: string; priceRange?: string; size?: string; color?: string }
): Promise<MacysProduct[]> {
  await page.goto(
    `https://www.macys.com/shop/featured/${encodeURIComponent(query)}`,
    { waitUntil: "domcontentloaded", timeout: 30000 }
  );

  await page.waitForTimeout(3000);

  return await page.evaluate(() => {
    const cards = document.querySelectorAll(
      ".productCard, [data-testid='product-card'], .cell.productCard, .product-thumbnail"
    );
    return Array.from(cards).slice(0, 20).map((card) => {
      const name = card.querySelector(".productDescription, .product-name, a.productDescLink")?.textContent?.trim() || "";
      const brand = card.querySelector(".productBrand, .brand-name")?.textContent?.trim() || "";
      const price = card.querySelector(".regular-price, .prices")?.textContent?.trim() || "";
      const salePrice = card.querySelector(".sale-price, .discount-price")?.textContent?.trim() || "";
      const img = card.querySelector("img")?.getAttribute("src") || "";
      const rating = card.querySelector(".rating, .star-rating")?.textContent?.trim() || "";
      return { name, brand, price, salePrice, imageUrl: img, rating };
    });
  });
}

export async function getSaleSection(
  page: Page,
  category?: string
): Promise<MacysProduct[]> {
  let url = "https://www.macys.com/shop/sale";
  if (category) url += `/${encodeURIComponent(category)}`;

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await page.waitForTimeout(3000);

  return await page.evaluate(() => {
    const cards = document.querySelectorAll(
      ".productCard, [data-testid='product-card'], .cell.productCard"
    );
    return Array.from(cards).slice(0, 30).map((card) => {
      const name = card.querySelector(".productDescription, .product-name, a.productDescLink")?.textContent?.trim() || "";
      const brand = card.querySelector(".productBrand, .brand-name")?.textContent?.trim() || "";
      const price = card.querySelector(".regular-price, .original-price")?.textContent?.trim() || "";
      const salePrice = card.querySelector(".sale-price, .discount-price")?.textContent?.trim() || "";
      const img = card.querySelector("img")?.getAttribute("src") || "";
      const rating = card.querySelector(".rating, .star-rating")?.textContent?.trim() || "";
      return { name, brand, price, salePrice, imageUrl: img, rating };
    });
  });
}

export async function checkStoreInventory(
  page: Page,
  productId: string,
  storeId: string
): Promise<StoreInventoryResult | null> {
  await page.goto(
    `https://www.macys.com/shop/product/${encodeURIComponent(productId)}`,
    { waitUntil: "domcontentloaded", timeout: 30000 }
  );

  await page.waitForTimeout(3000);

  try {
    // Try to set store
    const storeBtn = page.locator(".change-store, .store-selector, [data-testid='store-select']");
    if (await storeBtn.count() > 0) {
      await storeBtn.first().click();
      await page.waitForTimeout(2000);
    }

    return await page.evaluate((pId) => {
      const productName = document.querySelector("[data-testid='product-title'], h1.product-name, .product-title")?.textContent?.trim() || "";
      const price = document.querySelector("[data-testid='product-price'], .regular-price, .sale-price")?.textContent?.trim() || "";

      const availEl = document.querySelector("[data-testid='store-availability'], .store-availability, .bops-avail, .pick-up-in-store");
      const inStoreAvailable = availEl ? !/not available|out of stock/i.test(availEl.textContent || "") : false;

      const fulfillmentEls = document.querySelectorAll(".fulfillment-option, [data-testid='fulfillment'], .shipping-option");
      const fulfillmentOptions = Array.from(fulfillmentEls).map((el) => el.textContent?.trim() || "").filter(Boolean);

      return { productName, productId: pId, inStoreAvailable, price, fulfillmentOptions };
    }, productId);
  } catch {
    return null;
  }
}

export async function findStores(
  page: Page,
  zipCode: string
): Promise<MacysStore[]> {
  await page.goto(
    `https://www.macys.com/stores/search?query=${encodeURIComponent(zipCode)}`,
    { waitUntil: "domcontentloaded", timeout: 30000 }
  );

  await page.waitForTimeout(3000);

  return await page.evaluate(() => {
    const stores = document.querySelectorAll(
      ".store-card, [data-testid='store-card'], .store-result, .store-list-item"
    );
    return Array.from(stores).slice(0, 15).map((store) => {
      const name = store.querySelector(".store-name, h3, h2, .location-name")?.textContent?.trim() || "Macy's";
      const address = store.querySelector(".store-address, .address")?.textContent?.trim() || "";
      const phone = store.querySelector(".store-phone, .phone")?.textContent?.trim() || "";
      const hours = store.querySelector(".store-hours, .hours")?.textContent?.trim() || "";
      const distance = store.querySelector(".store-distance, .distance")?.textContent?.trim() || "";
      return { name, address, phone, hours, distance };
    });
  });
}
