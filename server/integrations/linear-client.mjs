export const LINEAR_SCOPES = "read,write,app:mentionable";

// Credentials stay in the companion process. Never persist tokens in task records or API responses.
export function createLinearClient({ clientId, clientSecret, fetchImpl = fetch }) {
  let token = null;
  let expiresAt = 0;
  async function accessToken() {
    if (token && expiresAt > Date.now() + 60_000) return token;
    const response = await fetchImpl("https://api.linear.app/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: LINEAR_SCOPES,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok)
      throw new Error(
        `Linear authentication failed (HTTP ${response.status}). Check the app's client credentials configuration.`,
      );
    const result = await response.json();
    if (!result.access_token || !Number.isFinite(result.expires_in))
      throw new Error("Linear returned an invalid token response.");
    token = result.access_token;
    expiresAt = Date.now() + result.expires_in * 1000;
    return token;
  }
  async function query(queryText, variables = {}, retry = true) {
    const response = await fetchImpl("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${await accessToken()}` },
      body: JSON.stringify({ query: queryText, variables }),
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 401 && retry) {
      token = null;
      return query(queryText, variables, false);
    }
    if (!response.ok) throw new Error(`Linear API request failed (HTTP ${response.status}).`);
    const result = await response.json();
    // Provider error text may contain ticket content or credentials; retain only a safe diagnosis.
    if (result.errors?.length || !result.data)
      throw new Error("Linear rejected the query. Check app permissions and API schema.");
    return result.data;
  }
  return {
    async user(id) {
      const result = await query(
        `query HarnessReplyUser($id: String!) {
        user(id: $id) { id name active app organization { id } }
      }`,
        { id },
      );
      return result.user;
    },
    async publishActivity(id, sessionId, content) {
      // A stable client-generated UUID and a read-before-retry cover an uncertain HTTP result.
      const existing = await query(
        `query HarnessActivityReceipt($id: ID!) {
        agentActivities(filter: { id: { eq: $id } }, first: 1) { nodes { id } }
      }`,
        { id },
      );
      if (existing.agentActivities.nodes.length) return;
      const result = await query(
        `mutation HarnessProgress($input: AgentActivityCreateInput!) {
        agentActivityCreate(input: $input) { success }
      }`,
        { input: { id, agentSessionId: sessionId, content } },
      );
      if (!result.agentActivityCreate?.success) throw new Error("Linear could not publish the task update.");
    },
    async identity() {
      const result = await query("query { viewer { id } organization { id } }");
      return { appUserId: result.viewer.id, organizationId: result.organization.id };
    },
    async issue(id) {
      const result = await query(
        `query HarnessIssue($id: String!) {
        issue(id: $id) {
          id identifier title description url priority priorityLabel estimate dueDate createdAt updatedAt
          team { id key name } project { id name url description }
          state { id name type } assignee { id name } creator { id name }
          cycle { id name number } parent { id identifier title url }
          labels(first: 100) { nodes { id name } pageInfo { hasNextPage } }
          attachments(first: 100) { nodes { id title url } pageInfo { hasNextPage } }
          relations(first: 100) { nodes { type relatedIssue { id identifier title url } } pageInfo { hasNextPage } }
          inverseRelations(first: 100) { nodes { type issue { id identifier title url } } pageInfo { hasNextPage } }
        }
      }`,
        { id },
      );
      if (!result.issue) throw new Error("Linear issue is unavailable to this app.");
      return result.issue;
    },
    async linkSession(sessionId, url) {
      const result = await query(
        `mutation HarnessLink($id: String!, $input: AgentSessionUpdateInput!) {
        agentSessionUpdate(id: $id, input: $input) { success }
      }`,
        { id: sessionId, input: { externalUrls: [{ label: "Open Harness", url }] } },
      );
      if (!result.agentSessionUpdate?.success) throw new Error("Linear could not link the Harness task.");
    },
    async completeSession(sessionId, taskId) {
      const result = await query(
        `mutation HarnessIntakeComplete($input: AgentActivityCreateInput!) {
        agentActivityCreate(input: $input) { success }
      }`,
        {
          input: {
            agentSessionId: sessionId,
            content: {
              type: "response",
              body: `Created or located Harness task ${taskId}. Open Harness to review its current state. This integration does not start execution. Further mentions of this issue reuse the same task.`,
            },
          },
        },
      );
      if (!result.agentActivityCreate?.success) throw new Error("Linear could not acknowledge task intake.");
    },
  };
}
