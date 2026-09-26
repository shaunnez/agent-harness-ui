// What the research console reads and writes: the research service's own routes in live mode, the
// recorded research questions in fixture mode (`?mode=fixture`). Nothing here reaches the harness
// companion; the harness's API client (`src/api.ts`) is deliberately not imported.

import type { RuntimeProject } from "../../domain";
import type { ResearchEngineSnapshot, ResearchGateway, ResearchQuestion } from "../runtime/research";

/** Set by the build (`vite.research-console.config.mjs`): false in the production image, which
 *  carries no recorded questions, so `?mode=fixture` there is simply the live console. */
declare const __RESEARCH_CONSOLE_FIXTURES__: boolean;
export const FIXTURES_AVAILABLE = __RESEARCH_CONSOLE_FIXTURES__;

/** What the service says about how it researches. */
export interface ConsoleEngine {
  engine: ResearchEngineSnapshot;
  runsPerQuestion: number;
  pacing: { limit: number; min: number; max: number; throttles: number; coolingDownMs: number } | null;
}

export interface ConsoleGateway {
  readonly mode: "fixture" | "live";
  projects(): Promise<RuntimeProject[]>;
  engine(): Promise<ConsoleEngine>;
  readonly research: ResearchGateway;
}

const FIXTURE_ENGINE: ConsoleEngine = {
  engine: {
    runtime: "api-loop",
    model: "fireworks-us/accounts/fireworks/routers/deepseek-v4p1-flash-us",
    reasoning: "default",
  },
  runsPerQuestion: 5,
  pacing: null,
};

export function consoleGateway(mode: "fixture" | "live"): ConsoleGateway {
  // A constant the build decides, so a build without fixtures drops the import and its data.
  if (FIXTURES_AVAILABLE && mode === "fixture") return fixtureGateway();
  return {
    mode: "live",
    projects: liveProjects,
    engine: () => read<ConsoleEngine>("/api/research/console"),
    research: liveResearch,
  };
}

function fixtureGateway(): ConsoleGateway {
  const fixtures = import("../fixtures/research/questions");
  let research: Promise<ResearchGateway> | null = null;
  const recorded = () => {
    research ??= fixtures.then((module) => module.fixtureResearch(() => {}));
    return research;
  };
  return {
    mode: "fixture",
    projects: async () => structuredClone((await fixtures).researchFixtureProjects),
    engine: async () => FIXTURE_ENGINE,
    research: {
      mode: "fixture",
      available: async () => (await recorded()).available(),
      questions: async (projectId) => (await recorded()).questions(projectId),
      question: async (id) => (await recorded()).question(id),
      review: async (id, input) => (await recorded()).review(id, input),
      retry: async (id) => {
        const gateway = await recorded();
        if (!gateway.retry) throw new Error("The sample research has nothing to retry.");
        return gateway.retry(id);
      },
      scope: async (projectId, objective) => (await recorded()).scope(projectId, objective),
      ask: async (projectId, input) => (await recorded()).ask(projectId, input),
    },
  };
}

async function liveProjects(): Promise<RuntimeProject[]> {
  const { projects } = await read<{ projects: (RuntimeProject & { repositoryPath?: string })[] }>(
    "/api/research/projects",
  );
  // The service's projects have no repository; the world keys a base by its path, so give it one.
  return projects.map((project) => ({
    ...project,
    kind: "research",
    repositoryPath: project.repositoryPath ?? `research://${project.id}`,
  }));
}

const liveResearch: ResearchGateway = {
  mode: "live",
  available: async () => {
    try {
      await read("/api/research/runtimes");
      return true;
    } catch {
      return false;
    }
  },
  questions: async (projectId) =>
    (
      await read<{ questions: ResearchQuestion[] }>(
        `/api/research/questions?projectId=${encodeURIComponent(projectId)}`,
      )
    ).questions,
  question: async (id) =>
    (await read<{ question: ResearchQuestion }>(`/api/research/questions/${encodeURIComponent(id)}`))
      .question,
  review: async (id, input) =>
    (
      await write<{ question: ResearchQuestion }>(
        `/api/research/questions/${encodeURIComponent(id)}/review`,
        input,
      )
    ).question,
  retry: async (id) =>
    (
      await write<{ question: ResearchQuestion }>(
        `/api/research/questions/${encodeURIComponent(id)}/retry`,
        {},
      )
    ).question,
  scope: (projectId, objective) => write("/api/research/questions/scope", { projectId, objective }),
  // The engine is not sent: the service runs every question on its configured model.
  ask: async (projectId, input) =>
    (
      await write<{ question: ResearchQuestion }>("/api/research/questions", {
        projectId,
        objective: input.objective,
        runs: input.runs,
        scope: input.scope ?? null,
        scopedBy: input.scopedBy ?? null,
      })
    ).question,
};

async function read<T>(path: string): Promise<T> {
  return parse<T>(await fetch(path, { signal: AbortSignal.timeout(12_000) }));
}

/** JSON only: the service refuses a write that is not, which is what keeps a cross-site form
 *  post from reaching it. */
async function write<T>(path: string, body: unknown): Promise<T> {
  return parse<T>(
    await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function parse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error ?? `The research service answered ${response.status}.`);
  return payload as T;
}
