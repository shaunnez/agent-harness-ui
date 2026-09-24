import path from "node:path";

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
        projects: withSuggestedRepository(await store.listProjects(), suggestedRepository),
      });
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/projects") {
      const input = await readJson(request);
      const name = String(input.name ?? "").trim();
      if (!name) throw new Error("Project name is required.");
      if (name.length > 120) throw new Error("Project name must be 120 characters or fewer.");
      const kind = input.kind ?? "delivery";
      if (kind !== "delivery" && kind !== "research")
        throw new Error("Project type must be delivery or research.");
      if (kind === "research" && !researchAvailable)
        throw Object.assign(new Error("Research projects require the SQLite research runtime."), {
          statusCode: 409,
        });
      const repositoryPath = kind === "research" ? "" : await validateRepository(input.repositoryPath);
      const project = await store.createProject({ name, repositoryPath, kind });
      send(response, 201, { project });
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
      send(response, project ? 200 : 404, project ? { project } : { error: "Registered project not found." });
      return true;
    }

    return false;
  };
}

function withSuggestedRepository(projects, suggestedRepository) {
  const byPath = new Map(
    projects
      .filter((project) => project.kind !== "research")
      .map((project) => [path.resolve(project.repositoryPath), project]),
  );
  if (suggestedRepository && path.isAbsolute(suggestedRepository)) {
    const repositoryPath = path.resolve(suggestedRepository);
    if (!byPath.has(repositoryPath)) {
      byPath.set(repositoryPath, {
        id: `suggested:${repositoryPath}`,
        name: path.basename(repositoryPath),
        repositoryPath,
        createdAt: null,
      });
    }
  }
  return [...projects.filter((project) => project.kind === "research"), ...byPath.values()].sort(
    (left, right) => left.name.localeCompare(right.name),
  );
}
