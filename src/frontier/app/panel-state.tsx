import { createContext, type ReactNode, useContext, useRef, useState } from "react";

const PanelMemory = createContext<Map<string, unknown> | null>(null);

/** Session-only navigation state scoped to the overlay host, never persisted to disk. */
export function PanelMemoryProvider({ children }: { children: ReactNode }) {
  const memory = useRef(new Map<string, unknown>());
  return <PanelMemory.Provider value={memory.current}>{children}</PanelMemory.Provider>;
}
export function usePanelState<T>(key: string, initial: T) {
  const memory = useContext(PanelMemory);
  const [value, setValue] = useState<T>(() => (memory?.has(key) ? (memory.get(key) as T) : initial));
  function update(next: T) {
    memory?.set(key, next);
    setValue(next);
  }
  return [value, update] as const;
}
