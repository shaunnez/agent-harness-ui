import path from "node:path";

export function createProjectRoutes({ store, suggestedRepository, send, readJson, validateRepository }) {
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
      const repositoryPath = await validateRepository(input.repositoryPath);
      const project = await store.createProject({ name, repositoryPath });
      send(response, 201, { project });
      return true;
    }

    return false;
  };
}

function withSuggestedRepository(projects, suggestedRepository) {
  const byPath = new Map(projects.map((project) => [path.resolve(project.repositoryPath), project]));
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
  return [...byPath.values()].sort((left, right) => left.name.localeCompare(right.name));
}
