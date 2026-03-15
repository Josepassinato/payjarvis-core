/**
 * Amtrak — Train search and status
 * Layer 4: Full browser automation via Browserbase
 */

import type { Page } from "playwright-core";

const STATION_ALIASES: Record<string, string> = {
  miami: "MIA", "new york": "NYP", nyc: "NYP", washington: "WAS",
  dc: "WAS", chicago: "CHI", "los angeles": "LAX", orlando: "ORL",
  philadelphia: "PHL", boston: "BOS", "san francisco": "SFC",
  seattle: "SEA", denver: "DEN", atlanta: "ATL", tampa: "TPA",
  jacksonville: "JAX", savannah: "SAV", "new orleans": "NOL",
  raleigh: "RGH", richmond: "RVR", baltimore: "BAL",
};

export interface AmtrakTripResult {
  trainNumber: string;
  trainName: string;
  departTime: string;
  arriveTime: string;
  duration: string;
  price: string;
  available: boolean;
}

export function resolveStation(query: string): string {
  const lower = query.toLowerCase().trim();
  return STATION_ALIASES[lower] || query.toUpperCase().slice(0, 3);
}

export async function searchTrips(
  page: Page,
  origin: string,
  destination: string,
  date: string
): Promise<AmtrakTripResult[]> {
  const from = resolveStation(origin);
  const to = resolveStation(destination);

  await page.goto("https://www.amtrak.com/home.html", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await page.waitForTimeout(3000);

  // Try to fill the search form
  try {
    const fromInput = page.locator("#from-station, input[name='from'], #wps_from");
    if (await fromInput.count() > 0) {
      await fromInput.first().fill(from);
      await page.waitForTimeout(1000);
      await page.keyboard.press("Enter");
    }

    const toInput = page.locator("#to-station, input[name='to'], #wps_to");
    if (await toInput.count() > 0) {
      await toInput.first().fill(to);
      await page.waitForTimeout(1000);
      await page.keyboard.press("Enter");
    }

    // Date input
    const dateInput = page.locator("#date-input, input[name='date'], #wps_date");
    if (await dateInput.count() > 0) {
      await dateInput.first().fill(date);
    }

    // Submit
    const searchBtn = page.locator("button[type='submit'], .search-btn, #fare-finder-button");
    if (await searchBtn.count() > 0) {
      await searchBtn.first().click();
      await page.waitForTimeout(5000);
    }
  } catch {
    // Form interaction failed
  }

  const results = await page.evaluate(() => {
    const rows = document.querySelectorAll(".search-result, .trip-result, [data-testid='trip-card']");
    return Array.from(rows).slice(0, 5).map((row) => {
      const train = row.querySelector(".train-number, .route-name")?.textContent?.trim() || "";
      const depart = row.querySelector(".depart-time, .departure")?.textContent?.trim() || "";
      const arrive = row.querySelector(".arrive-time, .arrival")?.textContent?.trim() || "";
      const duration = row.querySelector(".duration, .travel-time")?.textContent?.trim() || "";
      const price = row.querySelector(".price, .fare")?.textContent?.trim() || "";

      return {
        trainNumber: train.match(/\d+/)?.[0] || "",
        trainName: train,
        departTime: depart,
        arriveTime: arrive,
        duration,
        price,
        available: true,
      };
    });
  });

  return results;
}

export async function getTrainStatus(
  page: Page,
  trainNumber: string
): Promise<{ status: string; delay: string; location: string } | null> {
  await page.goto(`https://www.amtrak.com/track-your-train.html`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  await page.waitForTimeout(3000);

  try {
    const input = page.locator("input[name='trainNumber'], #train-number");
    if (await input.count() > 0) {
      await input.first().fill(trainNumber);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(5000);
    }

    return await page.evaluate(() => {
      const status = document.querySelector(".train-status, .status")?.textContent?.trim() || "Unknown";
      const delay = document.querySelector(".delay, .delay-info")?.textContent?.trim() || "On time";
      const location = document.querySelector(".location, .current-location")?.textContent?.trim() || "";
      return { status, delay, location };
    });
  } catch {
    return null;
  }
}
