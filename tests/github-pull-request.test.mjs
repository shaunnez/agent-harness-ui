import assert from "node:assert/strict";
import test from "node:test";
import {
  GitHubPullRequestManager,
  parseGitHubRepository,
  pullRequestBranch,
} from "../server/github-pull-request.mjs";

const baseRevision = "a".repeat(40);
const headRevision = "b".repeat(40);
const task = { id: "AH-042", title: "Raise exact candidate PR" };
const candidate = {
  id: "C1",
  revisionNumber: 3,
  baseRevision,
  headRevision,
  baseBranch: "main",
  repositoryRoot: "/repository",
  worktreePath: "/worktree",
};

test("parses supported GitHub remotes and derives a revision-bound branch", () => {
  assert.equal(parseGitHubRepository("https://github.com/acme/widgets.git"), "acme/widgets");
  assert.equal(parseGitHubRepository("git@github.com:acme/widgets.git"), "acme/widgets");
  assert.equal(parseGitHubRepository("ssh://git@github.com/acme/widgets.git"), "acme/widgets");
  assert.throws(() => parseGitHubRepository("https://gitlab.com/acme/widgets.git"), /not a supported GitHub/i);
  assert.equal(pullRequestBranch(task, candidate), `agent-harness/ah-042-c1-r3-${headRevision.slice(0, 8)}`);
});

test("pushes the exact candidate and idempotently creates one matching PR", async () => {
  const calls = [];
  let created = false;
  const headBranch = pullRequestBranch(task, candidate);
  const pullRequest = {
    number: 84,
    url: "https://github.com/acme/widgets/pull/84",
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    baseRefOid: baseRevision,
    headRefName: headBranch,
    headRefOid: headRevision,
    mergedAt: null,
    closedAt: null,
    mergeCommit: null,
  };
  const manager = new GitHubPullRequestManager({
    run: async (command, args, options = {}) => {
      calls.push({ command, args, cwd: options.cwd });
      if (command === "git" && args.join(" ") === "remote get-url origin") {
        return { stdout: "https://github.com/acme/widgets.git\n", stderr: "" };
      }
      if (command === "git" && args[0] === "ls-remote") {
        const ref = args.at(-1);
        const revision = ref === "refs/heads/main" ? baseRevision : headRevision;
        return { stdout: `${revision}\t${ref}\n`, stderr: "" };
      }
      if (command === "git" && args[0] === "push") return { stdout: "", stderr: "" };
      if (command === "gh" && args[1] === "list") {
        return { stdout: JSON.stringify(created ? [pullRequest] : []), stderr: "" };
      }
      if (command === "gh" && args[1] === "create") {
        created = true;
        return { stdout: `${pullRequest.url}\n`, stderr: "" };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  });

  const result = await manager.publish({ task, candidate, intent: { note: "Ship it." } });
  assert.equal(result.number, 84);
  assert.equal(result.state, "open");
  assert.equal(result.headRevision, headRevision);
  assert.ok(calls.some((call) => call.command === "git" && call.args.includes(`${headRevision}:refs/heads/${headBranch}`)));
  const create = calls.find((call) => call.command === "gh" && call.args[1] === "create");
  assert.ok(create);
  assert.match(create.args[create.args.indexOf("--body") + 1], /Ship it/);
  assert.equal(create.cwd, candidate.worktreePath);
});

test("fails closed before push when the GitHub target advanced", async () => {
  let pushed = false;
  const manager = new GitHubPullRequestManager({
    run: async (command, args) => {
      if (command === "git" && args.join(" ") === "remote get-url origin") {
        return { stdout: "git@github.com:acme/widgets.git\n", stderr: "" };
      }
      if (command === "git" && args[0] === "ls-remote") {
        return { stdout: `${"c".repeat(40)}\trefs/heads/main\n`, stderr: "" };
      }
      if (command === "git" && args[0] === "push") pushed = true;
      throw new Error("unexpected command");
    },
  });
  await assert.rejects(
    () => manager.publish({ task, candidate }),
    (error) => error.code === "GITHUB_TARGET_DIVERGED" && error.targetRevision === "c".repeat(40),
  );
  assert.equal(pushed, false);
});

test("rejects a PR whose head moved away from the approved SHA", async () => {
  const headBranch = pullRequestBranch(task, candidate);
  const manager = new GitHubPullRequestManager({
    run: async () => ({
      stdout: JSON.stringify({
        number: 84,
        url: "https://github.com/acme/widgets/pull/84",
        state: "OPEN",
        baseRefName: "main",
        baseRefOid: baseRevision,
        headRefName: headBranch,
        headRefOid: "d".repeat(40),
        mergedAt: null,
        closedAt: null,
        mergeCommit: null,
      }),
      stderr: "",
    }),
  });
  await assert.rejects(() => manager.inspect({
    repository: "acme/widgets",
    number: 84,
    targetBranch: "main",
    headBranch,
    headRevision,
  }), /head moved away/i);
});

test("fetches a moved GitHub target without updating the local target branch", async () => {
  const targetRevision = "c".repeat(40);
  const calls = [];
  const manager = new GitHubPullRequestManager({
    run: async (command, args) => {
      calls.push({ command, args });
      if (command === "git" && args[0] === "ls-remote") {
        return { stdout: `${targetRevision}\trefs/heads/main\n`, stderr: "" };
      }
      if (command === "git" && args[0] === "fetch") return { stdout: "", stderr: "" };
      if (command === "git" && args.join(" ") === "rev-parse FETCH_HEAD") {
        return { stdout: `${targetRevision}\n`, stderr: "" };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  });
  assert.equal(await manager.fetchTarget(candidate), targetRevision);
  assert.ok(calls.some((call) => call.args.join(" ") === "fetch --no-tags origin refs/heads/main"));
  assert.equal(calls.some((call) => call.args.includes("refs/heads/main:refs/heads/main")), false);
});
