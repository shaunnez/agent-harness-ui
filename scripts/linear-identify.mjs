import { createLinearClient } from "../server/integrations/linear-client.mjs";

const { LINEAR_CLIENT_ID: clientId, LINEAR_CLIENT_SECRET: clientSecret } = process.env;
if (!clientId || !clientSecret)
  throw new Error("Set LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET in the environment.");
const identity = await createLinearClient({ clientId, clientSecret }).identity();
console.log(JSON.stringify({ clientId, ...identity }, null, 2));
