/**
 * Amazon Domain Routing — Maps user country to correct Amazon domain.
 *
 * The domain is determined by the registered address of the bot owner,
 * NOT by the conversation language.
 */

const AMAZON_DOMAINS: Record<string, string> = {
  US: "amazon.com",
  BR: "amazon.com.br",
  MX: "amazon.com.mx",
  CA: "amazon.ca",
  GB: "amazon.co.uk",
  DE: "amazon.de",
  FR: "amazon.fr",
  ES: "amazon.es",
  IT: "amazon.it",
  JP: "amazon.co.jp",
  AU: "amazon.com.au",
  IN: "amazon.in",
  NL: "amazon.nl",
  SE: "amazon.se",
  PL: "amazon.pl",
  BE: "amazon.com.be",
  SG: "amazon.sg",
  AE: "amazon.ae",
  SA: "amazon.sa",
  PT: "amazon.es",       // Portugal uses Amazon Spain
  CO: "amazon.com",      // Colombia fallback to US
  AR: "amazon.com",      // Argentina fallback to US
  CL: "amazon.com",      // Chile fallback to US
};

const DEFAULT_DOMAIN = "amazon.com";

/** Returns the Amazon domain for a given ISO 3166-1 alpha-2 country code */
export function getAmazonDomain(countryCode?: string | null): string {
  if (!countryCode) return DEFAULT_DOMAIN;
  return AMAZON_DOMAINS[countryCode.toUpperCase()] ?? DEFAULT_DOMAIN;
}

/** Returns the full base URL for an Amazon domain */
export function getAmazonBaseUrl(countryCode?: string | null): string {
  return `https://www.${getAmazonDomain(countryCode)}`;
}
