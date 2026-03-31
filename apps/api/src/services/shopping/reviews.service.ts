/**
 * Reviews Service — AI-summarized product reviews.
 *
 * Sources:
 *   1. SerpAPI product reviews (Google Shopping / Amazon reviews)
 *   2. Gemini summarization of raw reviews
 *
 * Output: concise 3-line summary with rating, pros, cons, recommendation.
 * Cache: 7 days per product (reviews don't change fast).
 */

import { redisGet, redisSet } from "../redis.js";

const SERPAPI_KEY = process.env.SERPAPI_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const REVIEW_CACHE_TTL = 604800; // 7 days

export interface ReviewSummary {
  rating: number | null;
  reviewCount: number | null;
  pros: string[];
  cons: string[];
  recommendPct: number | null;
  summary: string;
  summaryPt: string;
  source: string;
}

/**
 * Get AI-summarized reviews for a product.
 */
export async function getProductReviews(
  productName: string,
  store?: string,
  asin?: string
): Promise<ReviewSummary | null> {
  const cacheKey = `reviews:${normalizeKey(asin || productName)}`;
  const cached = await redisGet(cacheKey);
  if (cached) {
    console.log(`[REVIEWS] Cache hit for ${productName}`);
    return JSON.parse(cached);
  }

  // 1. Fetch raw reviews
  const rawReviews = await fetchReviews(productName, store, asin);
  if (!rawReviews || rawReviews.reviews.length === 0) {
    console.log(`[REVIEWS] No reviews found for ${productName}`);
    return null;
  }

  // 2. Summarize with Gemini
  const summary = await summarizeReviews(rawReviews, productName);
  if (!summary) return null;

  // 3. Cache
  await redisSet(cacheKey, JSON.stringify(summary), REVIEW_CACHE_TTL);
  console.log(`[REVIEWS] Summarized ${rawReviews.reviews.length} reviews for ${productName}`);
  return summary;
}

// ─── Fetch Reviews via SerpAPI ───

interface RawReview { title: string; body: string; rating: number; source: string }
interface RawReviewData { reviews: RawReview[]; overallRating: number | null; totalCount: number | null }

async function fetchReviews(productName: string, store?: string, asin?: string): Promise<RawReviewData | null> {
  if (!SERPAPI_KEY) return null;

  try {
    // Strategy 1: Amazon product reviews via SerpAPI (if ASIN)
    if (asin) {
      const reviews = await fetchAmazonReviews(asin);
      if (reviews && reviews.reviews.length > 0) return reviews;
    }

    // Strategy 2: Google Shopping product reviews
    const query = store ? `${productName} ${store} reviews` : `${productName} reviews`;
    const res = await fetch(
      `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&api_key=${SERPAPI_KEY}&num=5`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return null;
    const data = await res.json() as any;

    // Extract reviews from organic results
    const reviews: RawReview[] = [];
    let overallRating: number | null = null;
    let totalCount: number | null = null;

    // Check for rich snippets with ratings
    if (data.knowledge_graph?.rating) {
      overallRating = parseFloat(data.knowledge_graph.rating);
      totalCount = parseInt(data.knowledge_graph.reviews || "0", 10) || null;
    }

    // Extract review-like content from snippets
    for (const r of (data.organic_results ?? []).slice(0, 5)) {
      const snippet = r.snippet || "";
      if (snippet.length > 30) {
        // Try to extract rating from snippet
        const ratingMatch = snippet.match(/(\d(?:\.\d)?)\s*(?:out of|\/)\s*5/i);
        const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;
        reviews.push({
          title: r.title || "",
          body: snippet,
          rating,
          source: "google",
        });
      }
    }

    return { reviews, overallRating, totalCount };
  } catch (err) {
    console.error("[REVIEWS] Fetch failed:", (err as Error).message);
    return null;
  }
}

async function fetchAmazonReviews(asin: string): Promise<RawReviewData | null> {
  try {
    const res = await fetch(
      `https://serpapi.com/search.json?engine=google&q=amazon+${asin}+reviews&api_key=${SERPAPI_KEY}&num=10`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return null;
    const data = await res.json() as any;

    const reviews: RawReview[] = [];
    let overallRating: number | null = null;
    let totalCount: number | null = null;

    for (const r of (data.organic_results ?? []).slice(0, 10)) {
      const snippet = r.snippet || "";
      const ratingMatch = snippet.match(/(\d(?:\.\d)?)\s*(?:out of|\/)\s*5/i);
      const countMatch = snippet.match(/([\d,]+)\s*(?:ratings?|reviews?)/i);

      if (ratingMatch && !overallRating) overallRating = parseFloat(ratingMatch[1]);
      if (countMatch && !totalCount) totalCount = parseInt(countMatch[1].replace(/,/g, ""), 10);

      if (snippet.length > 30) {
        reviews.push({
          title: r.title || "",
          body: snippet,
          rating: ratingMatch ? parseFloat(ratingMatch[1]) : 0,
          source: "amazon",
        });
      }
    }

    return { reviews, overallRating, totalCount };
  } catch {
    return null;
  }
}

// ─── Gemini Summarization ───

async function summarizeReviews(data: RawReviewData, productName: string): Promise<ReviewSummary | null> {
  if (!GEMINI_API_KEY) return buildFallbackSummary(data, productName);

  const reviewTexts = data.reviews.map((r, i) =>
    `Review ${i + 1} (${r.rating}/5): ${r.body.substring(0, 200)}`
  ).join("\n");

  const prompt = `Summarize these product reviews for "${productName}" in a structured format.

Reviews:
${reviewTexts}

Respond in this exact JSON format (no markdown, just JSON):
{
  "pros": ["pro1", "pro2", "pro3"],
  "cons": ["con1", "con2", "con3"],
  "recommendPct": 85,
  "summaryEn": "One sentence overall verdict in English",
  "summaryPt": "One sentence overall verdict in Portuguese"
}

Rules:
- Max 3 pros, max 3 cons. Each under 10 words.
- recommendPct = estimated % of reviewers who recommend. Null if unsure.
- Be concise and direct. No fluff.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 300 },
        }),
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const geminiData = await res.json() as any;
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return buildFallbackSummary(data, productName);

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      rating: data.overallRating,
      reviewCount: data.totalCount,
      pros: (parsed.pros ?? []).slice(0, 3),
      cons: (parsed.cons ?? []).slice(0, 3),
      recommendPct: parsed.recommendPct ?? null,
      summary: parsed.summaryEn || "Reviews are mixed.",
      summaryPt: parsed.summaryPt || "Reviews são mistos.",
      source: data.reviews[0]?.source || "google",
    };
  } catch (err) {
    console.error("[REVIEWS] Gemini summarization failed:", (err as Error).message);
    return buildFallbackSummary(data, productName);
  }
}

function buildFallbackSummary(data: RawReviewData, _productName: string): ReviewSummary {
  return {
    rating: data.overallRating,
    reviewCount: data.totalCount,
    pros: [],
    cons: [],
    recommendPct: null,
    summary: data.overallRating
      ? `Rated ${data.overallRating}/5 based on ${data.totalCount || "several"} reviews.`
      : "Reviews available but could not be summarized.",
    summaryPt: data.overallRating
      ? `Nota ${data.overallRating}/5 baseado em ${data.totalCount || "várias"} avaliações.`
      : "Avaliações disponíveis mas não foi possível resumir.",
    source: data.reviews[0]?.source || "google",
  };
}

function normalizeKey(input: string): string {
  return input.toLowerCase().trim().replace(/\s+/g, "_").substring(0, 100);
}
