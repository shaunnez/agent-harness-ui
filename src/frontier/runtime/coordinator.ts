import type { FrontierGateway, FrontierSnapshot } from "./contracts.ts";
import { refreshPage } from "./pages.ts";

const initialSnapshot: FrontierSnapshot = {
  connection: "connecting",
  error: null,
  status: null,
  projects: [],
  tasks: [],
  selectedId: null,
  selected: null,
  selectedLoading: false,
  selectedError: null,
  updatedAt: null,
};

/** One refresh owner; stale responses can never change the selected task. */
export class RefreshCoordinator {
  private snapshot: FrontierSnapshot = initialSnapshot;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private stopped = true;
  private generation = 0;
  private force = true;
  private globalDue = 0;
  private statusDue = 0;
  private versions = new Map<string, string>();
  private selectedVersion: string | null = null;
  private barriers: { cycle: number; resolve(): void }[] = [];
  private pageBusy = new Set<string>();
  readonly gateway: FrontierGateway;
  readonly metrics = { cycles: 0, summaryReads: 0, selectedReads: 0, failures: 0 };

  constructor(gateway: FrontierGateway) {
    this.gateway = gateway;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private set(patch: Partial<FrontierSnapshot>) {
    if (this.stopped) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  start() {
    this.stopped = false;
    void this.refresh();
  }
  stop() {
    this.stopped = true;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const barrier of this.barriers) barrier.resolve();
    this.barriers = [];
  }
  select(id: string | null) {
    if (id === this.snapshot.selectedId) return;
    this.generation++;
    this.selectedVersion = null;
    this.set({ selectedId: id, selected: null, selectedLoading: Boolean(id), selectedError: null });
    void this.refresh();
  }
  retry() {
    this.force = true;
    void this.refresh();
  }
  synchronize() {
    if (this.stopped) return Promise.resolve();
    const cycle = this.metrics.cycles + 1;
    const completed = new Promise<void>((resolve) => this.barriers.push({ cycle, resolve }));
    this.retry();
    return completed;
  }
  async more(kind: "runs" | "activity" | "artifacts") {
    const selected = this.snapshot.selected;
    if (!selected || this.snapshot.connection !== "connected") return;
    const id = selected.core.id;
    const key = `${id}:${kind}`;
    const cursor = kind === "artifacts" ? selected.core.artifactNextCursor : selected[kind].nextCursor;
    if (!cursor || this.pageBusy.has(key)) return;
    const generation = this.generation;
    const version = selected.core.pollVersion;
    this.pageBusy.add(key);
    try {
      const page = await this.gateway[kind](id, cursor);
      const current = this.snapshot.selected;
      if (generation !== this.generation || current?.core.id !== id || current.core.pollVersion !== version)
        return;
      if (kind === "artifacts") {
        const artifacts = page as Awaited<ReturnType<FrontierGateway["artifacts"]>>;
        this.set({
          selected: {
            ...current,
            core: {
              ...current.core,
              artifacts: mergeItems(current.core.artifacts, artifacts.items),
              artifactNextCursor: artifacts.nextCursor,
            },
          },
        });
      } else if (kind === "runs") {
        const runs = page as Awaited<ReturnType<FrontierGateway["runs"]>>;
        this.set({
          selected: { ...current, runs: { ...runs, items: mergeItems(current.runs.items, runs.items) } },
        });
      } else {
        const activity = page as Awaited<ReturnType<FrontierGateway["activity"]>>;
        this.set({
          selected: {
            ...current,
            activity: { ...activity, items: mergeItems(current.activity.items, activity.items) },
          },
        });
      }
    } catch (error) {
      if (generation === this.generation) this.set({ selectedError: errorMessage(error) });
    } finally {
      this.pageBusy.delete(key);
    }
  }
  async refresh() {
    if (this.stopped) return;
    if (this.busy) {
      this.force = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.busy = true;
    const force = this.force;
    this.force = false;
    const generation = this.generation;
    const selectedId = this.snapshot.selectedId;
    try {
      this.metrics.cycles++;
      const now = Date.now();
      if (force || now >= this.statusDue || this.snapshot.connection !== "connected") {
        const status = await this.gateway.status();
        this.set({ status });
        this.statusDue = now + 30_000;
      }
      if (force || now >= this.globalDue) {
        const [projects, markers] = await Promise.all([this.gateway.projects(), this.gateway.markers()]);
        const changed =
          force ||
          markers.length !== this.versions.size ||
          markers.some((marker) => this.versions.get(marker.id) !== marker.pollVersion);
        if (changed) {
          const tasks = await this.gateway.summaries();
          this.metrics.summaryReads++;
          this.set({ tasks });
          // Use versions from the fetched summaries, not an older marker response.
          this.versions = new Map(tasks.map((task) => [task.id, task.pollVersion ?? task.updatedAt]));
        }
        this.set({
          projects:
            JSON.stringify(projects) === JSON.stringify(this.snapshot.projects)
              ? this.snapshot.projects
              : projects,
          connection: "connected",
          error: null,
          updatedAt: Date.now(),
        });
        this.globalDue = now + 2_000;
      }
      if (selectedId && (force || this.selectedVersion !== this.versions.get(selectedId))) {
        try {
          const [core, runs, activity] = await Promise.all([
            this.gateway.core(selectedId),
            this.gateway.runs(selectedId),
            this.gateway.activity(selectedId),
          ]);
          if (generation === this.generation && selectedId === this.snapshot.selectedId) {
            this.metrics.selectedReads++;
            this.selectedVersion = core.pollVersion ?? core.updatedAt;
            const previous = this.snapshot.selected;
            const same = previous?.core.id === core.id ? previous : null;
            const artifacts = refreshPage(
              same
                ? {
                    items: same.core.artifacts,
                    nextCursor: same.core.artifactNextCursor ?? null,
                    total: same.core.artifactCount ?? same.core.artifacts.length,
                  }
                : undefined,
              {
                items: core.artifacts,
                nextCursor: core.artifactNextCursor ?? null,
                total: core.artifactCount ?? core.artifacts.length,
              },
            );
            this.set({
              selected: {
                core: { ...core, artifacts: artifacts.items, artifactNextCursor: artifacts.nextCursor },
                runs: refreshPage(same?.runs, runs),
                activity: refreshPage(same?.activity, activity),
              },
              selectedLoading: false,
              selectedError: null,
            });
          }
        } catch (error) {
          if (generation === this.generation)
            this.set({ selectedLoading: false, selectedError: errorMessage(error) });
        }
      }
    } catch (error) {
      this.metrics.failures++;
      this.set({ connection: "offline", error: errorMessage(error), selectedLoading: false });
    } finally {
      this.busy = false;
      this.barriers = this.barriers.filter((barrier) => {
        if (barrier.cycle > this.metrics.cycles) return true;
        barrier.resolve();
        return false;
      });
      if (!this.stopped)
        this.timer = setTimeout(() => void this.refresh(), this.force ? 0 : this.hidden() ? 10_000 : 1_000);
    }
  }
  private hidden() {
    return typeof document !== "undefined" && document.hidden;
  }
}

function mergeItems<T extends { id: string }>(first: T[], second: T[]) {
  return [...new Map([...first, ...second].map((item) => [item.id, item])).values()];
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}
