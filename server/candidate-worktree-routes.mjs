export function createCandidateWorktreeRoutes(context) {
  const { store, worktrees, send, worktreeEntriesForTask, git, diffCharLimit } = context;
  return async function handle(request, response, url) {
    const taskWorktreesMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/worktrees$/);
    if (request.method === "GET" && taskWorktreesMatch) {
      const taskId = decodeURIComponent(taskWorktreesMatch[1]);
      const task =
        typeof store.getCore === "function" ? await store.getCore(taskId) : await store.get(taskId);
      if (!task) {
        send(response, 404, { error: "Task not found." });
        return true;
      }
      send(response, 200, { rows: await worktrees.inventory(worktreeEntriesForTask(task)) });
      return true;
    }
    const removeWorktreeMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/worktrees\/([^/]+)$/);
    if (request.method === "DELETE" && removeWorktreeMatch) {
      const task = await store.get(decodeURIComponent(removeWorktreeMatch[1]));
      if (!task) {
        send(response, 404, { error: "Task not found." });
        return true;
      }
      const rowId = decodeURIComponent(removeWorktreeMatch[2]);
      const entry = worktreeEntriesForTask(task).find((candidate) => candidate.id === rowId);
      if (!entry) {
        send(response, 404, { error: "Worktree entry not found for this task." });
        return true;
      }
      // Re-derive cleanup readiness now, from the filesystem, rather than trusting a
      // client-held row: the state behind it can change between the list request and
      // this one, and a currently active worktree must never be pulled out from under
      // a running agent.
      const [row] = await worktrees.inventory([entry]);
      if (!row.cleanupReady) {
        throw new Error(
          `This worktree is not ready for cleanup (${row.currentState}); wait for the current run to finish.`,
        );
      }
      await worktrees.removeWorktree({
        worktreePath: entry.worktreePath,
        repositoryRoot: task.repositoryPath,
      });
      send(response, 200, { rows: await worktrees.inventory(worktreeEntriesForTask(task)) });
      return true;
    }
    const candidateDiffMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/candidates\/([^/]+)\/diff$/);
    if (request.method === "GET" && candidateDiffMatch) {
      const taskId = decodeURIComponent(candidateDiffMatch[1]);
      const candidateId = decodeURIComponent(candidateDiffMatch[2]);
      const task = await store.get(taskId);
      if (!task) {
        send(response, 404, { error: "Task not found." });
        return true;
      }
      const candidate = task.candidates?.find((entry) => entry?.id === candidateId);
      if (!candidate) {
        send(response, 404, { error: "Candidate not found." });
        return true;
      }
      const requestedHeadRevision = url.searchParams.get("headRevision")?.trim() || null;
      const requestedRevision = requestedHeadRevision
        ? candidate.revisions?.find((entry) => entry.headRevision === requestedHeadRevision)
        : null;
      if (requestedHeadRevision && !requestedRevision && requestedHeadRevision !== candidate.headRevision) {
        send(response, 409, { error: "Requested candidate revision is no longer recorded for this task." });
        return true;
      }
      const targetHeadRevision = requestedRevision?.headRevision ?? candidate.headRevision;
      const targetRevisionNumber = requestedRevision?.number ?? candidate.revisionNumber;
      if (!targetHeadRevision) {
        send(response, 409, { error: "Requested candidate revision has no recorded head commit." });
        return true;
      }
      await worktrees.verifyCandidate(candidate);
      const diff = await git(candidate.worktreePath, [
        "diff",
        "--no-ext-diff",
        "--unified=3",
        candidate.baseRevision,
        targetHeadRevision,
      ]);
      const cappedDiff = diff.slice(0, diffCharLimit);
      send(response, 200, {
        candidateId: candidate.id,
        revisionNumber: targetRevisionNumber,
        headRevision: targetHeadRevision,
        worktreePath: candidate.worktreePath,
        diff: cappedDiff,
        truncated: diff.length > diffCharLimit,
      });
      return true;
    }

    return false;
  };
}
