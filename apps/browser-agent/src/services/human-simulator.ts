/**
 * Human Behavior Simulator — Anti-bot detection for Amazon
 *
 * Injects realistic human-like behavior into Playwright Page interactions:
 * - Random delays between actions
 * - Natural mouse movement with curves (Bézier)
 * - Human typing with variable speed
 * - Random scrolling and viewport interaction
 * - Idle pauses (reading time)
 */

import type { Page } from "playwright-core";

// ─── Random Helpers ─────────────────────────────────

/** Random integer in [min, max] */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Random float in [min, max] */
function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/** Gaussian-like random (Box-Muller) — more natural than uniform */
function gaussRand(mean: number, stddev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, mean + z * stddev);
}

/** Sleep with slight jitter */
async function sleep(ms: number): Promise<void> {
  const jitter = ms * randFloat(-0.15, 0.15);
  await new Promise((r) => setTimeout(r, Math.max(50, ms + jitter)));
}

// ─── Mouse Movement ─────────────────────────────────

interface Point {
  x: number;
  y: number;
}

/** Generate Bézier curve points for natural mouse movement */
function bezierPath(start: Point, end: Point, steps: number): Point[] {
  // 2 random control points for a natural curve
  const cp1: Point = {
    x: start.x + (end.x - start.x) * randFloat(0.2, 0.4) + randInt(-30, 30),
    y: start.y + (end.y - start.y) * randFloat(0.1, 0.3) + randInt(-30, 30),
  };
  const cp2: Point = {
    x: start.x + (end.x - start.x) * randFloat(0.6, 0.8) + randInt(-20, 20),
    y: start.y + (end.y - start.y) * randFloat(0.7, 0.9) + randInt(-20, 20),
  };

  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x =
      u * u * u * start.x +
      3 * u * u * t * cp1.x +
      3 * u * t * t * cp2.x +
      t * t * t * end.x;
    const y =
      u * u * u * start.y +
      3 * u * u * t * cp1.y +
      3 * u * t * t * cp2.y +
      t * t * t * end.y;
    points.push({ x: Math.round(x), y: Math.round(y) });
  }
  return points;
}

/**
 * Move mouse along a natural Bézier curve to target coordinates.
 */
export async function humanMouseMove(
  page: Page,
  targetX: number,
  targetY: number,
): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  // Assume current mouse is somewhere random if unknown
  const startX = randInt(viewport.width * 0.2, viewport.width * 0.8);
  const startY = randInt(viewport.height * 0.2, viewport.height * 0.5);

  const steps = randInt(15, 35);
  const path = bezierPath(
    { x: startX, y: startY },
    { x: targetX, y: targetY },
    steps,
  );

  for (const point of path) {
    await page.mouse.move(point.x, point.y);
    await new Promise((r) => setTimeout(r, randInt(5, 20)));
  }
}

/**
 * Click an element with human-like behavior:
 * 1. Scroll element into view with random offset
 * 2. Move mouse naturally to element
 * 3. Brief hover pause
 * 4. Click with slight offset from center
 */
export async function humanClick(
  page: Page,
  selector: string,
): Promise<boolean> {
  const el = await page.$(selector);
  if (!el) return false;

  // Scroll into view with random padding
  await el.scrollIntoViewIfNeeded();
  await sleep(randInt(200, 600));

  // Get element bounding box
  const box = await el.boundingBox();
  if (!box) return false;

  // Target slightly off-center (humans don't click exact center)
  const targetX = box.x + box.width * randFloat(0.3, 0.7);
  const targetY = box.y + box.height * randFloat(0.3, 0.7);

  // Move mouse naturally
  await humanMouseMove(page, targetX, targetY);

  // Brief hover (humans pause before clicking)
  await sleep(randInt(100, 350));

  // Click
  await page.mouse.click(targetX, targetY, {
    delay: randInt(40, 120), // Hold duration
  });

  return true;
}

// ─── Typing ─────────────────────────────────────────

/**
 * Type text like a human — variable speed, occasional pauses.
 */
