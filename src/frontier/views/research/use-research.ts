import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../../runtime/coordinator";
import type { ResearchGateway, ResearchQuestion } from "../../runtime/research";

/** Loads what a research gateway holds for one project, or one question, and can reload it. */
export function useResearch<T>(
  gateway: ResearchGateway | undefined,
  read: (gateway: ResearchGateway) => Promise<T>,
  key: string,
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
  return { value: current.value, error: current.error, loading: !current.value && !current.error, reload };
}

export function useProjectQuestions(gateway: ResearchGateway | undefined, projectId: string) {
  return useResearch<ResearchQuestion[]>(gateway, (research) => research.questions(projectId), projectId);
}
