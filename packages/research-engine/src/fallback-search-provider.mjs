import { providerFailure } from "./research-provider-errors.mjs";

export class FallbackSearchProvider {
  constructor({ primary, fallback }) {
    if (!primary?.search || !fallback?.search)
      throw new Error("Fallback search needs primary and fallback providers.");
    Object.assign(this, { primary, fallback });
  }

  async search(query, options = {}) {
    let primary;
    let primaryError = null;
    try {
      primary = await this.primary.search(query, options);
      if (primary.results.length > 0) return primary;
    } catch (error) {
      primaryError = error;
      if (!error?.fallbackEligible) throw error;
    }
    const fallbackReason = primaryError?.category ?? "zero_usable_results";
    try {
      const secondary = await this.fallback.search(query, options);
      return {
        ...secondary,
        metadata: {
          ...secondary.metadata,
          selectedProvider: "serper",
          fallbackReason,
          attempts: [
            ...(primary?.metadata?.attempts ?? (primaryError?.attempt ? [primaryError.attempt] : [])),
            ...(secondary.metadata?.attempts ?? []),
          ],
        },
      };
    } catch (error) {
      const combined = providerFailure({
        provider: "serper",
        operation: "search",
        category: error?.category ?? "permanent",
        status: error?.status,
        attempt: error?.attempt,
      });
      combined.attempts = [
        ...(primary?.metadata?.attempts ?? (primaryError?.attempt ? [primaryError.attempt] : [])),
        ...(error?.attempt ? [error.attempt] : []),
      ];
      throw combined;
    }
  }
}
