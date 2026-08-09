import { ArrowsOut, Minus, Plus, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { RuntimeTaskSummary, RuntimeWorkPackage } from "../../domain";
import { Button } from "../Primitives";
import { getPackageOverview } from "./atlasModel";

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

interface GraphNode {
  item: RuntimeWorkPackage;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function PackageWorkbench({
  task,
  open,
  onClose,
}: {
  task: RuntimeTaskSummary;
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selectedId, setSelectedId] = useState(task.workPackages[0]?.id ?? null);
  const selected = task.workPackages.find((item) => item.id === selectedId) ?? task.workPackages[0] ?? null;
  const overview = getPackageOverview(task.workPackages);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    setSelectedId(task.workPackages[0]?.id ?? null);
  }, [task.workPackages]);

  return (
    <dialog
      ref={dialogRef}
      className={`package-workbench ${overview.batches <= 1 ? "package-workbench--single-batch" : ""} ${overview.total === 1 ? "package-workbench--single-package" : ""}`}
      aria-labelledby="package-workbench-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <header className="package-workbench__header">
        <div>
          <p className="eyebrow">{task.id} · implementation</p>
          <h2 id="package-workbench-title">Package dependency workbench</h2>
          <p>
            {overview.total} package{overview.total === 1 ? "" : "s"} across {overview.batches} batch
            {overview.batches === 1 ? "" : "es"}. Qualified slices are ready for integration, not proof that
            the task passed.
          </p>
        </div>
        <Button tone="ghost" icon={X} compact onClick={onClose} aria-label="Close package workbench">
          Close
        </Button>
      </header>
      <fieldset className="package-workbench__summary">
        <legend className="sr-only">Package status summary</legend>
        <span>
          <i className="package-dot package-dot--running" />
          <strong>{overview.active}</strong>
          <small>active</small>
        </span>
        <span>
          <i className="package-dot package-dot--ready" />
          <strong>{overview.ready}</strong>
          <small>ready for integration</small>
        </span>
        <span>
          <i className="package-dot package-dot--ready" />
          <strong>{overview.integrated}</strong>
          <small>integrated</small>
        </span>
        <span>
          <i className="package-dot package-dot--failed" />
          <strong>{overview.blocked}</strong>
          <small>blocked</small>
        </span>
        <span>
          <i className="package-dot" />
          <strong>{overview.queued}</strong>
          <small>queued</small>
        </span>
      </fieldset>
      <div className="package-workbench__body">
        <PackageGraph
          packages={task.workPackages}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
        />
        <aside className="package-workbench__inspector" aria-live="polite">
          {selected ? (
            <PackageDetail item={selected} />
          ) : (
            <p>No implementation packages have been persisted for this task.</p>
          )}
        </aside>
      </div>
    </dialog>
  );
}

