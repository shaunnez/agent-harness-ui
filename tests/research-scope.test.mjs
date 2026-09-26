// The scoping step (`28-SCOPE-PACK-EVAL-PLAN.md` §1): a scope is parsed strictly, drafted without
// starting anything, pinned onto every run, part of the evidence fingerprint, and a band priced in
// another measure is disputed. External requests are scoped once. A stubbed chat API only:
// nothing here calls a model.

import assert from "node:assert/strict";
import test from "node:test";
import {
  parseScope,
  pinnedScopeText,
  ResearchScoper,
  ScopeError,
} from "@eversor/research-engine/research-scope.mjs";

export const ROOF_SCOPE = Object.freeze({
  item: "Membrane roof in place of long-run steel",
  measure: "per m²",
  unitText: "m² of roof plan area",
  quantityBasis: "1,200 m² roof",
  inclusions: ["plywood substrate", "secondary framing"],
  exclusions: ["removal of existing roof"],
  centre: "Auckland",
  assumptions: ["commercial building, low pitch"],
  clarifications: ["membrane type not stated"],
});

test("a scope is one JSON object in the schema, or an error", () => {
  assert.deepEqual(parseScope(JSON.stringify(ROOF_SCOPE)), ROOF_SCOPE);
  assert.deepEqual(parseScope(`\`\`\`json\n${JSON.stringify(ROOF_SCOPE)}\n\`\`\``), ROOF_SCOPE);
  const rejects = [
    `Here is the scope: ${JSON.stringify(ROOF_SCOPE)}`,
    JSON.stringify({ ...ROOF_SCOPE, measure: "per square" }),
    JSON.stringify({ ...ROOF_SCOPE, price: 120 }),
    JSON.stringify({ ...ROOF_SCOPE, inclusions: "plywood" }),
    JSON.stringify({ ...ROOF_SCOPE, item: "  " }),
    JSON.stringify([ROOF_SCOPE]),
  ];
  for (const reply of rejects)
    assert.throws(
      () => parseScope(reply),
      (error) => error instanceof ScopeError && error.code === "scope_malformed" && error.statusCode === 422,
      reply.slice(0, 60),
    );
});

test("the pinned text names the measure and tells the run not to re-scope", () => {
  const text = pinnedScopeText(ROOF_SCOPE);
  assert.match(text, /^Pinned scope\. Price exactly this; do not re-scope it\./);
  assert.match(text, /- Measure: per m² \(m² of roof plan area\)\. Give the band in this measure\./);
  assert.match(text, /- Not decided \(state the assumption you price on\): membrane type not stated/);
});

/** A chat-completions endpoint that answers with `content`, recording each request. */
function chatApi(content, { status = 200 } = {}) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(
      status === 200
        ? JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 9 } })
        : "down",
      { status },
    );
  };
  return { requests, fetchImpl };
}

test("the scope call is one tools-less DeepSeek chat, on the API loop's key, and says who scoped it", async () => {
  const api = chatApi(JSON.stringify(ROOF_SCOPE));
  const env = { OPENCODE_API_KEY: "sk-test-scope" };
  const scoped = await new ResearchScoper({ env, fetchImpl: api.fetchImpl }).scope({ objective: "Roof?" });
  assert.deepEqual(scoped.scope, ROOF_SCOPE);
  assert.deepEqual(scoped.scopedBy, {
    runtime: "api-loop",
    model: "opencode-go/deepseek-v4.1-flash",
    reasoning: null,
  });
  assert.equal(api.requests.length, 1);
  assert.equal(api.requests[0].url, "https://opencode.ai/zen/go/v1/chat/completions");
  assert.equal(api.requests[0].headers.Authorization, "Bearer sk-test-scope");
  assert.equal(api.requests[0].body.model, "deepseek-v4.1-flash");
  assert.equal("tools" in api.requests[0].body, false);
  assert.equal(api.requests[0].body.messages[1].content, "Roof?");
});

test("a scoper with no key, or a reply that is not a scope, is an error, never a guess", async () => {
  await assert.rejects(
    new ResearchScoper({ env: {}, fetchImpl: chatApi("{}").fetchImpl }).scope({ objective: "Roof?" }),
    {
      code: "scope_unavailable",
      statusCode: 503,
    },
  );
  const env = { OPENCODE_API_KEY: "sk-test-scope" };
  await assert.rejects(
    new ResearchScoper({ env, fetchImpl: chatApi("The roof is about $120 a square metre.").fetchImpl }).scope(
      {
        objective: "Roof?",
      },
    ),
    { code: "scope_malformed" },
  );
  await assert.rejects(
    new ResearchScoper({ env, fetchImpl: chatApi("{}").fetchImpl }).scope({ objective: "  " }),
    {
      code: "scope_empty",
    },
  );
});