export async function humanType(
  page: Page,
  selector: string,
  text: string,
): Promise<void> {
  const el = await page.$(selector);
  if (!el) return;

  await el.click();
  await sleep(randInt(200, 500));

  for (let i = 0; i < text.length; i++) {
    await page.keyboard.type(text[i], {
      delay: gaussRand(80, 30), // ~80ms avg, 30ms std dev
    });

    // Occasional longer pause (thinking, looking at keyboard)
    if (Math.random() < 0.08) {
      await sleep(randInt(200, 600));
    }
  }
}

// ─── Scrolling ──────────────────────────────────────

/**
 * Scroll down naturally — variable speed, sometimes overshoots.
 */
export async function humanScroll(
  page: Page,
  direction: "down" | "up" = "down",
  amount?: number,
): Promise<void> {
  const scrollAmount = amount ?? randInt(200, 600);
  const steps = randInt(3, 8);
  const perStep = scrollAmount / steps;

  for (let i = 0; i < steps; i++) {
    const delta = perStep * randFloat(0.7, 1.4);
    await page.mouse.wheel(0, direction === "down" ? delta : -delta);
    await new Promise((r) => setTimeout(r, randInt(30, 120)));
  }
}

/**
 * Simulate reading — random scroll + idle time based on content length.
 */
export async function humanReadPage(page: Page): Promise<void> {
  // Small initial pause (eyes scanning)
  await sleep(randInt(500, 1500));

  // Random small scroll to simulate reading
  if (Math.random() > 0.3) {
    await humanScroll(page, "down", randInt(100, 300));
  }

  // Reading time
  await sleep(randInt(800, 2500));
}

// ─── Page Interaction Patterns ──────────────────────

/**
 * Wait with human-like jitter instead of fixed timeout.
 * Replaces page.waitForTimeout() with natural variation.
 */
export async function humanWait(
  minMs: number,
  maxMs: number,
): Promise<void> {
  await sleep(randInt(minMs, maxMs));
}

/**
 * Navigate to URL with human-like pre/post behavior.
 */
export async function humanNavigate(
  page: Page,
  url: string,
  options?: { waitUntil?: "load" | "domcontentloaded"; timeout?: number },
): Promise<void> {
  // Small delay before navigation (human deciding to click)
  await humanWait(200, 800);

  await page.goto(url, {
    waitUntil: options?.waitUntil ?? "domcontentloaded",
    timeout: options?.timeout ?? 30_000,
  });

  // Post-navigation: simulate page scan
  await humanWait(500, 1500);

  // Random light scroll (eyes adjusting)
  if (Math.random() > 0.4) {
    await humanScroll(page, "down", randInt(50, 200));
  }
}

/**
 * Full human setup for a page — call once after CDP connect.
 * Sets viewport, injects stealth overrides, adds random initial behavior.
 */
export async function setupHumanBehavior(page: Page): Promise<void> {
  // Randomize viewport slightly (not exact 1280x800 every time)
  const width = 1280 + randInt(-40, 40);
  const height = 800 + randInt(-30, 30);
  await page.setViewportSize({ width, height });

  // Override navigator.webdriver to false
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => false,
    });

    // Override chrome.runtime (headless detection)
    if (!(window as any).chrome) {
      (window as any).chrome = {};
    }
    if (!(window as any).chrome.runtime) {
      (window as any).chrome.runtime = {};
    }

    // Override permissions query
    const originalQuery = window.navigator.permissions.query.bind(
      window.navigator.permissions,
    );
    (window.navigator.permissions as any).query = (
      parameters: any,
    ): Promise<any> => {
      if (parameters.name === "notifications") {
        return Promise.resolve({
          state: Notification.permission,
        } as PermissionStatus);
      }
      return originalQuery(parameters);
    };

    // Override plugins (headless has empty plugins)
    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
    });

    // Override languages
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });
  });

  // Initial mouse movement to simulate arrival
  await page.mouse.move(
    randInt(300, 900),
    randInt(200, 500),
  );
}

/**
 * Pre-action jitter — call before any important action.
 * Adds small random delay + optional mouse wiggle.
 */
export async function preActionJitter(page: Page): Promise<void> {
  await humanWait(150, 500);

  // 40% chance of small mouse wiggle
  if (Math.random() < 0.4) {
    const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
    const x = randInt(100, viewport.width - 100);
    const y = randInt(100, viewport.height - 100);
    await page.mouse.move(x, y);
    await humanWait(50, 200);
  }
}
