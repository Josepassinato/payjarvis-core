/**
 * Turo — Peer-to-peer car rental
 * Layer 4: Full browser automation via Browserbase
 */

import type { Page } from "playwright-core";

export interface TuroCar {
  id: string;
  make: string;
  model: string;
  year: number;
  dailyPrice: number;
  totalPrice?: number;
  rating: number;
  trips: number;
  imageUrl: string;
  hostName: string;
  url: string;
  features: string[];
}

export async function searchCars(
  page: Page,
  city: string,
  startDate: string,
  endDate: string
): Promise<TuroCar[]> {
  const encodedCity = encodeURIComponent(city);
  await page.goto(
    `https://turo.com/us/en/search?country=US&location=${encodedCity}&startDate=${startDate}&endDate=${endDate}`,
    { waitUntil: "domcontentloaded", timeout: 30000 }
  );

  await page.waitForTimeout(4000);

  const results = await page.evaluate(() => {
    const cards = document.querySelectorAll('[data-testid="vehicle-card"], .searchResult-card, .vehicle-card');
    return Array.from(cards).slice(0, 10).map((card) => {
      const title = card.querySelector("h2, .vehicle-title, .vehicle-info-title")?.textContent?.trim() || "";
      const price = card.querySelector(".dailyPrice, .price")?.textContent?.replace(/[^0-9.]/g, "") || "0";
      const rating = card.querySelector(".rating, .star-rating")?.textContent?.trim() || "0";
      const trips = card.querySelector(".trip-count, .trips")?.textContent?.match(/\d+/)?.[0] || "0";
      const img = card.querySelector("img")?.getAttribute("src") || "";
      const link = card.querySelector("a")?.getAttribute("href") || "";

      const parts = title.split(" ");
      const year = parseInt(parts[0]) || 2024;
      const make = parts[1] || "";
      const model = parts.slice(2).join(" ") || "";

      return {
        id: link.split("/").pop() || "",
        make,
        model,
        year,
        dailyPrice: parseFloat(price),
        rating: parseFloat(rating),
        trips: parseInt(trips),
        imageUrl: img,
        hostName: "",
        url: link.startsWith("http") ? link : `https://turo.com${link}`,
        features: [],
      };
    });
  });

  return results;
}

export async function getCarDetails(
  page: Page,
  carId: string
): Promise<TuroCar | null> {
  await page.goto(`https://turo.com/us/en/suv-rental/${carId}`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await page.waitForTimeout(3000);

  const detail = await page.evaluate(() => {
    const title = document.querySelector("h1")?.textContent?.trim() || "";
    const price = document.querySelector(".dailyPrice, .price-value")?.textContent?.replace(/[^0-9.]/g, "") || "0";
    const rating = document.querySelector(".rating-value, .star-rating")?.textContent?.trim() || "0";
    const features = Array.from(document.querySelectorAll(".feature, .vehicle-feature")).map(
      (f) => f.textContent?.trim() || ""
    );

    return { title, price, rating, features };
  });

  if (!detail.title) return null;

  const parts = detail.title.split(" ");
  return {
    id: carId,
    make: parts[1] || "",
    model: parts.slice(2).join(" ") || "",
    year: parseInt(parts[0]) || 2024,
    dailyPrice: parseFloat(detail.price),
    rating: parseFloat(detail.rating),
    trips: 0,
    imageUrl: "",
    hostName: "",
    url: `https://turo.com/us/en/suv-rental/${carId}`,
    features: detail.features,
  };
}

export async function compareRentals(
  page: Page,
  city: string,
  dates: { startDate: string; endDate: string }
): Promise<TuroCar[]> {
  const cars = await searchCars(page, city, dates.startDate, dates.endDate);
  // Sort by best value: lowest price first, then highest rating
  return cars
    .slice()
    .sort((a, b) => a.dailyPrice - b.dailyPrice || b.rating - a.rating)
    .slice(0, 10);
}
