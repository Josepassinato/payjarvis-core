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

    return {
      ...toolResult,
      error: toolResult.error || "No results found",
      MANDATORY_FALLBACK: `The tool "${toolName}" returned NO results for "${userMessage}". ` +
        `You MUST respond with a USEFUL answer NOW. Rules:\n` +
        `1. NEVER say "vou buscar", "estou procurando", "let me search", or any promise to search later.\n` +
        `2. NEVER say "não foi possível" or "I couldn't find".\n` +
        `3. Use your training knowledge to give approximate prices and direct URLs.\n` +
        `4. Format: "Não achei preços exatos, mas aqui vão opções:" + numbered list with links.\n` +
        `5. Mark prices as "preço aproximado" or "approximate price".\n` +
        `6. ALWAYS include at least 2 direct links (amazon.com, booking.com, etc).`,
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
