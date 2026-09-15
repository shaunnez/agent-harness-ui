import { Container, type Sprite, type TilingSprite } from "pixi.js";
import type { RuntimeProject, StageId } from "../../domain";
import type { WorldLocation } from "../app/navigation";
import type { TaskSummary } from "../runtime/contracts";
import { attentionFor, isOpen, needsYou, stageLabels } from "../runtime/presentation";
import { featuredProjectId } from "./asset-policy";
import type { WorldAssets } from "./assets";
import { coastalSite } from "./coastal-layout";
import { WorldEnvironment } from "./environment";
import { defaultEnvironment, type EnvironmentPreferences } from "./environment-model";
import { ProjectPlacement, TransitionTracker, taskSite, tasksInProject } from "./layout";
import { islandAnchor, islandScale, projectRoutes } from "./routes";
import {
  placeCoastalBackdrop,
  placeCompound,
  placeHeadquartersVegetation,
  placeStation,
  placeVegetation,
  type SceneryContext,
} from "./scenery";
import { basePatrol, workerBehavior } from "./worker-behavior";
import { createBaseCrew, createWorker, tickWorker, type WorkerMotion } from "./workers";

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
  idleRoaming?: boolean;
  environment?: EnvironmentPreferences;
  watchedStage?: StageId;
  watchedRole?: string | null;
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
  readonly environment = new WorldEnvironment();
  private input: SceneInput | null = null;
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
    this.input = input;
    this.metrics.reconciliations++;
    this.used.clear();
    this.order = 0;
    this.motionEnabled = input.motion && input.connected;
    this.environment.configure(
      input.environment ?? defaultEnvironment,
      this.motionEnabled && !document.hidden,
    );
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
    if (this.motionEnabled && !document.hidden)
      for (const motion of this.motions) tickWorker(motion, this.assets, performance.now());
    this.environment.update(0, true);
  }
  private entity(key: string, data: unknown, build: () => void, taskId?: string) {
    this.used.add(key);
    const signature = JSON.stringify([data, this.assets.activityReady, this.assets.detailReady]);
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
    this.environment.surface(sprite);
    if (sprite && ["mf.cinematic.tree", "mf.prop.purple-tree"].includes(id)) this.foliage.push(sprite);
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
    placeCompound(this.scenery(), x, y, scale, roof, id, this.cinematic(id));
  }
  private cinematic(id: string) {
    return id === this.featuredProject && this.assets.has("mf.cinematic.island");
  }
  private ocean(x: number, y: number, width: number, height: number) {
    this.water = this.assets.tiledWater(x, y, width, height);
    this.environment.surface(this.water, "sea");
    if (this.water) this.target.addChild(this.water);
  }
  private front(x: number, y: number, scale: number, projectId?: string) {
    const room = projectId && this.cinematic(projectId) && this.assets.has("mf.fidelity.room.front");
    this.art(room ? "mf.fidelity.room.front" : "mf.base.standard.front", x, y, scale);
  }
  private vegetation(
    x: number,
    y: number,
    large: boolean,
    foreground: boolean,
    cinematic = false,
    crossing?: { x: number; y: number },
  ) {
    placeVegetation(
      (id, tx, ty, scale) => {
        // Clear neighbouring canopies from the authored far abutment and its real road junction.
        if (
          crossing &&
          id.includes("tree") &&
          Math.abs(tx - crossing.x) < 100 &&
          ty > crossing.y - 40 &&
          ty < crossing.y + 220
        )
          return null;
        return this.art(id, tx, ty, scale);
      },
      x,
      y,
      large,
      foreground,
      cinematic,
    );
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
    const input = this.input;
    const behavior = workerBehavior(
      task,
      input?.connected ?? false,
      active,
      input?.idleRoaming ?? true,
      detail && !active,
    );
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
      cinematic || this.assets.direction === "cinematic",
      {
        environment: this.environment,
        behavior,
        stage: detail ? input?.watchedStage : undefined,
        role: detail ? input?.watchedRole : task.activeRunKind,
      },
    );
    if (motion) this.motions.push(motion);
  }
  private crew(id: string, x: number, y: number, view: "world" | "project", count: number) {
    if (!this.input?.idleRoaming) return;
    for (let index = 0; index < count; index++) {
      const motion = createBaseCrew(
        this.assets,
        this.environment,
        this.target,
        `${id}-${index}`,
        basePatrol(x, y, index, view),
        view === "world" ? 1.25 : 0.95,
      );
      if (motion) this.motions.push(motion);
    }
  }
  private station(task: TaskSummary, x: number, y: number, scale: number, detail = false, stage?: StageId) {
    return placeStation(this.scenery(), task, x, y, scale, detail, stage);
  }
  private scenery(): SceneryContext {
    return {
      assets: this.assets,
      environment: this.environment,
      container: this.target,
      art: this.art.bind(this),
      select: this.selectable.bind(this),
      shuttle: (sprite, taskId, departing, scale) => {
        if (this.advanced.has(taskId))
          this.flights.push({
            sprite,
            x: sprite.x,
            y: sprite.y,
            started: performance.now(),
            distance: 95 * scale,
            departing,
          });
        else if (departing) sprite.alpha = 0;
      },
    };
  }
  private overview(input: SceneInput, projects: (RuntimeProject & { position: { x: number; y: number } })[]) {
    const coastal = this.assets.has("mf.coastal.terrain")
      ? coastalSite(projects, this.featuredProject)
      : null;
    const extent = Math.max(6000, ...projects.map(({ position }) => Math.max(position.x, position.y) + 3000));
    this.entity("world-terrain", extent, () => {
      this.ocean(-4000, -4000, extent + 4000, extent + 4000);
    });
    this.entity(
      "world-islands",
      [this.featuredProject, coastal, projects.map(({ position }) => position)],
      () => {
        if (
          this.featuredProject &&
          this.assets.has("mf.cinematic.island") &&
          projects.length > 1 &&
          projects.length <= 3
        ) {
          const right = Math.max(...projects.map(({ position }) => position.x));
          const top = Math.min(...projects.map(({ position }) => position.y));
          const x = right + 100,
            y = top - 400;
          if (
            projects.every(({ position }) => Math.hypot((x - position.x) / 650, (y - position.y) / 460) > 1)
          )
            placeCoastalBackdrop(this.scenery(), x, y);
        }
        if (coastal) {
          const { x, y } = coastal.origin;
          const water = this.art("mf.coastal.shallows", x, y);
          this.environment.surface(water, "sea");
          const shore = this.assets.sprite("mf.coastal.shore", x, y);
          if (shore) {
            this.target.addChild(shore);
            this.environment.shore(shore);
          }
        }
        for (const { id, position } of projects) {
          const anchor = islandAnchor(position);
          if (id === coastal?.projectId) continue;
          if (this.cinematic(id)) this.art("mf.cinematic.island", position.x, position.y - 60, 1.24);
          else this.art("mf.terrain.shore.rim", anchor.x, anchor.y, islandScale(position));
        }
        if (coastal) {
          // The connected foreground headland owns its far abutment, ahead of neighbouring ground.
          const { x, y } = coastal.origin;
          this.art("mf.coastal.terrain", x, y);
          this.art("mf.coastal.bridge", x, y);
        }
        const routes = projectRoutes(this.assets, projects, coastal);
        this.environment.surfacesIn(routes);
        this.target.addChild(routes);
      },
    );
    for (const project of projects) {
      const projectTasks = tasksInProject(input.tasks, project);
      this.entity(
        `world-${project.id}`,
        [
          project,
          coastal,
          projectTasks,
          projectTasks.some((task) => task.id === input.selectedId) ? input.selectedId : null,
          input.connected,
          input.motion,
          input.idleRoaming,
        ],
        () => {
          const { x, y } = project.position;
          const coastalBase = coastal?.projectId === project.id;
          if (coastalBase) this.selectable(this.art("mf.coastal.base", x, y), "project", project.id);
          else {
            this.vegetation(x, y, y < 1000, false, this.cinematic(project.id), coastal?.join);
            this.compound(x, y, 0.55, true, project.id);
          }
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
          if (!coastalBase) this.front(x, y, 0.55);
          const carrierTask =
            projectTasks.find((task) => task.id === input.selectedId && task.artifacts?.length) ??
            projectTasks.find((task) => task.artifacts?.length);
          if (carrierTask) this.handoff(carrierTask, x - 110, y + 10, 0.7);
          if (!coastalBase) this.vegetation(x, y, y < 1000, true, this.cinematic(project.id), coastal?.join);
          if (projects.indexOf(project) < 12)
            this.crew(project.id, x, y, "world", projects.length > 15 ? 1 : 2);
          if (coastalBase) {
            this.art("mf.coastal.front", x, y);
            const lights = this.assets.sprite("mf.coastal.lights", x, y);
            if (lights) {
              this.target.addChild(lights);
              this.environment.emission(lights, 0.1, 0.9);
            }
          } else this.environment.waterGlints(this.target, x + 345, y + 180, x);
          this.labels.push({
            id: `project-${project.id}`,
            kind: "project",
            x,
            y: y - (coastalBase ? 330 : this.cinematic(project.id) ? 310 : 210),
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
              x: x + (coastalBase ? 385 : this.cinematic(project.id) ? 320 : 75),
              y: y - (coastalBase ? 300 : this.cinematic(project.id) ? 45 : 80),
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
    this.entity(
      "hq-terrain",
      [project.id, this.bounds, this.featuredProject, sites.map(({ site }) => site)],
      () => {
        this.ocean(-8000, -8000, 16000, 16000);
        const scale = Math.max(2.7, this.bounds.width / 400, (this.bounds.height + 80) / 220);
        if (this.cinematic(project.id))
          this.art("mf.cinematic.island", (left + right) / 2, (top + bottom) / 2 - 80, scale * 0.53);
        else this.art("mf.terrain.ground", (left + right) / 2, bottom + 130, scale);
        if (this.cinematic(project.id)) {
          // All foundation surrounds sit below every room, including adjoining tiles.
          const foundations = sites.length
            ? sites.map(({ site }) => ({ ...site, scale: 0.6 }))
            : [{ x: 0, y: 0, scale: 1 }];
          for (const site of foundations)
            this.art("mf.fidelity.room.ground-contact", site.x, site.y, site.scale);
        }
        placeHeadquartersVegetation(
          this.art.bind(this),
          { left, right, top, bottom },
          this.cinematic(project.id),
        );
      },
    );
    if (!tasks.length)
      this.entity(`hq-empty-${project.id}`, [project.id, input.idleRoaming], () => {
        this.compound(0, 0, 1, false, project.id);
        this.front(0, 0, 1, project.id);
        this.crew(project.id, 0, 0, "project", 2);
      });
    sites
      .sort((a, b) => a.site.y - b.site.y || a.site.x - b.site.x)
      .forEach(({ task, site }) => {
        this.entity(
          `hq-task-${task.id}`,
          [task, site, input.selectedId === task.id, input.connected, input.motion, input.idleRoaming],
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
            const projectedAttention = attentionFor(task);
            const attention = input.connected
              ? projectedAttention
              : { ...projectedAttention, kind: "unavailable" as const, label: "Connection unknown" };
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
            this.front(site.x, site.y, 0.6, project.id);
            if (site.y === bottom) this.crew(task.id, site.x, site.y, "project", 1);
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
      [task, input.connected, input.motion, input.watchedRunActive, input.watchedStage, input.watchedRole],
      () => {
        if (this.cinematic(project.id)) {
          this.ocean(-8000, -8000, 16000, 16000);
          this.art("mf.cinematic.island", 0, -40, 2.65);
          this.art("mf.fidelity.room.ground-contact", -80, 140, 1.3);
          this.art("mf.prop.purple-tree", -665, -115, 0.85);
          this.art("mf.prop.purple-tree", 510, -100, 0.8);
        } else this.art("mf.terrain.region", 864, 252, 3.6);
        this.compound(-80, 140, 1.3, false, project.id);
        if (task) {
          const contact = this.station(task, -10, -75, 2.1, true, input.watchedStage);
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
            y: -355,
            title: `${task.id} · ${stageLabels[input.watchedStage ?? task.currentStage]}`,
            detail: !input.connected
              ? "Connection unknown"
              : input.watchedRunActive
                ? attention.label
                : "Worker parked",
            attention: !input.connected ? "unavailable" : input.watchedRunActive ? attention.kind : "idle",
            projectId: project.id,
            taskId: task.id,
          });
        }
        if (this.cinematic(project.id) && this.assets.has("mf.fidelity.room.front"))
          this.front(-80, 140, 1.3, project.id);
      },
    );
    this.bounds = { x: -420, y: -450, width: 730, height: 600 };
  }
  tick(time: number) {
    this.environment.update(time);
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
    for (const item of this.motions) tickWorker(item, this.assets, time);
  }
  destroy() {
    this.root.destroy({ children: true });
    this.environment.destroy();
  }
}
