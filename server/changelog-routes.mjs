import { isCanonicalCommitId } from "../src/commit-id.ts";
export function createChangelogRoutes(context) {
  const { suggestedRepository, send, listChangelog, changelogDetail, git, diffCharLimit } = context;
  return async function handle(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/changelog") {
      send(response, 200, { commits: await listChangelog(suggestedRepository, 10) });
      return true;
    }
    const changelogFileMatch = url.pathname.match(/^\/api\/changelog\/([^/]+)\/file$/);
    if (request.method === "GET" && changelogFileMatch) {
      const sha = changelogFileMatch[1];
      if (!isCanonicalCommitId(sha))
        throw new Error("Commit ID must be exactly 40 or 64 hexadecimal characters.");
      const filePath = String(url.searchParams.get("path") ?? "");
      const detail = await changelogDetail(suggestedRepository, sha);
      if (!detail.files.some((file) => file.path === filePath))
        throw new Error("Choose a file changed by this commit.");
      const diff = await git(suggestedRepository, [
        "show",
        "--format=",
        "--no-ext-diff",
        "--unified=3",
        sha,
        "--",
        filePath,
      ]);
      send(response, 200, {
        sha: detail.sha,
        path: filePath,
        diff: diff.slice(0, diffCharLimit),
        truncated: diff.length > diffCharLimit,
      });
      return true;
    }
    const changelogDetailMatch = url.pathname.match(/^\/api\/changelog\/([^/]+)$/);
    if (request.method === "GET" && changelogDetailMatch) {
      const sha = changelogDetailMatch[1];
      if (!isCanonicalCommitId(sha))
        throw new Error("Commit ID must be exactly 40 or 64 hexadecimal characters.");
      send(response, 200, { commit: await changelogDetail(suggestedRepository, sha) });
      return true;
    }

    return false;
  };
}
