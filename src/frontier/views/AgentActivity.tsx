import { useLayoutEffect, useRef, useState } from "react";
import type { RuntimeEvent, RuntimeRun } from "../../domain";
import { activityScroll } from "../runtime/agent-activity";

export function AgentActivity({
  events,
  run,
  more,
  onMore,
}: {
  events: RuntimeEvent[];
  run?: RuntimeRun;
  more: boolean;
  onMore(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const previous = useRef({ first: "", last: "", height: 0 });
  const [unread, setUnread] = useState(false);
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const first = events[0]?.id ?? "";
    const last = events.at(-1)?.id ?? "";
    const old = previous.current;
    const earlier = old.first !== first && old.last === last;
    element.scrollTop = activityScroll({
      following: following.current,
      previousHeight: old.height,
      height: element.scrollHeight,
      top: element.scrollTop,
      earlier,
    });
    if (old.last && old.last !== last && !following.current) setUnread(true);
    previous.current = { first, last, height: element.scrollHeight };
    setOverflow(element.scrollHeight > element.clientHeight + 2);
  }, [events]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setOverflow(element.scrollHeight > element.clientHeight + 2));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="agent-activity-frame">
      <div
        ref={ref}
        className="agent-evidence scroll-region"
        role="tabpanel"
        id="agent-activity"
        aria-labelledby="agent-tab-activity"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The reading region must support keyboard scrolling.
        tabIndex={0}
        onScroll={(event) => {
          const element = event.currentTarget;
          following.current = element.scrollHeight - element.clientHeight - element.scrollTop < 24;
          if (following.current) setUnread(false);
        }}
      >
        {more && (
          <button type="button" onClick={onMore}>
            Load earlier activity
          </button>
        )}
        {events.length ? (
          <ol className="activity-list">
            {events.map((event) => (
              <li key={event.id} data-event-id={event.id}>
                <time dateTime={event.at}>
                  {new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </time>
                <div>
                  <strong>{event.title}</strong>
                  <p>{event.detail}</p>
                  {!event.runId && <small>Stage activity · not bound to this run</small>}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="quiet">
            No recorded activity is loaded for this run. Events may arrive when the run finishes.
          </p>
        )}
        {!!run?.toolCalls.length && (
          <section className="agent-tools">
            <h3>Recorded tools</h3>
            {run.toolCalls.map((tool, index) => (
              <details key={tool.id ?? `${tool.name}:${index}`}>
                <summary>
                  {tool.name} · {tool.phase}
                  {tool.commandFailed ? " · failed" : ""}
                </summary>
                <pre>{tool.result ?? "No result payload recorded."}</pre>
              </details>
            ))}
          </section>
        )}
      </div>
      {unread ? (
        <button
          type="button"
          className="new-activity"
          onClick={() => {
            if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
            following.current = true;
            setUnread(false);
          }}
        >
          New activity ↓
        </button>
      ) : (
        overflow && (
          <span className="scroll-cue" aria-hidden="true">
            Scroll to read activity ↕
          </span>
        )
      )}
    </div>
  );
}
