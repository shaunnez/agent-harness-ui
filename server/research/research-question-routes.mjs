// Research question routes. Mounted beside the run routes, behind the same loopback/CSRF
// boundary; the run routes are unchanged.

export function createResearchQuestionRoutes({ questions, send, readJson }) {
  return async function handleResearchQuestionRoute(request, response, url) {
    if (url.pathname === "/api/research/questions") {
      if (request.method === "GET") {
        send(response, 200, { questions: await questions.list(url.searchParams.get("projectId")) });
        return true;
      }
      if (request.method === "POST") {
        const { question, reused } = await questions.ask(await readJson(request));
        // 200 for a repeated request that found its question, 201 for a new one.
        send(response, reused ? 200 : 201, { question, reused });
        return true;
      }
    }

    const match = url.pathname.match(/^\/api\/research\/questions\/([^/]+)(?:\/(review))?$/);
    if (!match) return false;
    const id = decodeURIComponent(match[1]);

    if (request.method === "GET" && !match[2]) {
      const question = await questions.get(id);
      send(
        response,
        question ? 200 : 404,
        question ? { question } : { error: "Research question not found." },
      );
      return true;
    }

    if (request.method === "POST" && match[2] === "review") {
      const question = await questions.review(id, await readJson(request));
      send(
        response,
        question ? 200 : 404,
        question ? { question } : { error: "Research question not found." },
      );
      return true;
    }

    return false;
  };
}
