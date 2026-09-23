import { useCallback, useEffect, useState } from "react";
import type { RuntimeProject } from "../../domain";
import {
  appearanceSettled,
  appearanceStorageKey,
  assignMissingAppearances,
  type BaseAppearance,
  projectAppearanceKey,
  readAppearances,
  saveAppearance,
} from "./appearance";

const appearanceChangedEvent = "mission-frontier:project-appearance-changed";
interface AppearanceChangedDetail {
  key: string;
  appearance: BaseAppearance;
}

export function chooseProjectAppearance(project: RuntimeProject, appearance: BaseAppearance) {
  const key = projectAppearanceKey(project);
  let stored = true;
  try {
    saveAppearance(localStorage, key, appearance);
  } catch {
    stored = false;
  }
  window.dispatchEvent(
    new CustomEvent<AppearanceChangedDetail>(appearanceChangedEvent, {
      detail: { key, appearance },
    }),
  );
  return stored;
}

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
    // Records saved before colony slots existed are completed in place; their choices stay. A record
    // that breaks the project-kind rule (a delivery base saved as Relay) is corrected and saved.
    const missing = projects.filter(
      (project) => !appearanceSettled(project, saved[projectAppearanceKey(project)]),
    );
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
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<AppearanceChangedDetail>).detail;
      if (!detail?.key || !detail.appearance) return;
      setSaved((current) => ({
        ...current,
        [detail.key]: {
          ...detail.appearance,
          slot: current[detail.key]?.slot ?? detail.appearance.slot,
        },
      }));
    };
    window.addEventListener(appearanceChangedEvent, changed);
    return () => window.removeEventListener(appearanceChangedEvent, changed);
  }, []);
  const choose = useCallback((project: RuntimeProject, appearance: BaseAppearance) => {
    const key = projectAppearanceKey(project);
    setSaved((current) => ({
      ...current,
      [key]: { ...appearance, slot: current[key]?.slot ?? appearance.slot },
    }));
    setStorageProblem(!chooseProjectAppearance(project, appearance));
  }, []);
  return { appearances, choose, storageProblem };
}
