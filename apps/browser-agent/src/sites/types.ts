/**
 * Interfaces compartilhadas entre site extractors.
 */

export type EvaluateFn = (expression: string) => Promise<unknown>;

export interface ExtractedData {
  amount: number | null;
  currency: string;
  items: string[];
  merchantName: string;
  category?: string;
}

export interface SiteExtractor {
  readonly site: string;
  readonly category: string;
  extract(evaluate: EvaluateFn): Promise<ExtractedData>;
}
