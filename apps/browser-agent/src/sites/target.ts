/**
 * Target — Product search, Drive Up availability, weekly ad, store locator
 * Layer 4: Full browser automation via Browserbase
 */

import type { Page } from "playwright-core";

export interface TargetProduct {
  name: string;
  price: string;
  imageUrl: string;
  rating: string;
}

export interface TargetStore {
  name: string;
  address: string;
  phone: string;
  distance: string;
}

export interface DriveUpStatus {
  productName: string;
  tcin: string;
  driveUpAvailable: boolean;
  sameDayDelivery: boolean;
  inStorePickup: boolean;
  price: string;
}

export interface TargetDeal {
  name: string;
  salePrice: string;
  originalPrice: string;
  discount: string;
}

export async function searchProducts(
  page: Page,
  query: string,
  zipCode: string
): Promise<TargetProduct[]> {
  await page.goto(
    `https://www.target.com/s?searchTerm=${encodeURIComponent(query)}`,
    { waitUntil: "domcontentloaded", timeout: 30000 }
  );

  await page.waitForTimeout(3000);

  return await page.evaluate(() => {
    const cards = document.querySelectorAll(
      "[data-test='product-card'], [data-test='@web/ProductCard'], .ProductCard"
    );
    return Array.from(cards).slice(0, 20).map((card) => {
      const name = card.querySelector("[data-test='product-title'], a[data-test='product-title']")?.textContent?.trim() || "";
      const price = card.querySelector("[data-test='current-price'], span[data-test='product-price']")?.textContent?.trim() || "";
      const img = card.querySelector("img")?.getAttribute("src") || "";
      const rating = card.querySelector("[data-test='ratings'], .star-rating")?.textContent?.trim() || "";
      return { name, price, imageUrl: img, rating };
    });
  });
}

export async function checkDriveUp(
  page: Page,
  tcin: string,
  zipCode: string
): Promise<DriveUpStatus | null> {
  await page.goto(`https://www.target.com/p/-/A-${encodeURIComponent(tcin)}`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await page.waitForTimeout(3000);

  try {
    // Set store/zip if needed
    const storeBtn = page.locator("[data-test='storeId-store'], .change-store-btn");
    if (await storeBtn.count() > 0) {
      await storeBtn.first().click();
      await page.waitForTimeout(1000);
      const zipInput = page.locator("input[name='zipCode'], #zip-or-city-state");
      if (await zipInput.count() > 0) {
        await zipInput.first().fill(zipCode);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(3000);
      }
    }

    return await page.evaluate((id) => {
      const productName = document.querySelector("[data-test='product-title'], h1")?.textContent?.trim() || "";
      const price = document.querySelector("[data-test='product-price'], [data-test='current-price']")?.textContent?.trim() || "";

      const fulfillment = document.body.innerText || "";
      const driveUpAvailable = /drive up/i.test(fulfillment) && !/not available/i.test(fulfillment);
      const sameDayDelivery = /same.day delivery/i.test(fulfillment) && !/not available/i.test(fulfillment);
      const inStorePickup = /order pickup|pick ?up/i.test(fulfillment) && !/not available/i.test(fulfillment);

      return { productName, tcin: id, driveUpAvailable, sameDayDelivery, inStorePickup, price };
    }, tcin);
  } catch {
    return null;
  }
}

export async function getWeeklyAd(
  page: Page,
  storeId: string
): Promise<TargetDeal[]> {
  await page.goto("https://www.target.com/c/weekly-ad", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await page.waitForTimeout(3000);

  return await page.evaluate(() => {
    const deals = document.querySelectorAll(
      "[data-test='deal-card'], .DealCard, [data-test='offer-card'], .weekly-ad-item"
    );
    return Array.from(deals).slice(0, 30).map((deal) => {
      const name = deal.querySelector("h2, h3, [data-test='deal-title']")?.textContent?.trim() || "";
      const salePrice = deal.querySelector("[data-test='deal-price'], .sale-price")?.textContent?.trim() || "";
      const originalPrice = deal.querySelector(".original-price, .reg-price")?.textContent?.trim() || "";
      const discount = deal.querySelector("[data-test='deal-discount'], .discount-pct")?.textContent?.trim() || "";
      return { name, salePrice, originalPrice, discount };
    });
  });
}

export async function findStores(
  page: Page,
  zipCode: string
): Promise<TargetStore[]> {
  await page.goto(
    `https://www.target.com/store-locator/find-stores/${encodeURIComponent(zipCode)}`,
    { waitUntil: "domcontentloaded", timeout: 30000 }
  );

  await page.waitForTimeout(3000);

  return await page.evaluate(() => {
    const stores = document.querySelectorAll(
      "[data-test='store-card'], .StoreCard, [data-test='storeResult']"
    );
    return Array.from(stores).slice(0, 15).map((store) => {
      const name = store.querySelector("[data-test='store-name'], h3")?.textContent?.trim() || "Target";
      const address = store.querySelector("[data-test='store-address'], .store-address")?.textContent?.trim() || "";
      const phone = store.querySelector("[data-test='store-phone'], .store-phone")?.textContent?.trim() || "";
      const distance = store.querySelector("[data-test='store-distance'], .store-distance")?.textContent?.trim() || "";
      return { name, address, phone, distance };
    });
  });
}
