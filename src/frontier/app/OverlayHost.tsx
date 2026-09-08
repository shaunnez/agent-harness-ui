import { type ReactNode, useState } from "react";
import type { NewTaskDraft, RuntimeRun } from "../../domain";
import type { FrontierSnapshot, TaskSummary } from "../runtime/contracts";
import type { RefreshCoordinator } from "../runtime/coordinator";
import { attentionFor } from "../runtime/presentation";
import { Modal } from "../ui/Modal";
import { ArtifactViewer } from "../views/ArtifactViewer";
import { CandidateDiff } from "../views/CandidateDiff";
import { Grill } from "../views/Grill";
import { NewTask } from "../views/NewTask";
import { ProjectSetup } from "../views/ProjectSetup";
import { Projects } from "../views/Projects";
import { TaskJournal } from "../views/TaskJournal";
import { TaskLifecycle } from "../views/TaskLifecycle";
import { TaskPanel } from "../views/TaskPanel";
import { TaskPolicies } from "../views/TaskPolicies";
import { WorldSettings } from "../views/WorldSettings";
import { ExecutionSettings } from "../views/ExecutionSettings";
import { RunLibrary } from "../views/RunLibrary";
import { Skills } from "../views/Skills";
import { Usage } from "../views/Usage";
import type { WorldPreferences } from "./preferences";
import type { Overlay } from "./routes";

export type { Overlay } from "./routes";

