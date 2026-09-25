import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../../runtime/coordinator";
import type { ResearchGateway, ResearchQuestion } from "../../runtime/research";

const PENDING_POLL_MS = 5_000;
const LIST_POLL_MS = 15_000;

/** A question whose runs are still going changes on its own, so its window rereads it. */
export function hasPendingRuns(value: ResearchQuestion | ResearchQuestion[] | null) {
  const questions = Array.isArray(value) ? value : value ? [value] : [];
  return questions.some((question) => question.status === "running" || question.status === "queued");
}

/** Loads what a research gateway holds for one project, or one question, and can reload it.
 *  `poll` says how soon to reread (in ms), or null to wait for an explicit reload. */
export function useResearch<T>(
  gateway: ResearchGateway | undefined,
  read: (gateway: ResearchGateway) => Promise<T>,
  key: string,
  poll: (value: T | null) => number | null = () => null,
) {
  const [state, setState] = useState<{ key: string; value: T | null; error: string | null }>({
    key,
    value: null,
    error: null,
  });
  const [version, setVersion] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` names what `read` fetches; `version` forces a reload.
  useEffect(() => {
    if (!gateway) return;
    let disposed = false;
    read(gateway).then(
      (value) => {
        if (!disposed) setState({ key, value, error: null });
      },
      (reason: unknown) => {
        if (!disposed) setState({ key, value: null, error: errorMessage(reason) });
      },
    );
    return () => {
      disposed = true;
    };
  }, [gateway, key, version]);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const current = state.key === key ? state : { key, value: null, error: null };
  // Live only: the sample world's running question is a fixed recording and never advances.
  const delay = gateway?.mode === "live" ? poll(current.value) : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: each fresh value re-arms the next reread.
  useEffect(() => {
    if (delay == null) return;
    const timer = window.setTimeout(reload, delay);
    return () => window.clearTimeout(timer);
  }, [delay, reload, current.value]);
  return { value: current.value, error: current.error, loading: !current.value && !current.error, reload };
}

export function useProjectQuestions(gateway: ResearchGateway | undefined, projectId: string) {
  return useResearch<ResearchQuestion[]>(
    gateway,
    (research) => research.questions(projectId),
    projectId,
    // A question can arrive from outside this window (another tab, Linear, an API call), so the
    // list rereads even when nothing in it is running.
    (value) => (hasPendingRuns(value) ? PENDING_POLL_MS : LIST_POLL_MS),
  );
}

/** One question rereads only while its runs are going; a finished one changes only on review. */
export function pendingPoll(value: ResearchQuestion | null) {
  return hasPendingRuns(value) ? PENDING_POLL_MS : null;
}
