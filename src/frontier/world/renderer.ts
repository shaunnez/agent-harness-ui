import { Application, Rectangle } from "pixi.js";
import { WorldAssets } from "./assets";
import { type Camera, constrainCamera, coverBackdrop, fitCamera, type Point, zoomAround } from "./camera";
import type { WorldLighting } from "./environment-model";
import { FrontierScene, type SceneInput, type WorldLabel } from "./scene";
import { AnimationVisibility } from "./visibility";

interface RendererCallbacks {
  select(kind: "project" | "task" | "artifact", id: string, artifactId?: string): void;
  labels(labels: WorldLabel[]): void;
  camera(camera: Camera): void;
  minimap(data: string): void;
  problem(message: string | null): void;
  lighting(value: WorldLighting): void;
}
export class WorldRenderer {
  private app = new Application();
  private assets = new WorldAssets();
  private scene: FrontierScene | null = null;
  private stopped = false;
  private ready = false;
  private input: SceneInput | null = null;
  private viewKey = "";
  private cameras = new Map<string, Camera>();
  private camera: Camera = { x: 0, y: 0, zoom: 1 };
  private drag: { point: Point; camera: Camera } | null = null;
  private dragDistance = 0;
  private resizeObserver: ResizeObserver | null = null;
  private frameTimes: number[] = [];
  private measurementStarted = performance.now();
  private lastFrame = 0;
  private minimapGeneration = 0;
  private viewTransition = 0;
  private initialized = false;
  private loadingDetail = false;
  private loadingActivity = false;
  private failedActivity = false;
  private lastLightingNotice = 0;
  private backgroundSuspensions = 0;
  private animation: AnimationVisibility | null = null;
  constructor(
    private host: HTMLElement,
    private callbacks: RendererCallbacks,
  ) {}
  async initialize() {
    await this.app.init({
      resizeTo: this.host,
      preference: "webgl",
      background: "#17333f",
      resolution: Math.min(window.devicePixelRatio, 2),
      autoDensity: true,
      antialias: true,
      autoStart: false,
    });
    this.initialized = true;
    if (this.stopped) {
      this.disposeApplication();
      return;
    }
    try {
      await this.assets.load();
    } catch (error) {
      this.disposeApplication();
      throw error;
    }
    if (this.stopped) {
      this.disposeApplication();
      return;
    }
    this.scene = new FrontierScene(
      this.assets,
      (kind, id, artifactId) => {
        if (this.dragDistance < 6) this.callbacks.select(kind, id, artifactId);
      },
      this.input?.placementNamespace ?? this.input?.mode ?? "live",
    );
    this.app.stage.addChild(this.scene.root);
    this.app.canvas.setAttribute(
      "aria-label",
      "Mission Frontier game world. Drag terrain to pan; scroll to zoom. Project and task selection is also available in the world labels.",
    );
    this.app.canvas.setAttribute("role", "img");
    this.host.appendChild(this.app.canvas);
    this.host.addEventListener("pointerdown", this.pointerDown);
    this.host.addEventListener("pointermove", this.pointerMove);
    window.addEventListener("pointerup", this.pointerUp);
    this.host.addEventListener("wheel", this.wheel, { passive: false });
    this.animation = new AnimationVisibility(document, this.setAnimation);
    this.app.ticker.add(this.tick);
    this.resizeObserver = new ResizeObserver(() => {
      if (this.ready) {
        this.app.resize();
        this.applyCamera();
      }
    });
    this.resizeObserver.observe(this.host);
    this.ready = true;
    if (this.input) this.update(this.input);
  }
  update(input: SceneInput) {
    this.input = input;
    if (!this.ready || !this.scene) return;
    if (
      this.assets.direction === "cinematic" &&
      input.location.view !== "world" &&
      !this.assets.activityReady &&
      !this.failedActivity &&
      !this.loadingActivity
    ) {
      this.loadingActivity = true;
      void this.assets
        .loadActivity()
        .then(() => {
          this.loadingActivity = false;
          if (!this.stopped && this.input) this.update(this.input);
        })
        .catch((error: unknown) => {
          this.loadingActivity = false;
          this.failedActivity = true;
          if (!this.stopped)
            this.callbacks.problem(
              error instanceof Error ? error.message : "Worker motion could not be loaded.",
            );
        });
    }
    const cinematicDetail = this.assets.direction === "cinematic";
    if (input.location.view === "agent" && !cinematicDetail && !this.assets.detailReady) {
      if (!this.loadingDetail) {
        this.loadingDetail = true;
        void this.assets
          .loadDetail()
          .then(() => {
            this.loadingDetail = false;
            if (!this.stopped && this.input) this.update(this.input);
          })
          .catch((error: unknown) => {
            this.loadingDetail = false;
            if (!this.stopped)
              this.callbacks.problem(
                error instanceof Error ? error.message : "Agent artwork could not be loaded.",
              );
          });
      }
      return;
    }
    this.scene.reconcile(input);
    this.callbacks.lighting(this.scene.environment.lighting);
    this.callbacks.labels(this.scene.labels);
    const resolved =
      input.location.view === "world" ||
      (input.location.view === "project"
        ? input.projects.some((project) => project.id === input.location.projectId)
        : input.tasks.some((task) => task.id === input.location.taskId));
    const key = `${input.location.view}:${input.location.projectId ?? input.location.taskId ?? "all"}:${resolved}`;
    if (key !== this.viewKey) {
      this.cameras.set(this.viewKey, { ...this.camera });
      this.viewKey = key;
      this.camera = this.cameras.get(key) ?? this.fit();
      this.viewTransition = input.motion ? performance.now() : 0;
      this.scene.root.alpha = input.motion ? 0.4 : 1;
    }
    this.applyCamera();
    void this.captureMinimap();
    this.animation?.update(input.motion, input.connected);
  }
  private fit() {
    if (this.input?.location.view === "world" && this.input.projects.length <= 3) {
      const zoom = Math.max(
        0.3,
        Math.min((this.host.clientWidth - 300) / 1690, (this.host.clientHeight - 340) / 980),
      );
      return { x: (this.host.clientWidth - 300) / 2 - 695 * zoom, y: 220 + 90 * zoom, zoom };
    }
    if (this.input?.location.view === "project" && this.scene) {
      const bounds = this.scene.worldBounds;
      const zoom = Math.max(
        0.3,
        Math.min(
          (this.host.clientWidth - 260) / bounds.width,
          (this.host.clientHeight - 350) / bounds.height,
        ),
      );
      return {
        x: this.host.clientWidth / 2 - (bounds.x + bounds.width / 2) * zoom,
        y: 160 + (this.host.clientHeight - 380) / 2 - (bounds.y + bounds.height / 2) * zoom,
        zoom,
      };
    }
    const detail = this.input?.location.view === "agent";
    const width = this.host.clientWidth * (detail ? 0.61 : 1);
    return fitCamera(
      width,
      this.host.clientHeight,
      this.scene?.worldBounds ?? { x: 0, y: 0, width: 1500, height: 850 },
      130,
      detail ? 120 : 250,
    );
  }
  reset() {
    this.camera = this.fit();
    this.applyCamera();
  }
  zoom(amount: number) {
    this.camera = zoomAround(
      this.camera,
      { x: this.host.clientWidth / 2, y: this.host.clientHeight / 2 },
      amount,
    );
    this.applyCamera();
  }
  pan(x: number, y: number) {
    this.camera = { ...this.camera, x: this.camera.x + x, y: this.camera.y + y };
    this.applyCamera();
  }
  focus(point: Point) {
    this.camera.x = this.host.clientWidth / 2 - point.x * this.camera.zoom;
    this.camera.y = this.host.clientHeight * 0.45 - point.y * this.camera.zoom;
    this.applyCamera();
  }
  minimapClick(x: number, y: number) {
    const bounds = this.scene?.worldBounds;
    if (bounds) this.focus({ x: bounds.x + x * bounds.width, y: bounds.y + y * bounds.height });
  }
  follow(taskId: string) {
    const label = this.scene?.labels.find((item) => item.taskId === taskId);
    if (label) this.focus(label);
  }
  get metrics() {
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    return {
      ...this.assets.metrics,
      ...this.scene?.metrics,
      ...this.scene?.environment.metrics,
      frameSamples: sorted.length,
      measuredSeconds: (performance.now() - this.measurementStarted) / 1000,
      medianFps: median ? 1000 / median : null,
      p95FrameMs: sorted[Math.floor(sorted.length * 0.95)] ?? null,
      entities: this.scene?.root.children.length ?? 0,
      workers: this.scene?.motions.filter((worker) => !worker.ambient).length ?? 0,
      activeWorkers: this.scene?.motions.filter((worker) => worker.active).length ?? 0,
      ambientCrew: this.scene?.motions.filter((worker) => worker.ambient).length ?? 0,
      roamingWorkers: this.scene?.motions.filter((worker) => worker.patrol).length ?? 0,
      workerActions:
        this.scene?.motions.filter((worker) => worker.active).map((worker) => worker.action) ?? [],
      tickerListeners: this.app.ticker?.count ?? 0,
      actorSamples:
        this.scene?.motions.slice(0, 30).map((worker) => ({
          id: worker.id,
          ambient: worker.ambient === true,
          active: worker.active,
          patrol: Boolean(worker.patrol),
          x: worker.root.x,
          y: worker.root.y,
          textureFrame: worker.body?.texture.uid,
        })) ?? [],
      tickerRunning: this.app.ticker?.started ?? false,
      documentHidden: document.hidden,
      backgroundSuspensions: this.backgroundSuspensions,
      camera: this.camera,
    };
  }
  get worldHour() {
    return this.scene?.environment.lighting.hour;
  }
  beginMeasurement() {
    this.frameTimes = [];
    this.lastFrame = 0;
    this.measurementStarted = performance.now();
  }
  private applyCamera() {
    if (!this.scene) return;
    this.camera = constrainCamera(
      this.camera,
      { width: this.host.clientWidth, height: this.host.clientHeight },
      this.scene.worldBounds,
    );
    if (this.scene.backdropBounds)
      this.camera = coverBackdrop(
        this.camera,
        { width: this.host.clientWidth, height: this.host.clientHeight },
        this.scene.backdropBounds,
      );
    this.scene.root.position.set(this.camera.x, this.camera.y);
    this.scene.root.scale.set(this.camera.zoom);
    this.callbacks.camera(this.camera);
    this.app.render();
  }
  private async captureMinimap() {
    if (!this.scene) return;
    const generation = ++this.minimapGeneration;
    const bounds = this.scene.worldBounds;
    const saved = { x: this.scene.root.x, y: this.scene.root.y, scale: this.scene.root.scale.x };
    this.scene.root.position.set(0, 0);
    this.scene.root.scale.set(1);
    const canvas = this.app.renderer.extract.canvas({
      target: this.scene.root,
      frame: new Rectangle(bounds.x, bounds.y, bounds.width, bounds.height),
      resolution: Math.min(260 / bounds.width, 180 / bounds.height),
      clearColor: "#142d37",
    });
    this.scene.root.position.set(saved.x, saved.y);
    this.scene.root.scale.set(saved.scale);
    if (!this.stopped && generation === this.minimapGeneration && "toDataURL" in canvas)
      this.callbacks.minimap((canvas as HTMLCanvasElement).toDataURL("image/png"));
  }
  private pointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    this.dragDistance = 0;
    this.drag = { point: { x: event.clientX, y: event.clientY }, camera: { ...this.camera } };
  };
  private pointerMove = (event: PointerEvent) => {
    if (!this.drag) return;
    const dx = event.clientX - this.drag.point.x,
      dy = event.clientY - this.drag.point.y;
    this.dragDistance = Math.hypot(dx, dy);
    if (this.dragDistance > 5) {
      const sensitivity = this.input?.cameraSensitivity ?? 1;
      this.camera = {
        ...this.drag.camera,
        x: this.drag.camera.x + dx * sensitivity,
        y: this.drag.camera.y + dy * sensitivity,
      };
      this.applyCamera();
    }
  };
  private pointerUp = () => {
    this.drag = null;
  };
  private wheel = (event: WheelEvent) => {
    event.preventDefault();
    const rect = this.host.getBoundingClientRect();
    this.camera = zoomAround(
      this.camera,
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      Math.exp(-event.deltaY * 0.0015 * (this.input?.cameraSensitivity ?? 1)),
    );
    this.applyCamera();
  };
  private setAnimation = (animate: boolean) => {
    if (!this.ready) return;
    this.lastFrame = 0;
    this.scene?.environment.setAnimating(animate);
    if (this.scene) this.callbacks.lighting(this.scene.environment.lighting);
    if (!animate) {
      if (document.hidden) this.backgroundSuspensions++;
      if (this.scene) this.scene.root.alpha = 1;
      this.viewTransition = 0;
      this.app.stop();
      this.app.render();
    } else this.app.start();
  };
  private tick = () => {
    const now = performance.now();
    if (this.lastFrame) {
      this.frameTimes.push(now - this.lastFrame);
      if (this.frameTimes.length > 12000) this.frameTimes.shift();
    }
    this.lastFrame = now;
    this.scene?.tick(now);
    if (this.scene && now - this.lastLightingNotice > 1000) {
      this.callbacks.lighting(this.scene.environment.lighting);
      this.lastLightingNotice = now;
    }
    if (this.scene && this.viewTransition) {
      this.scene.root.alpha = Math.min(1, 0.4 + (now - this.viewTransition) / 500);
      if (this.scene.root.alpha === 1) this.viewTransition = 0;
    }
  };
  destroy() {
    this.stopped = true;
    this.minimapGeneration++;
    this.resizeObserver?.disconnect();
    this.host.removeEventListener("pointerdown", this.pointerDown);
    this.host.removeEventListener("pointermove", this.pointerMove);
    window.removeEventListener("pointerup", this.pointerUp);
    this.host.removeEventListener("wheel", this.wheel);
    this.animation?.dispose();
    this.animation = null;
    if (this.ready) {
      this.app.ticker.remove(this.tick);
    }
    this.disposeApplication();
    this.ready = false;
  }
  private disposeApplication() {
    if (!this.initialized) return;
    this.scene?.environment.destroy();
    this.app.destroy(true, { children: true });
    this.initialized = false;
  }
}
