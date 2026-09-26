export class ResearchToolError extends Error {
  constructor(code, message, { ceiling } = {}) {
    super(message);
    this.name = "ResearchToolError";
    this.code = code;
    this.ceiling = ceiling ?? null;
  }
}
