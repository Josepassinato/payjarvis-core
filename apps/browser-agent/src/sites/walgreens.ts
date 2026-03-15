/**
 * Walgreens — Pharmacy product search, Rx status, immunization, weekly ad, store locator
 * Layer 4: Full browser automation via Browserbase
 */

import type { Page } from "playwright-core";

export interface WalgreensProduct {
  name: string;
  price: string;
  imageUrl: string;
}

export interface WalgreensStore {
  name: string;
  address: string;
  phone: string;
  hours: string;
  distance: string;
}

export interface WalgreensRxStatus {
  rxNumber: string;
  status: string;
  readyDate: string;
  store: string;
}

export interface ImmunizationSlot {
  location: string;
  date: string;
  time: string;
  vaccine: string;
}

export interface WalgreensDeal {
  name: string;
  salePrice: string;
  originalPrice: string;
  savings: string;
}

export async function searchProducts(
  page: Page,
  query: string,
  zipCode: string
): Promise<WalgreensProduct[]> {
  await page.goto(
    `https://www.walgreens.com/search/results.jsp?Ntt=${encodeURIComponent(query)}`,
    { waitUntil: "domcontentloaded", timeout: 30000 }
  );

  await page.waitForTimeout(3000);

  return await page.evaluate(() => {
    const cards = document.querySelectorAll(
      ".product-card, [data-testid='product-card'], .card__product, .wag-product-card"
    );
    return Array.from(cards).slice(0, 20).map((card) => {
      const name = card.querySelector("h2, h3, .product-card__name, .card__product-title")?.textContent?.trim() || "";
      const price = card.querySelector(".product-price, .price, [data-testid='product-price']")?.textContent?.trim() || "";
      const img = card.querySelector("img")?.getAttribute("src") || "";
      return { name, price, imageUrl: img };
    });
  });
}

export async function checkRxStatus(
  page: Page,
  rxNumber: string,
  lastName: string
): Promise<WalgreensRxStatus | null> {
  await page.goto("https://www.walgreens.com/pharmacy", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await page.waitForTimeout(3000);

  try {
    const rxInput = page.locator("input[name='rxNumber'], #rxNumber, input[placeholder*='prescription']");
    if (await rxInput.count() > 0) {
      await rxInput.first().fill(rxNumber);
    }

    const lastNameInput = page.locator("input[name='lastName'], #lastName, input[placeholder*='last name']");
    if (await lastNameInput.count() > 0) {
      await lastNameInput.first().fill(lastName);
    }

    const submitBtn = page.locator("button[type='submit'], .check-status-btn, #checkRxStatusBtn");
    if (await submitBtn.count() > 0) {
      await submitBtn.first().click();
      await page.waitForTimeout(5000);
    }

    return await page.evaluate((rxNum) => {
      const status = document.querySelector(".rx-status, [data-testid='rx-status'], .rxStatusText")?.textContent?.trim() || "Unknown";
      const readyDate = document.querySelector(".rx-ready, [data-testid='rx-ready-date'], .pickup-ready-date")?.textContent?.trim() || "";
      const store = document.querySelector(".rx-store-name, [data-testid='rx-store'], .pharmacy-location")?.textContent?.trim() || "";
      return { rxNumber: rxNum, status, readyDate, store };
    }, rxNumber);
  } catch {
    return null;
  }
}

export async function bookImmunization(
  page: Page,
  vaccine: string,
  zipCode: string,
  date: string
): Promise<ImmunizationSlot[]> {
  await page.goto(
    "https://www.walgreens.com/findcare/vaccination/covid-19/appointment/screening",
    { waitUntil: "domcontentloaded", timeout: 30000 }
  );

  await page.waitForTimeout(3000);

  try {
    const zipInput = page.locator("input[name='zipCode'], #zipCode, input[placeholder*='ZIP']");
    if (await zipInput.count() > 0) {
      await zipInput.first().fill(zipCode);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(3000);
    }
  } catch {
    // ZIP entry failed
  }

  return await page.evaluate(() => {
    const slots = document.querySelectorAll(
      ".time-slot, [data-testid='time-slot'], .appointment-slot, .timeslot-btn"
    );
    return Array.from(slots).slice(0, 15).map((slot) => {
      const location = slot.closest(".location-card, .store-card")?.querySelector(".store-name, h3")?.textContent?.trim() || "";
      const time = slot.textContent?.trim() || "";
      return { location, date: "", time, vaccine: "" };
    });
  });
}

export async function getWeeklyAd(
  page: Page,
  storeId: string
): Promise<WalgreensDeal[]> {
  await page.goto("https://www.walgreens.com/offers/weekly-ad", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await page.waitForTimeout(3000);

  return await page.evaluate(() => {
    const deals = document.querySelectorAll(
      ".deal-card, [data-testid='deal-card'], .weekly-ad-item, .offer-card, .wag-offer"
    );
    return Array.from(deals).slice(0, 30).map((deal) => {
      const name = deal.querySelector("h2, h3, .deal-title, .offer-title")?.textContent?.trim() || "";
      const salePrice = deal.querySelector(".deal-price, .sale-price")?.textContent?.trim() || "";
      const originalPrice = deal.querySelector(".original-price, .reg-price")?.textContent?.trim() || "";
      const savings = deal.querySelector(".savings, .discount")?.textContent?.trim() || "";
      return { name, salePrice, originalPrice, savings };
    });
  });
}

export async function findStores(
  page: Page,
  zipCode: string
): Promise<WalgreensStore[]> {
  await page.goto(
    `https://www.walgreens.com/storelocator/find.jsp?NumResults=10&zip=${encodeURIComponent(zipCode)}`,
    { waitUntil: "domcontentloaded", timeout: 30000 }
  );

  await page.waitForTimeout(3000);

  return await page.evaluate(() => {
    const stores = document.querySelectorAll(
      ".store-card, [data-testid='store-result'], .store-list-item, .wag-store-card"
    );
    return Array.from(stores).slice(0, 15).map((store) => {
      const name = store.querySelector(".store-name, h3, .storeAddr")?.textContent?.trim() || "Walgreens";
      const address = store.querySelector(".store-address, .address")?.textContent?.trim() || "";
      const phone = store.querySelector(".store-phone, .phone-number")?.textContent?.trim() || "";
      const hours = store.querySelector(".store-hours, .open-hours")?.textContent?.trim() || "";
      const distance = store.querySelector(".store-distance, .distance")?.textContent?.trim() || "";
      return { name, address, phone, hours, distance };
    });
  });
}
