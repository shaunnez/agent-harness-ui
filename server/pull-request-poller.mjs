export function startPullRequestPolling(orchestrator, options = {}) {
  const intervalMs = options.intervalMs ?? 30_000;
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  const reportError =
    options.reportError ??
    ((error) => {
      console.error(JSON.stringify({ event: "github_pr_poll_failed", error: error.message }));
    });
  let stopped = false;
  let timer = null;

  const schedulePoll = (delayMs) => {
    timer = schedule(poll, delayMs);
    timer?.unref?.();
  };

  const poll = async () => {
    try {
      await orchestrator.pollPullRequests();
    } catch (error) {
      reportError(error);
    } finally {
      if (!stopped) schedulePoll(intervalMs);
    }
  };

  schedulePoll(0);
  return () => {
    stopped = true;
    if (timer != null) cancel(timer);
  };
}
