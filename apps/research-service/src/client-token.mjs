// Makes a client token for the research service: `npm run client-token -w @eversor/research-service -- plancheck`.
//
// Prints the token once, for the client (PlanCheck) to keep, and the `name:sha256` entry for the
// service's RESEARCH_SERVICE_CLIENTS. The service is configured with the hash only.

import { randomBytes } from "node:crypto";
import { tokenSha256 } from "./batches.mjs";

const name = process.argv[2] ?? "plancheck";
if (!/^[a-z][a-z0-9-]{0,39}$/.test(name)) {
  console.error("Name the client in lower case, for example plancheck.");
  process.exit(1);
}
const token = `rsk_${randomBytes(32).toString("base64url")}`;
console.log(`Token for ${name} (give it to the client; it is not stored anywhere):\n  ${token}`);
console.log(
  `Service entry (add to RESEARCH_SERVICE_CLIENTS, comma separated):\n  ${name}:${tokenSha256(token)}`,
);