function PackageGraph({
  packages,
  selectedId,
  onSelect,
}: {
  packages: RuntimeWorkPackage[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodeRef = useRef<GraphNode[]>([]);
  const originRef = useRef({ x: 55, y: 65 });
  const dragRef = useRef<{ pointerId: number; x: number; y: number; camera: Camera } | null>(null);
  const [camera, setCamera] = useState<Camera>({ x: 55, y: 65, zoom: 1 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      context.fillStyle = "#111714";
      context.fillRect(0, 0, rect.width, rect.height);
      const nodes = layoutPackages(packages);
      nodeRef.current = nodes;
      const origin = graphOrigin(
        rect.width,
        rect.height,
        nodes,
        camera,
        new Set(packages.map((item) => item.batch)).size <= 1,
      );
      originRef.current = origin;
      drawGraphGrid(context, rect.width, rect.height, { ...camera, ...origin });
      context.save();
      context.translate(origin.x, origin.y);
      context.scale(camera.zoom, camera.zoom);
      drawDependencies(context, nodes);
      nodes.forEach((node) => {
        drawPackageNode(context, node, node.item.id === selectedId);
      });
      context.restore();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [camera, packages, selectedId]);

  const pointInGraph = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: (clientX - rect.left - originRef.current.x) / camera.zoom,
      y: (clientY - rect.top - originRef.current.y) / camera.zoom,
    };
  };

  const zoomBy = (amount: number) =>
    setCamera((value) => ({ ...value, zoom: Math.min(1.65, Math.max(0.55, value.zoom + amount)) }));

  return (
    <section className="package-graph" aria-label="Interactive package dependency graph">
      <div className="package-graph__controls">
        <Button tone="secondary" compact icon={Minus} onClick={() => zoomBy(-0.12)} aria-label="Zoom out">
          Zoom
        </Button>
        <span>{Math.round(camera.zoom * 100)}%</span>
        <Button tone="secondary" compact icon={Plus} onClick={() => zoomBy(0.12)} aria-label="Zoom in">
          Zoom
        </Button>
        <Button tone="ghost" compact icon={ArrowsOut} onClick={() => setCamera({ x: 55, y: 65, zoom: 1 })}>
          Fit graph
        </Button>
      </div>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label={`${packages.length} implementation packages. Drag to pan, use zoom controls, and select a package for details.`}
        onWheel={(event) => {
          event.preventDefault();
          zoomBy(event.deltaY > 0 ? -0.08 : 0.08);
        }}
        onPointerDown={(event) => {
          const point = pointInGraph(event.clientX, event.clientY);
          const hit = point
            ? [...nodeRef.current]
                .reverse()
                .find(
                  (node) =>
                    point.x >= node.x &&
                    point.x <= node.x + node.width &&
                    point.y >= node.y &&
                    point.y <= node.y + node.height,
                )
            : null;
          if (hit) {
            onSelect(hit.item.id);
            return;
          }
          dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, camera };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          setCamera({
            ...drag.camera,
            x: drag.camera.x + event.clientX - drag.x,
            y: drag.camera.y + event.clientY - drag.y,
          });
        }}
        onPointerUp={(event) => {
          dragRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      />
      <ol className="sr-only">
        {packages.map((item) => (
          <li key={item.id}>
            {item.id}: {item.title}; status {packageStatusLabel(item.status)}; dependencies{" "}
            {item.dependencies.join(", ") || "none"}
          </li>
        ))}
      </ol>
    </section>
  );
}

function layoutPackages(packages: RuntimeWorkPackage[]): GraphNode[] {
  const batches = [...new Set(packages.map((item) => item.batch))].sort((left, right) => left - right);
  if (batches.length <= 1) {
    const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(packages.length))));
    return packages.map((item, index) => ({
      item,
      x: (index % columns) * 235,
      y: Math.floor(index / columns) * 112,
      width: 210,
      height: 86,
    }));
  }
  return packages.map((item) => {
    const column = batches.indexOf(item.batch);
    const peers = packages.filter((candidate) => candidate.batch === item.batch);
    const row = peers.findIndex((candidate) => candidate.id === item.id);
    return { item, x: column * 255, y: row * 122, width: 210, height: 86 };
  });
}

function graphOrigin(width: number, height: number, nodes: GraphNode[], camera: Camera, centered: boolean) {
  if (!centered || !nodes.length) return { x: camera.x, y: camera.y };
  const left = Math.min(...nodes.map((node) => node.x));
  const top = Math.min(...nodes.map((node) => node.y));
  const right = Math.max(...nodes.map((node) => node.x + node.width));
  const bottom = Math.max(...nodes.map((node) => node.y + node.height));
  return {
    x: (width - (right - left) * camera.zoom) / 2 - left * camera.zoom + camera.x - 55,
    y: (height - (bottom - top) * camera.zoom) / 2 - top * camera.zoom + camera.y - 65,
  };
}

function drawGraphGrid(context: CanvasRenderingContext2D, width: number, height: number, camera: Camera) {
  context.strokeStyle = "rgba(109, 123, 116, 0.12)";
  context.lineWidth = 1;
  const spacing = 30 * camera.zoom;
  for (let x = camera.x % spacing; x < width; x += spacing) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = camera.y % spacing; y < height; y += spacing) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
}

