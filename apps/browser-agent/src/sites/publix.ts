/**
 * Publix — Store locator, product search, weekly ad, BOGO deals, recipes
 * Layer 4: Full browser automation via Browserbase
 */

import type { Page } from "playwright-core";

export interface PublixStore {
  name: string;
  address: string;
  phone: string;
  hours: string;
  distance: string;
}

export interface PublixProduct {
  name: string;
  price: string;
  size: string;
  imageUrl: string;
}

export interface PublixDeal {
  name: string;
  salePrice: string;
  originalPrice: string;
  savings: string;
  isBOGO: boolean;
}

export interface PublixRecipe {
  name: string;
  cookTime: string;
  servings: string;
  url: string;
}

export async function findStores(
  page: Page,
  zipCode: string,
  radius: number = 10
): Promise<PublixStore[]> {
  await page.goto(
    `https://www.publix.com/store-locator?zipCode=${encodeURIComponent(zipCode)}&radius=${radius}`,
    { waitUntil: "domcontentloaded", timeout: 30000 }
  );

  await page.waitForTimeout(3000);

  return await page.evaluate(() => {
    const stores = document.querySelectorAll(
      ".store-card, [data-testid='store-card'], .store-result, .store-list-item"
    );
    return Array.from(stores).slice(0, 15).map((store) => {
      const name = store.querySelector(".store-name, h3, h2, .location-name")?.textContent?.trim() || "Publix";
      const address = store.querySelector(".store-address, .address, .location-address")?.textContent?.trim() || "";
      const phone = store.querySelector(".store-phone, .phone")?.textContent?.trim() || "";
      const hours = store.querySelector(".store-hours, .hours")?.textContent?.trim() || "";
      const distance = store.querySelector(".store-distance, .distance")?.textContent?.trim() || "";
      return { name, address, phone, hours, distance };
    });
  });
}

export async function searchProducts(
  page: Page,
  query: string,
  storeId?: string
): Promise<PublixProduct[]> {
  let url = `https://www.publix.com/shop/search?query=${encodeURIComponent(query)}`;
  if (storeId) url += `&storeId=${encodeURIComponent(storeId)}`;

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await page.waitForTimeout(3000);

  return await page.evaluate(() => {
    const cards = document.querySelectorAll(
      ".product-card, [data-testid='product-card'], .product-tile, .search-result-item"
    );
    return Array.from(cards).slice(0, 20).map((card) => {
      const name = card.querySelector(".product-name, .product-title, [data-testid='product-name'], h3")?.textContent?.trim() || "";
      const price = card.querySelector(".product-price, [data-testid='product-price'], .price")?.textContent?.trim() || "";
      const size = card.querySelector(".product-size, .size, .unit-size")?.textContent?.trim() || "";
      const img = card.querySelector("img")?.getAttribute("src") || "";
      return { name, price, size, imageUrl: img };
    });
  });
}

export async function getWeeklyAd(
  page: Page,
  storeId: string
): Promise<PublixDeal[]> {
  await page.goto("https://www.publix.com/savings/weekly-ad", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await page.waitForTimeout(3000);

  return await page.evaluate(() => {
    const deals = document.querySelectorAll(
      ".deal-card, [data-testid='deal-card'], .weekly-ad-item, .savings-item, .ad-item"
    );
    return Array.from(deals).slice(0, 30).map((deal) => {
      const name = deal.querySelector("h2, h3, .deal-title, .item-name")?.textContent?.trim() || "";
      const salePrice = deal.querySelector(".deal-price, .sale-price, .savings-price")?.textContent?.trim() || "";
      const originalPrice = deal.querySelector(".original-price, .reg-price")?.textContent?.trim() || "";
      const savings = deal.querySelector(".savings-amount, .discount, .save-amount")?.textContent?.trim() || "";
      const text = deal.textContent?.toLowerCase() || "";
      const isBOGO = text.includes("bogo") || text.includes("buy one get one") || text.includes("b1g1");
      return { name, salePrice, originalPrice, savings, isBOGO };
    });
  });
}

export async function getBOGODeals(
  page: Page,
  storeId: string
): Promise<PublixDeal[]> {
  const allDeals = await getWeeklyAd(page, storeId);
  return allDeals.filter((deal) => deal.isBOGO);
}

export async function searchRecipes(
  page: Page,
  query: string
): Promise<PublixRecipe[]> {
  await page.goto(
    `https://www.publix.com/recipes/search?query=${encodeURIComponent(query)}`,
    { waitUntil: "domcontentloaded", timeout: 30000 }
  );

  await page.waitForTimeout(3000);

  return await page.evaluate(() => {
    const recipes = document.querySelectorAll(
      ".recipe-card, [data-testid='recipe-card'], .recipe-tile, .recipe-result"
    );
    return Array.from(recipes).slice(0, 20).map((recipe) => {
      const name = recipe.querySelector(".recipe-name, .recipe-title, [data-testid='recipe-title'], h3")?.textContent?.trim() || "";
      const cookTime = recipe.querySelector(".recipe-time, .cook-time, .prep-time")?.textContent?.trim() || "";
      const servings = recipe.querySelector(".recipe-servings, .servings")?.textContent?.trim() || "";
      const link = recipe.querySelector("a")?.getAttribute("href") || "";
      const url = link.startsWith("http") ? link : `https://www.publix.com${link}`;
      return { name, cookTime, servings, url };
    });
  });
}
