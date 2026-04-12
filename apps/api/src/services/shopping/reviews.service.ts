/**
 * Reviews Service — AI-summarized product reviews.
 *
 * Sources:
 *   1. Gemini Grounding (Google Search) for review data
 *   2. Gemini summarization of raw reviews
 *
 * Output: concise 3-line summary with rating, pros, cons, recommendation.
 * Cache: 7 days per product (reviews don't change fast).
 */

import { redisGet, redisSet } from "../redis.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

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

// ─── Fetch Reviews via Gemini Grounding (Google Search) ───

interface RawReview { title: string; body: string; rating: number; source: string }
interface RawReviewData { reviews: RawReview[]; overallRating: number | null; totalCount: number | null }

async function fetchReviews(productName: string, store?: string, asin?: string): Promise<RawReviewData | null> {
  if (!GEMINI_API_KEY) return null;

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      tools: [{ googleSearch: {} } as any],
    });

    const searchTerm = asin ? `Amazon ${asin} reviews` : store ? `${productName} ${store} reviews` : `${productName} reviews`;
    const prompt = `Search for "${searchTerm}" and return a JSON object with review data. Format: {"overallRating": 4.5, "totalCount": 1234, "reviews": [{"title":"Review title","body":"Review summary text","rating":5,"source":"amazon"}]}. Max 5 reviews. Only real data from search results. ONLY the JSON, no markdown.`;

    const result = await model.generateContent(prompt);
    let text: string;
    try { text = result.response.text(); } catch { text = result.response.candidates?.[0]?.content?.parts?.[0]?.text || ""; }
    if (!text) return null;

    const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    const reviews: RawReview[] = (parsed.reviews ?? []).slice(0, 5).map((r: any) => ({
      title: r.title || "",
      body: r.body || r.snippet || "",
      rating: typeof r.rating === "number" ? r.rating : 0,
      source: r.source || "google",
    }));

    return {
      reviews,
      overallRating: typeof parsed.overallRating === "number" ? parsed.overallRating : null,
      totalCount: typeof parsed.totalCount === "number" ? parsed.totalCount : null,
    };
  } catch (err) {
    console.error("[REVIEWS] Fetch failed:", (err as Error).message);
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