function drawDependencies(context: CanvasRenderingContext2D, nodes: GraphNode[]) {
  for (const target of nodes) {
    for (const dependency of target.item.dependencies) {
      const source = nodes.find((node) => node.item.id === dependency);
      if (!source) continue;
      const startX = source.x + source.width;
      const startY = source.y + source.height / 2;
      const endX = target.x;
      const endY = target.y + target.height / 2;
      context.strokeStyle = "#547a63";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(startX, startY);
      context.bezierCurveTo(startX + 55, startY, endX - 55, endY, endX, endY);
      context.stroke();
      context.fillStyle = "#65c48d";
      context.beginPath();
      context.moveTo(endX, endY);
      context.lineTo(endX - 8, endY - 5);
      context.lineTo(endX - 8, endY + 5);
      context.closePath();
      context.fill();
    }
  }
}

function drawPackageNode(context: CanvasRenderingContext2D, node: GraphNode, selected: boolean) {
  const color = packageStatusColor(node.item.status);
  context.shadowColor = selected ? color : "rgba(0, 0, 0, 0.55)";
  context.shadowBlur = selected ? 15 : 8;
  context.fillStyle = "#1b211e";
  context.beginPath();
  context.roundRect(node.x, node.y, node.width, node.height, 8);
  context.fill();
  context.strokeStyle = selected ? color : "#46504b";
  context.lineWidth = selected ? 3 : 1;
  context.stroke();
  context.shadowColor = "transparent";
  context.fillStyle = color;
  context.fillRect(node.x, node.y, 5, node.height);
  context.textAlign = "left";
  context.textBaseline = "top";
  context.fillStyle = "#ecebe6";
  context.font = "600 13px SFMono-Regular, monospace";
  context.fillText(node.item.id, node.x + 17, node.y + 15);
  context.font = "600 12px Inter, sans-serif";
  context.fillText(trimText(node.item.title, 27), node.x + 17, node.y + 37);
  context.fillStyle = color;
  context.font = "600 10px Inter, sans-serif";
  context.fillText(packageStatusLabel(node.item.status).toUpperCase(), node.x + 17, node.y + 61);
  context.fillStyle = "#778078";
  context.textAlign = "right";
  context.fillText(`BATCH ${node.item.batch}`, node.x + node.width - 13, node.y + 15);
}

function PackageDetail({ item }: { item: RuntimeWorkPackage }) {
  return (
    <>
      <p className="eyebrow">
        Batch {item.batch} · {item.id}
      </p>
      <h3>{item.title}</h3>
      <span className={`package-status package-status--${item.status}`}>
        {packageStatusLabel(item.status)}
      </span>
      <p>{item.description}</p>
      <dl>
        <div>
          <dt>Dependencies</dt>
          <dd>{item.dependencies.join(", ") || "None"}</dd>
        </div>
        <div>
          <dt>Attempts</dt>
          <dd>{item.attempts}</dd>
        </div>
        <div>
          <dt>Branch</dt>
          <dd className="mono">{item.branch ?? "Not created"}</dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd className="mono">{item.headRevision?.slice(0, 10) ?? "Pending"}</dd>
        </div>
      </dl>
      {item.error ? (
        <div className="package-workbench__error" role="alert">
          <strong>Blocked</strong>
          <span>{item.error}</span>
        </div>
      ) : null}
      <section>
        <h4>Owned paths</h4>
        {item.ownedPaths.length ? (
          <ul>
            {item.ownedPaths.map((path) => (
              <li key={path} className="mono">
                {path}
              </li>
            ))}
          </ul>
        ) : (
          <p>No owned paths recorded.</p>
        )}
      </section>
      <section>
        <h4>Verification</h4>
        {item.verification.length ? (
          <ul>
            {item.verification.map((command) => (
              <li key={command} className="mono">
                {command}
              </li>
            ))}
          </ul>
        ) : (
          <p>No verification commands recorded.</p>
        )}
      </section>
    </>
  );
}

function packageStatusLabel(status: RuntimeWorkPackage["status"]) {
  if (status === "ready_for_integration") return "Ready for integration";
  return status.charAt(0).toUpperCase() + status.slice(1).replaceAll("_", " ");
}

function packageStatusColor(status: RuntimeWorkPackage["status"]) {
  if (status === "failed") return "#ed6464";
  if (status === "running") return "#5a9df5";
  if (status === "ready_for_integration" || status === "integrated") return "#65c48d";
  return "#8d938d";
}

function trimText(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}
