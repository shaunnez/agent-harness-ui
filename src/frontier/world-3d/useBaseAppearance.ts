import { useCallback, useEffect, useState } from "react";
import type { RuntimeProject } from "../../domain";
import {
  appearanceComplete,
  appearanceStorageKey,
  assignMissingAppearances,
  type BaseAppearance,
  projectAppearanceKey,
  readAppearances,
  saveAppearance,
} from "./appearance";

export function useBaseAppearance(projects: RuntimeProject[]) {
  const [saved, setSaved] = useState(() => {
    try {
      return readAppearances(localStorage);
    } catch {
      return {};
    }
  });
  const [storageProblem, setStorageProblem] = useState(false);
  const appearances = assignMissingAppearances(projects, saved);
  useEffect(() => {
    // Records saved before colony slots existed are completed in place; their choices stay.
    const missing = projects.filter((project) => !appearanceComplete(saved[projectAppearanceKey(project)]));
    if (!missing.length) return;
    const next = assignMissingAppearances(projects, saved);
    try {
      for (const project of missing) {
        const key = projectAppearanceKey(project);
        const appearance = next[key];
        if (appearance) saveAppearance(localStorage, key, appearance);
      }
    } catch {
      setStorageProblem(true);
    }
    setSaved(next);
  }, [projects, saved]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === appearanceStorageKey) setSaved(readAppearances(localStorage));
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  const choose = useCallback((project: RuntimeProject, appearance: BaseAppearance) => {
    const key = projectAppearanceKey(project);
    setSaved((current) => ({ ...current, [key]: appearance }));
    try {
      saveAppearance(localStorage, key, appearance);
      setStorageProblem(false);
    } catch {
      setStorageProblem(true);
    }
  }, []);
  return { appearances, choose, storageProblem };
}
