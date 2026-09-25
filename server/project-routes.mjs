import path from "node:path";
import { isResearchRepositoryPath, withProjectKind } from "./project-policy.mjs";

export function createProjectRoutes({
  store,
  suggestedRepository,
  send,
  readJson,
  validateRepository,
  researchAvailable = false,
}) {
  return async function handleProjectRoute(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/projects") {
      send(response, 200, {
        projects: withSuggestedRepository(
          (await store.listProjects()).map(withProjectKind),
          suggestedRepository,
        ),
      });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/projects") {
      const input = await readJson(request);
      const name = String(input.name ?? "").trim();
      if (!name) throw new Error("Project name is required.");
      if (name.length > 120) throw new Error("Project name must be 120 characters or fewer.");
      const kind = input.kind === undefined ? "delivery" : input.kind;
      if (kind !== "delivery" && kind !== "research")
        throw new Error("A project is a delivery project or a research project.");
      if (kind === "research" && !researchAvailable)
        throw Object.assign(new Error("Research projects require the SQLite research runtime."), {
          statusCode: 409,
        });
      // A research project asks costing questions and never touches a repository, so none is
      // chosen or validated; a repository sent with one is a client mistake, not a default.
      if (kind === "research" && input.repositoryPath)
        throw new Error("A research project has no repository; leave the repository out.");
      const project =
        kind === "research"
          ? await store.createProject({ name, kind })
          : await store.createProject({
              name,
              kind,
              repositoryPath: await validateRepository(input.repositoryPath),
            });
      send(response, 201, { project: withProjectKind(project) });
      return true;
    }

    const match = url.pathname.match(/^\/api\/projects\/([^/]+)(?:\/(archive|restore))?$/);
    if (match && ((request.method === "PATCH" && !match[2]) || (request.method === "POST" && match[2]))) {
      const input = await readJson(request);
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new Error("Provide a project change object.");
      const allowed = match[2] ? [] : ["name"];
      if (Object.keys(input).some((key) => !allowed.includes(key)))
        throw new Error("Project repository and identity are immutable; only the display name may change.");
      const project = await store.updateProject(decodeURIComponent(match[1]), {
        kind: match[2] ?? "rename",
        name: input.name,
      });
      send(
        response,
        project ? 200 : 404,
        project ? { project: withProjectKind(project) } : { error: "Registered project not found." },
      );
      return true;
    }

    return false;
  };
}

function withSuggestedRepository(projects, suggestedRepository) {
  const research = projects.filter((project) => isResearchRepositoryPath(project.repositoryPath));
  const byPath = new Map(
    projects
      .filter((project) => !isResearchRepositoryPath(project.repositoryPath))
      .map((project) => [path.resolve(project.repositoryPath), project]),
  );
  if (suggestedRepository && path.isAbsolute(suggestedRepository)) {
    const repositoryPath = path.resolve(suggestedRepository);
    if (!byPath.has(repositoryPath)) {
      byPath.set(repositoryPath, {
        id: `suggested:${repositoryPath}`,
        name: path.basename(repositoryPath),
        repositoryPath,
        kind: "delivery",
        createdAt: null,
      });
    }
  }
  return [...byPath.values(), ...research].sort((left, right) => left.name.localeCompare(right.name));
}
