/**
 * Watchdog — Tool Result Validator
 *
 * Validates tool results BEFORE sending them back to Gemini.
 * If a tool returned empty/null/error, injects a strong fallback directive
 * that prevents Gemini from responding with "I'm searching..." promises.
 *
 * This is Camada 2 — runs inline in the Gemini tool calling loop.
 */

// Tools whose empty results should trigger immediate fallback
const SEARCH_TOOLS_SET = new Set([
  "search_products", "amazon_search", "search_restaurants", "search_hotels",
  "search_flights", "search_events", "web_search", "browse", "compare_prices",
  "find_stores", "search_transit", "search_rental_cars", "find_home_service",
  "find_mechanic", "search_products_latam", "search_products_global",
  "grocery_search",
]);

/**
 * Check if a tool result is empty/useless.
 */
function isEmptyResult(result: Record<string, unknown>): boolean {
  if (!result) return true;
  if (result.error) return true;

  // Check for empty arrays in common result fields
  for (const key of ["results", "items", "products", "hotels", "flights", "restaurants", "events", "data"]) {
    if (Array.isArray(result[key]) && result[key].length === 0) return true;
  }

  // Check if the only field is an empty array
  const values = Object.values(result);
  if (values.length === 1 && Array.isArray(values[0]) && values[0].length === 0) return true;

  // Null/undefined main payload
  if (result.data === null || result.data === undefined) {
    // Only flag if there's no other useful content
    const hasContent = Object.keys(result).some(
      (k) => k !== "data" && k !== "error" && result[k] !== null && result[k] !== undefined
    );
    if (!hasContent) return true;
  }

  return false;
}

/**
 * Validate a tool result and inject fallback directive if needed.
 *
 * Returns the (possibly modified) tool result. The fallback directive
 * forces Gemini to give an immediate useful answer instead of promising
 * to "keep searching".
 */
export function validateToolResult(
  toolName: string,
  toolResult: Record<string, unknown>,
  userMessage: string
): Record<string, unknown> {
  // Only validate search-type tools
  if (!SEARCH_TOOLS_SET.has(toolName)) return toolResult;

  if (isEmptyResult(toolResult)) {
    console.log(`[WATCHDOG-VALIDATOR] Empty result from ${toolName} for: "${userMessage.substring(0, 60)}"`);

    // Flag the result as empty — the code-level anti-hallucination guard in the
    // tool-calling loop will intercept this and return a hardcoded message.
    // NEVER instruct Gemini to "use training knowledge" — that causes hallucination.
    return {
      ...toolResult,
      error: toolResult.error || "No results found",
      searchFailed: true,
      WATCHDOG_EMPTY_RESULT: true,
    };
  }

  return toolResult;
}

/**
 * Check if a tool result was flagged as empty by the validator.
 */
export function wasEmptyResult(toolResult: Record<string, unknown>): boolean {
  return toolResult.WATCHDOG_EMPTY_RESULT === true;
}
