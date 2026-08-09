import { useEffect, useRef } from "react";
import cargoCrate from "../../assets/atlas/cargo-crate.png";
import { type RuntimeTask, type StageId, workflowStages } from "../../domain";
import { AtlasRoomCard } from "./AtlasRoomCard";
import {
  ATLAS_WORLD_HEIGHT,
  ATLAS_WORLD_WIDTH,
  type AtlasPoint,
  atlasRepairRoads,
  atlasRoads,
  atlasRooms,
  getAtlasTransitionPath,
  getTaskColor,
} from "./atlasModel";

interface Transition {
  taskId: string;
  from: StageId;
  to: StageId;
  startedAt: number;
}

export function WorkflowAtlasCanvas({
  tasks,
  selectedTaskId,
  previewTransitionKey = 0,
  trackPersistedTransitions = true,
  onSelectTask,
  onOpenWorkbench,
}: {
  tasks: RuntimeTask[];
  selectedTaskId: string | null;
  previewTransitionKey?: number;
  trackPersistedTransitions?: boolean;
  onSelectTask: (taskId: string) => void;
  onOpenWorkbench: (taskId: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previousStagesRef = useRef<Map<string, StageId> | null>(null);
  const transitionsRef = useRef<Map<string, Transition>>(new Map());
  const consumedPreviewTransitionKeyRef = useRef(0);
  const cargoImageRef = useRef<HTMLImageElement | null>(null);
  const trackingPersistedTransitionsRef = useRef(trackPersistedTransitions);

  useEffect(() => {
    const image = new Image();
    image.src = cargoCrate;
    image.onload = () => {
      cargoImageRef.current = image;
    };
    return () => {
      image.onload = null;
    };
  }, []);

  useEffect(() => {
    const now = performance.now();
    const previousTracking = trackingPersistedTransitionsRef.current;
    trackingPersistedTransitionsRef.current = trackPersistedTransitions;
    if (!trackPersistedTransitions || !previousTracking) {
      transitionsRef.current.clear();
      previousStagesRef.current = new Map(tasks.map((task) => [task.id, task.currentStage]));
      return;
    }
    if (previousStagesRef.current) {
      for (const task of tasks) {
        const previous = previousStagesRef.current.get(task.id);
        if (
          previous &&
          previous !== task.currentStage &&
          getAtlasTransitionPath(previous, task.currentStage).length > 1
        ) {
          transitionsRef.current.set(task.id, {
            taskId: task.id,
            from: previous,
            to: task.currentStage,
            startedAt: now,
          });
        }
      }
    }
    previousStagesRef.current = new Map(tasks.map((task) => [task.id, task.currentStage]));
  }, [tasks, trackPersistedTransitions]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    if (
      previewTransitionKey > 0 &&
      previewTransitionKey !== consumedPreviewTransitionKeyRef.current &&
      selectedTaskId
    ) {
      consumedPreviewTransitionKeyRef.current = previewTransitionKey;
      transitionsRef.current.set(selectedTaskId, {
        taskId: selectedTaskId,
        from: "plan",
        to: "implement",
        startedAt: performance.now(),
      });
    }
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;

    const draw = (time = performance.now()) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const nextWidth = Math.max(1, Math.round(rect.width * dpr));
      const nextHeight = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(
        (dpr * rect.width) / ATLAS_WORLD_WIDTH,
        0,
        0,
        (dpr * rect.height) / ATLAS_WORLD_HEIGHT,
        0,
        0,
      );
      drawAtlas(context, tasks, selectedTaskId, time, reduceMotion);
      const activeTransitions = drawTransitions(
        context,
        transitionsRef.current,
        time,
        reduceMotion,
        cargoImageRef.current,
      );
      if (activeTransitions || (selectedTaskId && !reduceMotion)) {
        window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(draw);
      }
    };

    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    draw();
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [previewTransitionKey, selectedTaskId, tasks]);

  return (
    <div className="atlas-map-scroller">
      <div className="atlas-map">
        <canvas ref={canvasRef} className="workflow-atlas-canvas" aria-hidden />
        <div className="atlas-room-layer">
          {atlasRooms.map((room) => (
            <AtlasRoomCard
              key={room.stageId}
              room={room}
              tasks={tasks}
              selectedTaskId={selectedTaskId}
              onSelectTask={onSelectTask}
              onOpenWorkbench={onOpenWorkbench}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function drawAtlas(
  context: CanvasRenderingContext2D,
  tasks: RuntimeTask[],
  selectedTaskId: string | null,
  time: number,
  reduceMotion: boolean,
) {
  drawGrid(context);
  for (const road of atlasRoads) drawRoad(context, road.points);
  drawTaskRoutes(context, tasks, selectedTaskId, time, reduceMotion);
  drawRepairRoads(context);
}

function drawTaskRoutes(
  context: CanvasRenderingContext2D,
  tasks: RuntimeTask[],
  selectedTaskId: string | null,
  time: number,
  reduceMotion: boolean,
) {
  const selected = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const routeTasks = [
    ...tasks.filter((task) => task.id !== selectedTaskId).slice(0, selected ? 3 : 4),
    ...(selected ? [selected] : []),
  ];
  routeTasks.forEach((task, routeIndex) => {
    const currentIndex = workflowStages.findIndex((stage) => stage.id === task.currentStage);
    if (currentIndex <= 0) return;
    const offset = (routeIndex - (routeTasks.length - 1) / 2) * 4;
    context.save();
    context.translate(0, offset);
    for (const road of atlasRoads.slice(0, currentIndex)) {
      const isSelected = task.id === selectedTaskId;
      drawPolyline(context, road.points, "rgba(5, 7, 7, 0.78)", isSelected ? 8 : 5);
      if (isSelected) {
        drawPolyline(context, road.points, getTaskColor(task.id), 2.2);
        if (!reduceMotion) {
          context.setLineDash([12, 8]);
          context.lineDashOffset = -((time / 38) % 20);
        }
        drawPolyline(context, road.points, getTaskColor(task.id), 4);
        context.setLineDash([]);
        context.lineDashOffset = 0;
      } else {
        drawPolyline(context, road.points, getTaskColor(task.id), 2.5);
      }
    }
    context.restore();
  });
}

function drawGrid(context: CanvasRenderingContext2D) {
  context.fillStyle = "#0d171a";
  context.fillRect(0, 0, ATLAS_WORLD_WIDTH, ATLAS_WORLD_HEIGHT);
  context.strokeStyle = "rgba(86, 127, 139, 0.1)";
  context.lineWidth = 1;
  for (let x = 0; x <= ATLAS_WORLD_WIDTH; x += 32) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, ATLAS_WORLD_HEIGHT);
    context.stroke();
  }
  for (let y = 0; y <= ATLAS_WORLD_HEIGHT; y += 32) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(ATLAS_WORLD_WIDTH, y);
    context.stroke();
  }
  context.fillStyle = "rgba(5, 11, 13, 0.22)";
  context.fillRect(0, 0, ATLAS_WORLD_WIDTH, ATLAS_WORLD_HEIGHT);
}

function drawRoad(context: CanvasRenderingContext2D, points: AtlasPoint[]) {
  context.save();
  context.shadowColor = "rgba(0, 0, 0, 0.72)";
  context.shadowBlur = 16;
  context.shadowOffsetY = 9;
  drawPolyline(context, points, "#111718", 48);
  context.shadowColor = "transparent";
  drawPolyline(context, points, "#596462", 38);
  drawPolyline(context, points, "#273031", 29);
  drawPolyline(context, points, "rgba(225, 232, 227, 0.48)", 2);
  context.setLineDash([13, 8]);
  drawPolyline(context, points, "rgba(215, 224, 217, 0.22)", 1.6);
  context.setLineDash([]);
  context.restore();
}

function drawRepairRoads(context: CanvasRenderingContext2D) {
  context.save();
  context.shadowColor = "rgba(237, 100, 100, 0.42)";
  context.shadowBlur = 11;
  for (const route of atlasRepairRoads) {
    drawPolyline(context, route.points, "rgba(38, 20, 21, 0.98)", 26);
    drawPolyline(context, route.points, "#a93e3e", 15);
    context.setLineDash([10, 8]);
    drawPolyline(context, route.points, "#ff7a73", 3.5);
    context.setLineDash([]);
    drawArrow(context, route.points, "#ed6464");
  }
  context.shadowColor = "transparent";
  context.font = "700 10px Inter, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "rgba(28, 15, 15, 0.96)";
  roundedRect(context, 862, 536, 146, 39, 5);
  context.fill();
  context.strokeStyle = "#9e3734";
  context.lineWidth = 1;
  context.stroke();
  context.fillStyle = "#ff8078";
  context.fillText("RETURN TO", 935, 549);
  context.fillText("IMPLEMENT", 935, 563);
  context.restore();
}

function drawTransitions(
  context: CanvasRenderingContext2D,
  transitions: Map<string, Transition>,
  time: number,
  reduceMotion: boolean,
  cargoImage: HTMLImageElement | null,
) {
  let active = false;
  for (const transition of [...transitions.values()]) {
    if (reduceMotion) {
      transitions.delete(transition.taskId);
      continue;
    }
    const progress = Math.min(1, (time - transition.startedAt) / 1_250);
    if (progress >= 1) {
      transitions.delete(transition.taskId);
      continue;
    }
    active = true;
    const path = getAtlasTransitionPath(transition.from, transition.to);
    if (path.length < 2) {
      transitions.delete(transition.taskId);
      continue;
    }
    const point = pointOnPath(path, easeInOut(progress));
    drawCargo(context, point, getTaskColor(transition.taskId), cargoImage);
  }
  if (active) drawTransitLabel(context);
  return active;
}

function pointOnPath(points: AtlasPoint[], progress: number): AtlasPoint {
  const first = points[0];
  if (!first) return { x: 0, y: 0 };
  const lengths = points.slice(1).map((point, index) => {
    const previous = points[index] ?? first;
    return Math.hypot(point.x - previous.x, point.y - previous.y);
  });
  const total = lengths.reduce((sum, value) => sum + value, 0);
  let distance = total * progress;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index] ?? 0;
    if (distance <= length) {
      const start = points[index] ?? first;
      const end = points[index + 1] ?? start;
      const ratio = length ? distance / length : 0;
      return { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
    }
    distance -= length;
  }
  return points.at(-1) ?? first;
}

function drawCargo(
  context: CanvasRenderingContext2D,
  point: AtlasPoint,
  color: string,
  image: HTMLImageElement | null,
) {
  if (!image) return;
  context.save();
  context.translate(point.x, point.y);
  context.shadowColor = color;
  context.shadowBlur = 13;
  context.drawImage(image, -18, -18, 36, 36);
  context.restore();
}

function drawTransitLabel(context: CanvasRenderingContext2D) {
  context.save();
  context.fillStyle = "rgba(36, 24, 6, 0.96)";
  roundedRect(context, 493, 264, 142, 25, 5);
  context.fill();
  context.strokeStyle = "#efab24";
  context.stroke();
  context.fillStyle = "#ffc04a";
  context.font = "700 10px Inter, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("HANDOFF IN TRANSIT", 564, 276.5);
  context.restore();
}

function drawPolyline(context: CanvasRenderingContext2D, points: AtlasPoint[], color: string, width: number) {
  if (points.length < 2) return;
  const first = points[0];
  if (!first) return;
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = color;
  context.lineWidth = width;
  context.stroke();
}

function drawArrow(context: CanvasRenderingContext2D, points: AtlasPoint[], color: string) {
  const end = points.at(-1);
  const previous = points.at(-2);
  if (!end || !previous) return;
  const angle = Math.atan2(end.y - previous.y, end.x - previous.x);
  context.save();
  context.translate(end.x, end.y);
  context.rotate(angle);
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(-10, -6);
  context.lineTo(-10, 6);
  context.closePath();
  context.fill();
  context.restore();
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function easeInOut(value: number) {
  return value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
}