const titles = {
  tasks: "Task journal",
  "new-task": "New task",
  settings: "Execution settings",
  "world-settings": "World & connection",
  agents: "Agents",
  skills: "Skills & role policies",
  usage: "Usage & run history",
  task: "Task command",
  grill: "Decision room",
  findings: "Review findings",
  artifact: "Retained evidence",
  approve: "Review specification",
  projects: "Projects",
  "project-setup": "Project setup",
  "task-policies": "Task role policies",
  lifecycle: "Manage task",
  diff: "Exact candidate diff",
};
interface Props {
  stack: Overlay[];
  snapshot: FrontierSnapshot;
  scopedTasks: TaskSummary[];
  runtime: RefreshCoordinator;
  draft: NewTaskDraft;
  setDraft(value: NewTaskDraft): void;
  preferences: WorldPreferences;
  onPreferences(value: WorldPreferences): void;
  readWorldHour?(): number | undefined;
  busy: boolean;
  error: string | null;
  run?: RuntimeRun;
  open(overlay: Overlay): void;
  close(): void;
  back(): void;
  inspect(id: string, kind?: "task" | "grill" | "findings"): void;
  locate(id: string): void;
  watch(id: string, runId?: string | null): void;
  create(): void;
  enterProject(id: string): void;
  command(action: () => Promise<unknown>, then?: () => void): Promise<void>;
}
export function OverlayHost(props: Props) {
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const { stack, snapshot, runtime, busy, error, run, open, close, back, inspect, watch, command } = props;
  const overlay = stack.at(-1);
  if (!overlay) return null;
  const task = snapshot.selected?.core;
  const matches = task && "taskId" in overlay && task.id === overlay.taskId;
  const connected = snapshot.connection === "connected";
  const fixture = runtime.gateway.mode === "fixture";
  let content: ReactNode;
  if (overlay.kind === "tasks")
    content = (
      <TaskJournal
        key={overlay.projectId ?? "all"}
        tasks={snapshot.tasks}
        projects={snapshot.projects}
        initialProject={overlay.projectId}
        onInspect={(id) => inspect(id)}
        onLocate={props.locate}
        onNew={() => open({ kind: "new-task" })}
      />
    );
  else if (overlay.kind === "projects")
    content = (
      <Projects
        projects={snapshot.projects}
        tasks={snapshot.tasks}
        onAdd={() => open({ kind: "project-setup" })}
        onManage={(projectId) => open({ kind: "project-setup", projectId })}
        onEnter={props.enterProject}
        onTasks={(projectId) => open({ kind: "tasks", projectId })}
      />
    );
  else if (overlay.kind === "project-setup")
    content =
      overlay.projectId && !snapshot.projects.some((project) => project.id === overlay.projectId) ? (
        <div className="overlay-body">
          <p>This project is not registered in the current runtime.</p>
          <button type="button" onClick={back}>
            Back
          </button>
        </div>
      ) : (
        <ProjectSetup
          key={overlay.projectId ?? "new"}
          project={snapshot.projects.find((project) => project.id === overlay.projectId)}
          gateway={runtime.gateway}
          connected={connected}
          busy={busy}
          error={error}
          command={command}
          onDone={back}
          onClose={back}
        />
      );
  else if (overlay.kind === "new-task")
    content = (
      <NewTask
        projects={snapshot.projects}
        draft={props.draft}
        setDraft={props.setDraft}
        status={snapshot.status}
        error={error}
        busy={busy}
        connected={connected}
        onCreate={props.create}
        onClose={close}
        onAddProject={() => open({ kind: "project-setup" })}
      />
    );
  else if (overlay.kind === "settings")
    content = (
      <ExecutionSettings
        status={snapshot.status}
        gateway={runtime.gateway}
        busy={busy}
        connected={connected}
        error={error}
        command={command}
        onWorld={() => open({ kind: "world-settings" })}
        onRefresh={() => runtime.retry()}
      />
    );
  else if (overlay.kind === "agents")
    content = (
      <RunLibrary
        tasks={snapshot.tasks}
        projects={snapshot.projects}
        status={snapshot.status}
        gateway={runtime.gateway}
        connected={connected}
        now={snapshot.updatedAt ?? Date.now()}
        onWatch={watch}
        onTask={inspect}
        onSkills={(role) => open({ kind: "skills", role })}
      />
    );
  else if (overlay.kind === "skills")
    content = (
      <Skills
        key={overlay.role ?? "all"}
        initialRole={overlay.role}
        tasks={snapshot.tasks}
        status={snapshot.status}
        gateway={runtime.gateway}
        busy={busy}
        connected={connected}
        error={error}
        command={command}
        onSettings={() => open({ kind: "settings" })}
        onTask={inspect}
      />
    );
  else if (overlay.kind === "usage")
    content = (
      <Usage
        tasks={snapshot.tasks}
        projects={snapshot.projects}
        gateway={runtime.gateway}
        connected={connected}
        now={snapshot.updatedAt ?? Date.now()}
        onTask={inspect}
        onWatch={watch}
      />
    );
  else if (overlay.kind === "world-settings")
    content = (
      <WorldSettings
        readWorldHour={props.readWorldHour}
        preferences={props.preferences}
        onChange={props.onPreferences}
        snapshot={snapshot}
        mode={runtime.gateway.mode}
        onRetry={() => runtime.retry()}
        gateway={runtime.gateway}
        connected={connected}
        busy={busy}
        error={error}
        command={command}
        onExecution={() => open({ kind: "settings" })}
        onAddProject={() => open({ kind: "project-setup" })}
      />
    );
  else if (overlay.kind === "diff")
    content = (
      <CandidateDiff
        gateway={runtime.gateway}
        taskId={overlay.taskId}
        candidateId={overlay.candidateId}
        revision={overlay.revision}
        headRevision={overlay.headRevision}
      />
    );
  else if (overlay.kind === "artifact")
    content = (
      <ArtifactViewer gateway={runtime.gateway} taskId={overlay.taskId} artifactId={overlay.artifactId} />
    );
  else if (!matches || !snapshot.selected)
    content = (
      <div className="overlay-body">
        <p>{snapshot.selectedError ?? "Loading current task and evidence…"}</p>
        {snapshot.selectedError && (
          <button type="button" onClick={() => runtime.retry()}>
            Retry task
          </button>
        )}
      </div>
    );
  else if (overlay.kind === "task-policies")
    content = (
      <TaskPolicies
        evidence={snapshot.selected}
        status={snapshot.status}
        busy={busy}
        connected={connected}
        fixture={fixture}
        onMore={(kind) => void runtime.more(kind)}
        error={error}
        onSave={(role, policy, done) =>
          command(() => runtime.gateway.updateRole(task.id, role, policy), done)
        }
      />
    );
  else if (overlay.kind === "lifecycle")
    content = (
      <TaskLifecycle
        task={task}
        gateway={runtime.gateway}
        busy={busy}
        connected={connected}
        error={error}
        command={command}
        onDone={back}
      />
    );
  else if (overlay.kind === "grill")
    content = (
      <Grill
        key={task.id}
        task={task}
        busy={busy}
        error={error}
        connected={connected}
        answers={answerDrafts}
        onDraft={(key, value) => setAnswerDrafts((current) => ({ ...current, [key]: value }))}
        onAnswer={(qid, answer) => void command(() => runtime.gateway.answer(task.id, qid, answer))}
        onFinish={(acceptRemaining) =>
          void command(
            () => runtime.gateway.finishGrill(task.id, acceptRemaining),
            () => inspect(task.id),
          )
        }
        onArtifact={(id) => open({ kind: "artifact", taskId: task.id, artifactId: id })}
      />
    );
  else
    content = (
      <TaskPanel
        key={task.id + overlay.kind + (overlay.stage ?? "")}
        evidence={snapshot.selected}
        initialStage={
          overlay.stage ??
          (overlay.kind === "approve"
            ? "specification"
            : overlay.kind === "findings"
              ? task.currentStage
              : undefined)
        }
        run={run}
        busy={busy}
        error={error}
        connected={connected}
        gateway={runtime.gateway}
        command={command}
        onDiff={(candidate) =>
          candidate.headRevision &&
          open({
            kind: "diff",
            taskId: task.id,
            candidateId: candidate.id,
            revision: candidate.revisionNumber,
            headRevision: candidate.headRevision,
          })
        }
        onMore={(kind) => void runtime.more(kind)}
        onContinue={(id) => inspect(id)}
        onAction={() => inspect(task.id, "grill")}
        onWatch={(id) => watch(task.id, id ?? run?.id)}
        onArtifact={(id) => open({ kind: "artifact", taskId: task.id, artifactId: id })}
        onPolicies={() => open({ kind: "task-policies", taskId: task.id })}
        onManage={() => open({ kind: "lifecycle", taskId: task.id })}
      />
    );
  return (
    <Modal
      focusKey={`${overlay.kind}:${"taskId" in overlay ? overlay.taskId : ""}:${"artifactId" in overlay ? overlay.artifactId : ""}`}
      title={
        overlay.kind === "findings" && task && attentionFor(task).kind !== "repair"
          ? "Execution needs attention"
          : titles[overlay.kind]
      }
      onClose={close}
      onBack={stack.length > 1 ? back : undefined}
      className={`overlay-${overlay.kind}`}
    >
      {!connected && (
        <p className="connection-notice" role="alert">
          Connection lost. Your draft is kept here; commands will be available after reconnecting.
        </p>
      )}
      {fixture && (
        <p className="sample-mode-banner">
          Sample world · Demonstration records and actions stay in this tab.
        </p>
      )}
      {content}
    </Modal>
  );
}
