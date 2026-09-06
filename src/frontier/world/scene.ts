import { Container, type Sprite, type TilingSprite } from "pixi.js";
import type { RuntimeProject } from "../../domain";
import type { WorldLocation } from "../app/navigation";
import type { TaskSummary } from "../runtime/contracts";
import { attentionFor, isOpen, needsYou, stageLabels } from "../runtime/presentation";
import type { WorldAssets } from "./assets";
import { createWorker, type WorkerMotion } from "./workers";
import { featuredProjectId } from "./asset-policy";
import { ProjectPlacement, TransitionTracker, taskSite, tasksInProject } from "./layout";
import { islandAnchor, islandScale, projectRoutes } from "./routes";

export interface WorldLabel {
  id: string;
  kind: "project" | "task";
  x: number;
  y: number;
  title: string;
  detail: string;
  reason?: string | null;
  attention: string;
  projectId: string;
  taskId?: string;
}
export interface SceneInput {
  mode: "fixture" | "live";
  placementNamespace?: string;
  projects: RuntimeProject[];
  tasks: TaskSummary[];
  location: WorldLocation;
  selectedId: string | null;
  connected: boolean;
  motion: boolean;
  watchedRunActive: boolean;
  cameraSensitivity?: number;
}
interface SceneEntity {
  container: Container;
  signature: string;
  labels: WorldLabel[];
  motions: WorkerMotion[];
  foliage: Sprite[];
}
export class FrontierScene {
  readonly root = new Container();
  readonly placement: ProjectPlacement;
  labels: WorldLabel[] = [];
  motions: WorkerMotion[] = [];
  private foliage: Sprite[] = [];
  backdropBounds: { x: number; y: number; width: number; height: number } | null = null;
  private entities = new Map<string, SceneEntity>();
  private used = new Set<string>();
  private target = this.root;
  private order = 0;
  private transitions = new TransitionTracker();
  private handoffs: { container: Container; started: number }[] = [];
  private advanced = new Set<string>();
  private motionEnabled = false;
  private featuredProject: string | undefined;
  private water: TilingSprite | null = null;
  private flights: Array<{
    sprite: Sprite;
    x: number;
    y: number;
    started: number;
    distance: number;
    departing: boolean;
  }> = [];
  readonly metrics = { reconciliations: 0, rebuiltEntities: 0, handoffs: 0 };
  private bounds = { x: 0, y: 0, width: 1500, height: 850 };
  constructor(
    private assets: WorldAssets,
    private pick: (kind: "project" | "task" | "artifact", id: string, artifactId?: string) => void,
    placementNamespace: string,
  ) {
    this.root.sortableChildren = true;
    this.placement = new ProjectPlacement(undefined, placementNamespace);
  }
  get worldBounds() {
    return this.bounds;
  }
  reconcile(input: SceneInput) {
    this.metrics.reconciliations++;
    this.used.clear();
    this.order = 0;
    this.motionEnabled = input.motion && input.connected;
    this.featuredProject =
      this.assets.direction === "cinematic" ? featuredProjectId(input.projects) : undefined;
    const transitions = this.transitions.reconcile(input.tasks, input.connected);
    this.advanced = new Set(this.motionEnabled ? transitions : []);
    if (!this.motionEnabled) {
      for (const flight of this.flights)
        if (!flight.sprite.destroyed) {
          flight.sprite.position.set(flight.x, flight.y);
          flight.sprite.alpha = flight.departing ? 0 : 1;
        }
      this.flights = [];
    }
    this.labels = [];
    this.motions = [];
    this.foliage = [];
    this.backdropBounds = null;
    const placed = this.placement.locate(input.projects);
    const project =
      placed.find((entry) => entry.id === input.location.projectId) ??
      placed.find((entry) =>
        tasksInProject(input.tasks, entry).some((task) => task.id === input.location.taskId),
      );
    if (input.location.view === "world" || !project) this.overview(input, placed);
    else if (input.location.view === "project") this.headquarters(input, project);
    else this.detail(input, project);
    for (const [key, entity] of this.entities) {
      if (!this.used.has(key)) {
        entity.container.destroy({ children: true });
        this.entities.delete(key);
      }
    }
  }
  private entity(key: string, data: unknown, build: () => void, taskId?: string) {
    this.used.add(key);
    const signature = JSON.stringify(data);
    const prior = this.entities.get(key);
    if (prior?.signature === signature) {
      prior.container.zIndex = this.order++;
      this.labels.push(...prior.labels);
      this.motions.push(...prior.motions);
      this.foliage.push(...prior.foliage);
      return;
    }
    prior?.container.destroy({ children: true });
    const container = new Container();
    container.zIndex = this.order++;
    this.root.addChild(container);
    this.target = container;
    const labelStart = this.labels.length,
      motionStart = this.motions.length,
      foliageStart = this.foliage.length;
    build();
    this.target = this.root;
    this.entities.set(key, {
      container,
      signature,
      labels: this.labels.slice(labelStart),
      motions: this.motions.slice(motionStart),
      foliage: this.foliage.slice(foliageStart),
    });
    this.metrics.rebuiltEntities++;
    if (taskId && this.advanced.has(taskId)) {
      this.metrics.handoffs++;
      this.handoffs.push({ container, started: performance.now() });
    }
  }
  private art(id: string, x = 0, y = 0, scale = 1, container = this.target) {
    if (id === "mf.cinematic.tree") {
      const shadow = this.assets.sprite("mf.cinematic.tree.shadow", x, y, scale);
      if (shadow) container.addChild(shadow);
    }
    const sprite = this.assets.sprite(id, x, y, scale);
    if (sprite) container.addChild(sprite);
    if (sprite && id === "mf.cinematic.tree") this.foliage.push(sprite);
    return sprite;
  }
  private selectable(sprite: Sprite | null, kind: "project" | "task", id: string) {
    if (!sprite) return;
    sprite.eventMode = "static";
    sprite.cursor = "pointer";
    sprite.on("pointertap", () => this.pick(kind, id));
  }
  private handoff(task: TaskSummary, x: number, y: number, scale: number) {
    const artifact = task.artifacts?.at(-1);
    if (!artifact) return;
    this.selectable(this.art("mf.prop.cargo", x - 30 * scale, y, 0.65 * scale), "task", task.id);
    const capsule = this.art("mf.artifact.capsule", x + 30 * scale, y, 0.65 * scale);
    if (capsule) {
      capsule.eventMode = "static";
      capsule.cursor = "pointer";
      capsule.on("pointertap", () => this.pick("artifact", task.id, artifact.id));
    }
  }
  private compound(x: number, y: number, scale: number, roof: boolean, id: string) {
    this.selectable(this.art("mf.base.standard.floor", x, y, scale), "project", id);
    this.art("mf.base.standard.back", x, y, scale);
    const variant =
      [...id].reduce((total, letter) => total + letter.charCodeAt(0), 0) % 3 === 0
        ? "observatory"
        : "standard";
    if (roof)
      this.selectable(
        this.art(this.cinematic(id) ? "mf.cinematic.roof" : `mf.base.${variant}.roof`, x, y, scale),
        "project",
        id,
      );
  }
  private cinematic(id: string) {
    return id === this.featuredProject && this.assets.has("mf.cinematic.island");
  }
  private ocean(x: number, y: number, width: number, height: number) {
    this.water = this.assets.tiledWater(x, y, width, height);
    if (this.water) this.target.addChild(this.water);
  }
  private front(x: number, y: number, scale: number) {
    this.art("mf.base.standard.front", x, y, scale);
  }
  private vegetation(x: number, y: number, large: boolean, foreground: boolean, cinematic = false) {
    const trees = foreground
      ? large
        ? [
            [-280, -20, 0.65],
            [310, -35, 0.66],
            [-170, 55, 0.5],
            [230, 20, 0.48],
          ]
        : [
            [-255, -55, 0.4],
            [255, -50, 0.42],
          ]
      : large
        ? [
            [-135, -215, 0.6],
            [-40, -265, 0.55],
            [90, -250, 0.64],
            [210, -175, 0.55],
            [-310, -110, 0.7],
          ]
        : [
            [0, -210, 0.42],
            [-220, -120, 0.35],
            [220, -115, 0.34],
          ];
    trees.forEach(([dx = 0, dy = 0, scale = 1], index) => {
      this.art(
        cinematic && index % 3 === 0 ? "mf.cinematic.tree" : "mf.prop.purple-tree",
        x + dx,
        y + dy,
        scale,
      );
    });
    if (foreground) {
      this.art("mf.prop.rock", x - 150, y + 75, 0.8);
      this.art("mf.prop.rock", x + 170, y + 35, 0.6);
    }
  }
  private worker(
    task: TaskSummary,
    x: number,
    y: number,
    scale: number,
    selected: boolean,
    active: boolean,
    detail = false,
    contact?: { x: number; y: number },
    cinematic = false,
  ) {
    const motion = createWorker(
      this.assets,
      this.target,
      this.pick,
      task,
      x,
      y,
      scale,
      selected,
      active,
      detail,
      contact,
      cinematic,
    );
    if (motion) this.motions.push(motion);
  }
  private station(task: TaskSummary, x: number, y: number, scale: number, detail = false) {
    const id = ["generating-designs", "awaiting-design-selection"].includes(task.status)
      ? "projection"
      : {
          triage: "intake",
          scouts: "survey",
          grill: "communications",
          specification: "blueprint",
          plan: "planning",
          implement: "fabrication",
          "dev-review": "inspection",
          test: "diagnostics",
          "final-review": "delivery-inspection",
          approval: "launchpad",
        }[task.currentStage];
    if (detail && id === "launchpad") {
      x -= 35 * scale;
      y += 60 * scale;
    }
    this.selectable(
      this.art(`mf.station.${id}`, x + 28 * scale, y - 6 * scale, 0.95 * scale),
      "task",
      task.id,
    );
    const socket = this.assets.socket(`mf.station.${id}`, "frontToolPort", 0.95 * scale);
    if (id === "launchpad") {
      const dock = this.assets.socket("mf.station.launchpad", "shuttleDock", 0.95 * scale);
      const shuttle = this.art(
        "mf.vehicle.shuttle",
        x + 28 * scale + dock.x,
        y - 6 * scale + dock.y,
        0.95 * scale * 0.7,
      );
      if (shuttle) {
        const departing = task.status === "completed";
        if (this.advanced.has(task.id))
          this.flights.push({
            sprite: shuttle,
            x: shuttle.x,
            y: shuttle.y,
            started: performance.now(),
            distance: 95 * scale,
            departing,
          });
        else if (departing) shuttle.alpha = 0;
      }
    }
    return { x: x + 28 * scale + socket.x, y: y - 6 * scale + socket.y };
  }
  private overview(input: SceneInput, projects: (RuntimeProject & { position: { x: number; y: number } })[]) {
    const extent = Math.max(6000, ...projects.map(({ position }) => Math.max(position.x, position.y) + 3000));
    this.entity("world-terrain", extent, () => {
      this.ocean(-4000, -4000, extent + 4000, extent + 4000);
    });
    this.entity("world-islands", [this.featuredProject, projects.map(({ position }) => position)], () => {
      for (const { id, position } of projects) {
        const anchor = islandAnchor(position);
        if (this.cinematic(id)) this.art("mf.cinematic.island", position.x, position.y - 60, 1.24);
        else this.art("mf.terrain.shore.rim", anchor.x, anchor.y, islandScale(position));
      }
      this.target.addChild(projectRoutes(this.assets, projects));
    });
    for (const project of projects) {
      const projectTasks = tasksInProject(input.tasks, project);
      this.entity(
        `world-${project.id}`,
        [
          project,
          projectTasks,
          projectTasks.some((task) => task.id === input.selectedId) ? input.selectedId : null,
          input.connected,
          input.motion,
        ],
        () => {
          const { x, y } = project.position;
          this.vegetation(x, y, y < 1000, false, this.cinematic(project.id));
          this.compound(x, y, 0.55, true, project.id);
          const tasks = projectTasks.filter(isOpen);
          const representatives = [...tasks]
            .sort(
              (a, b) =>
                Number(b.id === input.selectedId) - Number(a.id === input.selectedId) ||
                Number(needsYou(b)) - Number(needsYou(a)),
            )
            .slice(0, projects.length > 15 ? 1 : 2);
          representatives.forEach((task, taskIndex) => {
            this.worker(
              task,
              x - 30 + taskIndex * 62,
              y + 25,
              1,
              task.id === input.selectedId,
              input.connected && Boolean(task.activeRunIds?.length),
              false,
              undefined,
              this.cinematic(project.id),
            );
          });
          this.front(x, y, 0.55);
          const carrierTask =
            projectTasks.find((task) => task.id === input.selectedId && task.artifacts?.length) ??
            projectTasks.find((task) => task.artifacts?.length);
          if (carrierTask) this.handoff(carrierTask, x - 110, y + 10, 0.7);
          this.vegetation(x, y, y < 1000, true, this.cinematic(project.id));
          this.labels.push({
            id: `project-${project.id}`,
            kind: "project",
            x,
            y: y - (this.cinematic(project.id) ? 310 : 210),
            title: project.name,
            detail: `${tasks.length} open · ${tasks.filter(needsYou).length} need you`,
            attention: "project",
            projectId: project.id,
          });
          const keyTask = representatives.find((task) => task.id === input.selectedId) ?? representatives[0];
          if (keyTask) {
            const attention = attentionFor(keyTask);
            this.labels.push({
              id: `task-${keyTask.id}`,
              kind: "task",
              x: x + (this.cinematic(project.id) ? 320 : 75),
              y: y - (this.cinematic(project.id) ? 45 : 80),
              title: `${keyTask.id} · ${stageLabels[keyTask.currentStage]}`,
              detail: attention.label,
              reason: attention.reason,
              attention: attention.kind,
              projectId: project.id,
              taskId: keyTask.id,
            });
          }
        },
      );
    }
    const xs = projects.map((project) => project.position.x),
      ys = projects.map((project) => project.position.y);
    this.bounds = {
      x: Math.min(0, ...xs) - 100,
      y: Math.min(0, ...ys) - 20,
      width: Math.max(1450, ...xs.map((x) => x + 350)),
      height: Math.max(840, ...ys.map((y) => y + 160)),
    };
  }
  private headquarters(input: SceneInput, project: RuntimeProject) {
    const tasks = tasksInProject(input.tasks, project)
      .filter(isOpen)
      .sort((a, b) => {
        const order = ["grill", "dev-review", "implement"];
        return order.indexOf(a.currentStage) - order.indexOf(b.currentStage) || a.id.localeCompare(b.id);
      });
    const sites = tasks.map((task, index) => ({ task, site: taskSite(index) }));
    const xs = sites.map(({ site }) => site.x),
      ys = sites.map(({ site }) => site.y);
    const left = Math.min(0, ...xs),
      right = Math.max(0, ...xs);
    const top = Math.min(0, ...ys),
      bottom = Math.max(0, ...ys);
    this.bounds = { x: left - 240, y: top - 315, width: right - left + 480, height: bottom - top + 340 };
    this.entity("hq-terrain", [project.id, this.bounds, this.featuredProject], () => {
      this.ocean(-8000, -8000, 16000, 16000);
      const scale = Math.max(2.7, this.bounds.width / 400, (this.bounds.height + 80) / 220);
      if (this.cinematic(project.id))
        this.art("mf.cinematic.island", (left + right) / 2, (top + bottom) / 2 - 80, scale * 0.53);
      else this.art("mf.terrain.ground", (left + right) / 2, bottom + 130, scale);
      for (const [dx = 0, dy = 0] of [
        [-90, -20],
        [80, -10],
        [0, -60],
      ])
        this.art("mf.prop.purple-tree", (left + right) / 2 + dx, top - 210 + dy, 0.75);
      this.art(
        this.cinematic(project.id) ? "mf.cinematic.tree" : "mf.prop.purple-tree",
        left - 260,
        (top + bottom) / 2 - 70,
        0.85,
      );
      this.art("mf.prop.purple-tree", right + 255, (top + bottom) / 2 - 90, 0.8);
    });
    if (!tasks.length)
      this.entity(`hq-empty-${project.id}`, project.id, () => {
        this.compound(0, 0, 1, false, project.id);
        this.front(0, 0, 1);
      });
    sites
      .sort((a, b) => a.site.y - b.site.y || a.site.x - b.site.x)
      .forEach(({ task, site }) => {
        this.entity(
          `hq-task-${task.id}`,
          [task, site, input.selectedId === task.id, input.connected, input.motion],
          () => {
            this.compound(site.x, site.y, 0.6, false, project.id);
            const contact = this.station(task, site.x, site.y - 70, 0.85);
            this.worker(
              task,
              site.x - 35,
              site.y - 90,
              0.8,
              task.id === input.selectedId,
              input.connected && Boolean(task.activeRunIds?.length),
              false,
              contact,
              this.cinematic(project.id),
            );
            const attention = attentionFor(task);
            const running = task.workPackages.find((item) => item.status === "running");
            const failed = task.workPackages.find((item) => item.status === "failed");
            const waiting = task.workPackages.find(
              (item) => item.status === "planned" && item.dependencies.length,
            );
            this.labels.push({
              id: `task-${task.id}`,
              kind: "task",
              x: site.x,
              y: site.y - 190,
              title: `${task.id} · ${stageLabels[task.currentStage]}`,
              detail:
                running && failed
                  ? `${running.id} running · ${failed.id} ${failed.status}`
                  : running && waiting
                    ? `${running.id} running · ${waiting.id} waits on ${waiting.dependencies.join(", ")}`
                    : attention.label,
              reason: attention.reason,
              attention: attention.kind,
              projectId: project.id,
              taskId: task.id,
            });
            this.handoff(task, site.x - 82, site.y - 95, 0.85);
            this.front(site.x, site.y, 0.6);
          },
          task.id,
        );
      });
  }
  private detail(input: SceneInput, project: RuntimeProject) {
    this.backdropBounds = this.cinematic(project.id)
      ? null
      : this.assets.bounds("mf.terrain.region", 864, 252, 3.6);
    const task = input.tasks.find((entry) => entry.id === input.location.taskId);
    this.entity(
      `detail-${task?.id ?? project.id}`,
      [task, input.connected, input.motion, input.watchedRunActive],
      () => {
        if (this.cinematic(project.id)) {
          this.ocean(-8000, -8000, 16000, 16000);
          this.art("mf.cinematic.island", 0, -40, 2.65);
          this.art("mf.cinematic.tree", -420, -170, 1.35);
          this.art("mf.prop.purple-tree", 380, -160, 1.25);
        } else this.art("mf.terrain.region", 864, 252, 3.6);
        this.compound(-80, 140, 1.3, false, project.id);
        if (task) {
          const contact = this.station(task, -10, -75, 2.1, true);
          this.worker(
            task,
            -70,
            -75,
            3,
            true,
            input.connected && input.watchedRunActive,
            true,
            contact,
            this.cinematic(project.id),
          );
          const attention = attentionFor(task);
          this.labels.push({
            id: `task-${task.id}`,
            kind: "task",
            x: -80,
            y: -290,
            title: `${task.id} · ${stageLabels[task.currentStage]}`,
            detail: attention.label,
            attention: attention.kind,
            projectId: project.id,
            taskId: task.id,
          });
        }
      },
    );
    this.bounds = { x: -420, y: -450, width: 730, height: 600 };
  }
  tick(time: number) {
    for (const tree of this.foliage) tree.skew.x = Math.sin(time / 4100 + tree.x) * 0.003;
    if (this.assets.direction === "cinematic" && this.water && !this.water.destroyed)
      this.water.tilePosition.set(Math.sin(time / 24000) * 7, Math.sin(time / 31000) * 4);
    this.flights = this.flights.filter((flight) => {
      if (flight.sprite.destroyed) return false;
      const progress = Math.min(1, (time - flight.started) / 1100);
      const travel = flight.departing ? progress * progress : (1 - progress) * (1 - progress);
      flight.sprite.position.set(
        flight.x + flight.distance * 0.5 * travel,
        flight.y - flight.distance * travel,
      );
      flight.sprite.alpha = flight.departing ? 1 - progress : Math.min(1, progress * 3);
      return progress < 1;
    });
    this.handoffs = this.handoffs.filter((item) => {
      if (item.container.destroyed) return false;
      const progress = Math.min(1, (time - item.started) / 700);
      item.container.alpha = 0.55 + progress * 0.45;
      return progress < 1;
    });
    for (const item of this.motions) {
      if (item.active) {
        item.light.alpha = 0.6 + Math.sin(time * 0.005 + item.offset) * 0.4;
        if (item.tool) item.tool.rotation = (Math.sin(time * 0.0025 + item.offset) * Math.PI) / 45;
        if (item.animation) {
          const { sprite, frames, frameDurationMs } = item.animation;
          this.assets.setFrame(
            sprite,
            frames[Math.floor((time + item.offset) / frameDurationMs) % frames.length] ?? frames[0] ?? "",
          );
        }
      }
    }
  }
  destroy() {
    this.root.destroy({ children: true });
  }
}
