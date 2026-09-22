export function createTaskCreationRoutes({ createTask, send, readJson }) {
  return async function handleTaskCreationRoute(request, response, url) {
    if (request.method !== "POST" || url.pathname !== "/api/tasks") return false;
    const task = await createTask(await readJson(request));
    send(response, 201, { task });
    return true;
  };
}
