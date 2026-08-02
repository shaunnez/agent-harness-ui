import { ArrowLeft, CaretDown, Check, CheckCircle, DotsThree, Pause, Play, X } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { baseEvents, type HarnessEvent, type TaskRunState, workflowStages } from "../domain";
import { LiveRun } from "./LiveRun";
import { Button, PriorityBadge, StateBadge } from "./Primitives";
import { StageView } from "./StageViews";

type DemoState = "active" | "grill" | "failed" | "blocked" | "completed";

export function TaskWorkspace({
  initialStage = 5,
  taskId = "GH-241",
  taskTitle,
  taskDescription,
  taskPriority,
  onBack,
}: {
  initialStage?: number;
  taskId?: string;
  taskTitle: string;
  taskDescription: string;
  taskPriority: "low" | "medium" | "high";
  onBack: () => void;
}) {
  const [activeStageIndex, setActiveStageIndex] = useState(initialStage);
  const [viewedStageIndex, setViewedStageIndex] = useState(initialStage);
  const [runState, setRunState] = useState<TaskRunState>(initialStage === 0 ? "running" : "running");
  const [attempts, setAttempts] = useState(1);
  const [candidateVersion, setCandidateVersion] = useState(1);
  const [testResult, setTestResult] = useState<"running" | "passed" | "failed">("running");
  const [selectedEvent, setSelectedEvent] = useState<HarnessEvent | undefined>(baseEvents[3]);
  const [toast, setToast] = useState<string | null>(null);
  const demoControlsRef = useRef<HTMLDetailsElement>(null);

  const inspectStage = (nextIndex: number) => {
    setViewedStageIndex(nextIndex);
    setSelectedEvent(undefined);
  };

  const activateStage = (nextIndex: number) => {
    setActiveStageIndex(nextIndex);
    setViewedStageIndex(nextIndex);
    setSelectedEvent(undefined);
    if (nextIndex === 2) setRunState("needs-input");
    else if (nextIndex === 9) setRunState("awaiting-approval");
    else setRunState("running");
    if (nextIndex === 7) setTestResult("running");
  };

  const advance = () => {
    if (viewedStageIndex !== activeStageIndex) {
      setToast("This is recorded history; return to the current stage to continue");
      return;
    }
    setToast(null);
    activateStage(Math.min(9, activeStageIndex + 1));
  };

  const applyDemo = (demo: DemoState) => {
    setToast(null);
    demoControlsRef.current?.removeAttribute("open");
    if (demo === "active") {
      setActiveStageIndex(5);
      setViewedStageIndex(5);
      setRunState("running");
      setAttempts(1);
      setCandidateVersion(1);
      setTestResult("running");
    }
    if (demo === "grill") {
      setActiveStageIndex(2);
      setViewedStageIndex(2);
      setRunState("needs-input");
      setAttempts(1);
      setCandidateVersion(1);
      setTestResult("running");
    }
    if (demo === "failed") {
      setActiveStageIndex(7);
      setViewedStageIndex(7);
      setRunState("failed");
      setAttempts(2);
      setCandidateVersion(1);
      setTestResult("failed");
    }
    if (demo === "blocked") {
      setActiveStageIndex(7);
      setViewedStageIndex(7);
      setRunState("blocked");
      setAttempts(3);
      setCandidateVersion(2);
      setTestResult("failed");
    }
    if (demo === "completed") {
      setActiveStageIndex(9);
      setViewedStageIndex(9);
      setRunState("awaiting-approval");
      setAttempts(3);
      setCandidateVersion(2);
      setTestResult("passed");
    }
    setSelectedEvent(undefined);
  };

  const sendRepair = () => {
    if (attempts >= 3) {
      setRunState("blocked");
      return;
    }
    setAttempts((value) => value + 1);
    setCandidateVersion((value) => value + 1);
    setActiveStageIndex(5);
    setViewedStageIndex(5);
    setRunState("repairing");
    setTestResult("running");
    setToast("Repair packet routed to Implement");
  };

  const retryTest = () => {
    setRunState("running");
    setTestResult("running");
    setToast("Deterministic test gate reset");
  };
  const failTest = () => {
    setTestResult("failed");
    setRunState(attempts >= 3 ? "blocked" : "failed");
  };
  const passTest = () => {
    setTestResult("passed");
    setRunState("running");
    setToast("All deterministic gates passed");
  };
  const resume = () => {
    setAttempts(2);
    setCandidateVersion((value) => value + 1);
    setActiveStageIndex(5);
    setViewedStageIndex(5);
    setRunState("repairing");
    setTestResult("running");
    setToast("One repair attempt granted by human");
  };

  const statusState = runState === "repairing" ? "running" : runState;
  const progress = activeStageIndex + 1;
  const candidateId = `C${candidateVersion}`;
  const candidateSha = candidateVersion === 1 ? "a16f29d" : candidateVersion === 2 ? "f3b90c8" : "bd29170";

  return (
    <div className="task-workspace">
      <header className="task-header">
        <button
          type="button"
          className="icon-button task-header__back"
          onClick={onBack}
          aria-label="Back to tasks"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="task-title-block">
          <span className="mono task-id">GH-241</span>
          <h1>{taskTitle}</h1>
        </div>
        <PriorityBadge priority={taskPriority} />
        <div className="task-header__meta">
          <StateBadge state={statusState} />
          <span>
            <small>Candidate</small>
            <strong>{candidateId}</strong>
          </span>
          <span>
            <small>Stage</small>
            <strong>{progress} / 10</strong>
          </span>
          <span>
            <small>Stage run</small>
            <strong>{attempts} / 3</strong>
          </span>
        </div>
        <div className="task-header__actions">
          <Button
            tone="secondary"
            compact
            icon={runState === "paused" ? Play : Pause}
            onClick={() => setRunState(runState === "paused" ? "running" : "paused")}
          >
            {runState === "paused" ? "Resume" : "Pause"}
          </Button>
          <Button
            tone="danger"
            compact
            icon={X}
            onClick={() => setToast("Cancel is visual-only in this prototype")}
          >
            Cancel
          </Button>
        </div>
      </header>

      <nav className="stage-navigator" aria-label="Workflow stages">
        {workflowStages.map((stage, index) => {
          const complete = index < activeStageIndex || runState === "completed";
          const active = index === activeStageIndex;
          const selected = index === viewedStageIndex;
          const failed = active && (runState === "failed" || runState === "blocked");
          return (
            <button
              type="button"
              key={stage.id}
              className={`stage-step ${complete ? "stage-step--complete" : ""} ${active ? "stage-step--active" : ""} ${selected ? "stage-step--selected" : ""} ${failed ? "stage-step--failed" : ""}`}
              onClick={() => inspectStage(index)}
              aria-current={selected ? "step" : undefined}
              aria-label={`${stage.label}${active ? ", current execution stage" : ""}${selected ? ", selected" : ""}`}
            >
              <span className="stage-step__node">
                {complete ? (
                  <Check size={14} weight="bold" />
                ) : failed ? (
                  <X size={14} weight="bold" />
                ) : (
                  index + 1
                )}
              </span>
              <span>
                <strong>{stage.shortLabel}</strong>
                <small>
                  {active
                    ? index === 2
                      ? "2 open"
                      : index === 7
                        ? `${attempts} / 3`
                        : "current"
                    : complete
                      ? "done"
                      : "—"}
                </small>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="workspace-scroll">
        <div className="workspace-grid">
          <StageView
            stageIndex={viewedStageIndex}
            activeStageIndex={activeStageIndex}
            runState={runState}
            attempts={attempts}
            testResult={testResult}
            taskId={taskId}
            taskTitle={taskTitle}
            taskDescription={taskDescription}
            selectedEvent={selectedEvent}
            candidateId={candidateId}
            candidateSha={candidateSha}
            onAdvance={advance}
            onAnswerComplete={() => {
              if (viewedStageIndex !== activeStageIndex) {
                setToast("This historical Grill session is read-only");
                return;
              }
              setRunState("running");
              setActiveStageIndex(3);
              setViewedStageIndex(3);
              setToast("Shared understanding confirmed; specification can now be synthesized");
            }}
            onSendRepair={sendRepair}
            onRetryTest={retryTest}
            onFailTest={failTest}
            onPassTest={passTest}
            onMarkBlocked={() => {
              setActiveStageIndex(7);
              setViewedStageIndex(7);
              setRunState("blocked");
            }}
            onResume={resume}
            onApprove={() => {
              setRunState("completed");
              setToast(`${candidateId} approved and merged into main`);
            }}
          />
        </div>
        <LiveRun
          onSelectEvent={setSelectedEvent}
          selectedEventId={selectedEvent?.id}
          stageLabel={workflowStages[activeStageIndex]?.shortLabel ?? "Triage"}
          candidateId={candidateId}
          runState={runState}
        />
      </div>

      <footer className="workspace-footer">
        <span>
          <small>Elapsed</small>
          <strong className="mono">18m 06s</strong>
        </span>
        <span>
          <small>Tokens</small>
          <strong className="mono">44.2k</strong>
        </span>
        <span>
          <small>Cache</small>
          <strong className="mono text-green">76%</strong>
        </span>
        <span>
          <small>Active stage run</small>
          <strong className="mono">{attempts}</strong>
        </span>
        <span className="workspace-footer__usage">
          <small>Model usage</small>
          <i className="provider-dot provider-dot--codex" />
          Codex 32.1k
          <i className="provider-dot provider-dot--claude" />
          Claude 12.1k
        </span>
        <span>
          <small>Approx. cost</small>
          <strong className="mono">$1.18</strong>
        </span>
        <details ref={demoControlsRef} className="demo-controls demo-controls--footer">
          <summary aria-label="Open prototype states">
            <DotsThree size={17} />
            <span>Prototype states</span>
            <CaretDown size={12} />
          </summary>
          <div className="demo-menu">
            <span>Prototype only</span>
            <button type="button" onClick={() => applyDemo("active")}>
              <Play size={15} /> Active workflow
            </button>
            <button type="button" onClick={() => applyDemo("grill")}>
              <Check size={15} /> Grill with docs
            </button>
            <button type="button" onClick={() => applyDemo("failed")}>
              <X size={15} /> Failing test
            </button>
            <button type="button" onClick={() => applyDemo("blocked")}>
              <Pause size={15} /> Blocked
            </button>
            <button type="button" onClick={() => applyDemo("completed")}>
              <CheckCircle size={15} /> Awaiting approval
            </button>
          </div>
        </details>
      </footer>

      {toast ? (
        <button type="button" className="toast" onClick={() => setToast(null)}>
          <CheckCircle size={17} weight="fill" />
          {toast}
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}
