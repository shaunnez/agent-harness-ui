const CATEGORIES = new Set([
  "configuration",
  "authentication",
  "quota",
  "rate_limit",
  "timeout",
  "transient",
  "invalid_response",
  "permanent",
  "cancelled",
  "deadline_exceeded",
  "budget_exhausted",
  "policy_rejected",
  "unsupported_media_type",
  "source_http_error",
  "source_incomplete",
]);

export class ResearchProviderError extends Error {
  constructor({
    provider,
    operation,
    category,
    message,
    status = null,
    fallbackEligible = false,
    attempt = null,
  }) {
    super(message);
    this.name = "ResearchProviderError";
    this.code = category;
    this.provider = provider;
    this.operation = operation;
    this.category = CATEGORIES.has(category) ? category : "permanent";
    this.status = Number.isInteger(status) ? status : null;
    this.fallbackEligible = Boolean(fallbackEligible);
    this.attempt = attempt;
  }
}

export function providerFailure({
  provider,
  operation,
  category,
  status = null,
  fallbackEligible = false,
  attempt,
}) {
  const messages = {
    configuration: `${provider} ${operation} is not configured.`,
    authentication: `${provider} rejected its credential.`,
    quota: `${provider} has no available quota for ${operation}.`,
    rate_limit: `${provider} rate-limited ${operation}.`,
    timeout: `${provider} ${operation} timed out.`,
    transient: `${provider} ${operation} is temporarily unavailable.`,
    invalid_response: `${provider} returned an invalid ${operation} response.`,
    permanent: `${provider} could not complete ${operation}.`,
    cancelled: `${provider} ${operation} was cancelled.`,
    deadline_exceeded: `The research run deadline expired during ${provider} ${operation}.`,
    budget_exhausted: `The configured ${provider} ${operation} allowance was exhausted.`,
    policy_rejected: `The ${operation} request was rejected by public-source policy.`,
    unsupported_media_type: `${provider} returned an unsupported source type.`,
    source_http_error: `The target source could not be captured.`,
    source_incomplete: `${provider} returned incomplete source content.`,
  };
  return new ResearchProviderError({
    provider,
    operation,
    category,
    status,
    fallbackEligible,
    attempt,
    message: messages[category] ?? messages.permanent,
  });
}

export function classifyProviderStatus(provider, operation, status, attempt) {
  if (status === 401 || status === 403)
    return providerFailure({ provider, operation, category: "authentication", status, attempt });
  if (status === 402)
    return providerFailure({
      provider,
      operation,
      category: "quota",
      status,
      fallbackEligible: true,
      attempt,
    });
  if (status === 429)
    return providerFailure({
      provider,
      operation,
      category: "rate_limit",
      status,
      fallbackEligible: true,
      attempt,
    });
  if (status >= 500)
    return providerFailure({
      provider,
      operation,
      category: "transient",
      status,
      fallbackEligible: true,
      attempt,
    });
  return providerFailure({ provider, operation, category: "permanent", status, attempt });
}

export function isTerminalProviderError(error) {
  return ["cancelled", "deadline_exceeded", "budget_exhausted", "policy_rejected"].includes(error?.category);
}
