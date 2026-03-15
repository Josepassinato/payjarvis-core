/**
 * CVS — Pharmacy product search, Rx status, MinuteClinic, deals, store locator
 * Layer 4: Full browser automation via Browserbase
 */

import type { Page } from "playwright-core";

export interface CVSProduct {
  name: string;
  price: string;
  imageUrl: string;
}

export interface CVSStore {
  name: string;
  address: string;
  phone: string;
  hours: string;
  distance: string;
  hasPharmacy: boolean;
  hasMinuteClinic: boolean;
}

export interface RxStatus {
  rxNumber: string;
  status: string;
  readyDate: string;
  store: string;
}

export interface MinuteClinicSlot {
  location: string;
  date: string;
  time: string;
  service: string;
  price: string;
}

export interface CVSDeal {
  name: string;
  salePrice: string;
  originalPrice: string;
  savings: string;
}

export async function searchProducts(
  page: Page,
  query: string,
  zipCode: string
): Promise<CVSProduct[]> {
  await page.goto(
    `https://www.cvs.com/shop/search?searchTerm=${encodeURIComponent(query)}&zipCode=${encodeURIComponent(zipCode)}`,
    { waitUntil: "domcontentloaded", timeout: 30000 }
  );

  await page.waitForTimeout(3000);

  return await page.evaluate(() => {
    const cards = document.querySelectorAll(
      ".product-card, [data-testid='product-card'], .plp-product-card"
    );
    return Array.from(cards).slice(0, 20).map((card) => {
      const name = card.querySelector("h2, h3, .product-name, .product-card__name")?.textContent?.trim() || "";
      const price = card.querySelector(".product-price, .price, [data-testid='product-price']")?.textContent?.trim() || "";
      const img = card.querySelector("img")?.getAttribute("src") || "";
      return { name, price, imageUrl: img };
    });
  });
}

export async function checkRxStatus(
  page: Page,
  rxNumber: string,
  dob: string
): Promise<RxStatus | null> {
  await page.goto("https://www.cvs.com/pharmacy", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await page.waitForTimeout(3000);

  try {
    const rxInput = page.locator("input[name='rxNumber'], #rxNumber, input[placeholder*='prescription']");
    if (await rxInput.count() > 0) {
      await rxInput.first().fill(rxNumber);
    }

    const dobInput = page.locator("input[name='dob'], #dateOfBirth, input[type='date']");
    if (await dobInput.count() > 0) {
      await dobInput.first().fill(dob);
    }

    const submitBtn = page.locator("button[type='submit'], .check-status-btn, #checkStatusBtn");
    if (await submitBtn.count() > 0) {
      await submitBtn.first().click();
      await page.waitForTimeout(5000);
    }

    return await page.evaluate((rxNum) => {
      const status = document.querySelector(".rx-status, [data-testid='rx-status'], .prescription-status")?.textContent?.trim() || "Unknown";
      const readyDate = document.querySelector(".rx-ready-date, [data-testid='rx-ready-date'], .pickup-date")?.textContent?.trim() || "";
      const store = document.querySelector(".rx-store, [data-testid='rx-store'], .pharmacy-store-name")?.textContent?.trim() || "";
      return { rxNumber: rxNum, status, readyDate, store };
    }, rxNumber);
  } catch {
    return null;
  }
}

export async function bookMinuteClinic(
  page: Page,
  service: string,
  zipCode: string,
  date: string
): Promise<MinuteClinicSlot[]> {
  await page.goto(
    `https://www.cvs.com/minuteclinic/scheduling?service=${encodeURIComponent(service)}&zipCode=${encodeURIComponent(zipCode)}`,
    { waitUntil: "domcontentloaded", timeout: 30000 }
  );

  await page.waitForTimeout(3000);

  return await page.evaluate(() => {
    const slots = document.querySelectorAll(
      ".time-slot, [data-testid='time-slot'], .appointment-slot, .available-time"
    );
    return Array.from(slots).slice(0, 15).map((slot) => {
      const location = slot.closest(".clinic-location, .location-card")?.querySelector(".location-name, h3")?.textContent?.trim() || "";
      const time = slot.querySelector(".slot-time, .time")?.textContent?.trim() || slot.textContent?.trim() || "";
      const dateText = slot.querySelector(".slot-date, .date")?.textContent?.trim() || "";
      const price = slot.closest(".clinic-location, .location-card")?.querySelector(".service-price, .cost")?.textContent?.trim() || "";
      return { location, date: dateText, time, service: "", price };
    });
  });
}

export async function getDeals(
  page: Page,
  storeId: string
): Promise<CVSDeal[]> {
  await page.goto(
    `https://www.cvs.com/weeklyad?storeId=${encodeURIComponent(storeId)}`,
    { waitUntil: "domcontentloaded", timeout: 30000 }
  );

  await page.waitForTimeout(3000);

  return await page.evaluate(() => {
    const deals = document.querySelectorAll(
      ".deal-card, [data-testid='deal-card'], .weekly-ad-item, .offer-card"
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
): Promise<CVSStore[]> {
  await page.goto(
    `https://www.cvs.com/store-locator/landing?searchTerm=${encodeURIComponent(zipCode)}`,
    { waitUntil: "domcontentloaded", timeout: 30000 }
  );

  await page.waitForTimeout(3000);

  return await page.evaluate(() => {
    const stores = document.querySelectorAll(
      ".store-card, [data-testid='store-card'], .store-list-item, .store-result"
    );
    return Array.from(stores).slice(0, 15).map((store) => {
      const name = store.querySelector(".store-name, h3, .location-name")?.textContent?.trim() || "CVS Pharmacy";
      const address = store.querySelector(".store-address, .address")?.textContent?.trim() || "";
      const phone = store.querySelector(".store-phone, .phone-number")?.textContent?.trim() || "";
      const hours = store.querySelector(".store-hours, .open-hours")?.textContent?.trim() || "";
      const distance = store.querySelector(".store-distance, .distance")?.textContent?.trim() || "";
      const hasPharmacy = !!store.querySelector(".pharmacy-icon, .has-pharmacy, [data-service='pharmacy']");
      const hasMinuteClinic = !!store.querySelector(".minuteclinic-icon, .has-clinic, [data-service='minuteclinic']");
      return { name, address, phone, hours, distance, hasPharmacy, hasMinuteClinic };
    });
  });
}
