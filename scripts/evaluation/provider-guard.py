#!/usr/bin/env python3
"""Protect grader files and count every CLI model call, including adapter probes.

No prompts, tool contents, environment values or credentials are retained.
"""
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
import uuid

config_path, provider, *args = sys.argv[1:]
config = json.loads(Path(config_path).read_text())
cli = config["executables"][provider]
model = args[args.index("--model") + 1] if "--model" in args else None
if not model:
    os.execv(cli, [cli, *args])
ledger_path = Path(config["ledger"])
lock_path = ledger_path.with_suffix(".lock")
invocation_id = str(uuid.uuid4())
started = time.time()


def update(change):
    with lock_path.open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        ledger = json.loads(ledger_path.read_text())
        result = change(ledger)
        temp = ledger_path.with_suffix(".new")
        temp.write_text(json.dumps(ledger, indent=2) + "\n")
        temp.replace(ledger_path)
        return result


def reserve(ledger):
    prior = ledger["invocations"]
    settled = [entry for entry in prior if entry.get("endedAt")]
    if any(entry.get("totalTokens") is None for entry in settled):
        raise RuntimeError("Missing prior provider usage; refusing another invocation")
    tokens = sum(entry.get("totalTokens") or 0 for entry in prior)
    if started >= ledger["deadline"] or len(prior) >= config["maxProviderInvocations"] or tokens >= config["maxTotalTokens"]:
        raise RuntimeError("Evaluation provider allowance exhausted")
    prior.append({"id": invocation_id, "provider": provider, "model": model, "startedAt": started,
                  "endedAt": None, "totalTokens": None, "usage": None})
    return ledger["deadline"] - started


def native_args(arguments):
    denied = config["deniedReadPaths"]
    if not denied:
        raise RuntimeError("Evaluation requires protected reference paths")
    arguments = list(arguments)
    if provider == "codex":
        position = arguments.index("--sandbox")
        posture = arguments[position + 1]
        parent = {"read-only": ":read-only", "workspace-write": ":workspace"}[posture]
        del arguments[position:position + 2]
        if any("sandbox_workspace_write" in arg or "sandbox_mode" in arg for arg in arguments):
            raise RuntimeError("Legacy sandbox overrides cannot mix with evaluation permissions")
        paths = ",".join(json.dumps(entry) + '="deny"' for entry in denied)
        profile = '{extends=' + json.dumps(parent) + ',filesystem={' + paths + '},network={enabled=false}}'
        arguments[1:1] = ["-c", 'default_permissions="evaluation"', "-c", "permissions.evaluation=" + profile]
    elif provider == "claude":
        position = arguments.index("--settings") + 1
        settings = json.loads(arguments[position])
        sandbox = settings["sandbox"]
        if sandbox.get("enabled") is not True or sandbox.get("failIfUnavailable") is not True:
            raise RuntimeError("Claude evaluation requires its existing enforced sandbox")
        filesystem = sandbox["filesystem"]
        filesystem["denyRead"] = list(dict.fromkeys(filesystem.get("denyRead", []) + denied))
        rules = settings.setdefault("permissions", {}).setdefault("deny", [])
        rules.extend("Read(/" + entry + "/**)" for entry in denied)
        arguments[position] = json.dumps(settings)
    else:
        raise RuntimeError("Unsupported evaluation provider")
    return arguments


# Real provider CLIs must apply one native sandbox. Wrapping the CLI in Seatbelt
# prevents its own tool sandbox from starting on macOS. The command-only mode is
# exclusively for synthetic CLI fixtures that do not start another sandbox.
if config.get("confinement") == "native-provider":
    command = [cli, *native_args(args)]
elif config.get("confinement") == "command-only":
    command = ["/usr/bin/sandbox-exec", "-f", config["profile"], cli, *args]
else:
    raise RuntimeError("An explicit evaluation confinement mode is required")
try:
    remaining = update(reserve)
except Exception as error:
    print(str(error), file=sys.stderr)
    sys.exit(75)
child_cwd = args[args.index("--cd") + 1] if "--cd" in args else os.getcwd()
child = None
usage = None
reported_cost = None
model_usage = None
ended_reason = "completed"


def stop(signum=None, frame=None):
    global ended_reason
    ended_reason = "deadline" if signum is None else "interrupted"
    if child and child.poll() is None:
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        def force_stop():
            if child.poll() is None:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        timer = threading.Timer(1.0, force_stop)
        timer.daemon = True
        timer.start()


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
return_code = 1
try:
    child = subprocess.Popen(command, cwd=child_cwd, stdin=sys.stdin, stdout=subprocess.PIPE, stderr=sys.stderr, start_new_session=True)
    deadline_timer = threading.Timer(remaining, stop)
    deadline_timer.daemon = True
    deadline_timer.start()
    for line in child.stdout:
        sys.stdout.buffer.write(line)
        sys.stdout.buffer.flush()
        try:
            event = json.loads(line)
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        if not isinstance(event, dict):
            continue
        raw = event.get("usage")
        if event.get("type") == "turn.completed" and isinstance(raw, dict):
            usage = {"inputTokens": raw.get("input_tokens", 0), "cachedInputTokens": raw.get("cached_input_tokens", 0), "outputTokens": raw.get("output_tokens", 0)}
        elif event.get("type") == "result" and isinstance(raw, dict):
            cached = raw.get("cache_read_input_tokens", 0)
            writes = raw.get("cache_creation_input_tokens", 0)
            usage = {"inputTokens": raw.get("input_tokens", 0) + cached + writes, "cachedInputTokens": cached, "cacheWriteTokens": writes, "outputTokens": raw.get("output_tokens", 0)}
            reported_cost = event.get("total_cost_usd")
            model_usage = event.get("modelUsage")
    return_code = child.wait()
    deadline_timer.cancel()
finally:
    if child and child.poll() is None:
        stop(signal.SIGTERM)
        child.wait(timeout=5)
    def finish(ledger):
        entry = next(entry for entry in ledger["invocations"] if entry["id"] == invocation_id)
        entry.update({"endedAt": time.time(), "exitCode": return_code, "endReason": ended_reason,
                      "usage": usage, "reportedCost": reported_cost, "modelUsage": model_usage,
                      "totalTokens": None if usage is None else usage["inputTokens"] + usage["outputTokens"]})
    update(finish)
sys.exit(return_code if return_code >= 0 else 128 - return_code)
