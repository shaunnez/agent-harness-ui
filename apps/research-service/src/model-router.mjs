// One API-loop runtime per provider. Each keeps its own queue and pacer; a question's recorded
// model routes every operation on its run back to the same runtime after Settings changes.

import { resolveApiModel } from "@eversor/research-engine/api-loop/providers.mjs";

export class ModelRouter {
  id = "api-loop";
  #runtimes;
  #runs = new Map();

  constructor(runtimes) {
    this.#runtimes = runtimes;
  }

  async start(request) {
    const provider = resolveApiModel(request.researchPolicy.model).providerId;
    const runtime = this.#runtimes.get(provider);
    if (!runtime) throw new Error(`No research runtime for ${provider}.`);
    this.#runs.set(request.id, runtime);
    try {
      return await runtime.start(request);
    } catch (error) {
      this.#runs.delete(request.id);
      throw error;
    }
  }

  status(id) {
    return this.#run(id).status(id);
  }

  events(id) {
    return this.#run(id).events(id);
  }

  result(id) {
    return this.#run(id).result(id);
  }

  cancel(id) {
    return this.#run(id).cancel(id);
  }

  outcome(id) {
    const runtime = this.#run(id);
    try {
      return runtime.outcome(id);
    } finally {
      this.#runs.delete(id);
    }
  }

  #run(id) {
    const runtime = this.#runs.get(id);
    if (!runtime) throw new Error(`Research run ${id} has no active runtime.`);
    return runtime;
  }
}
