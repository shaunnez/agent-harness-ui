// The ordinary verifier runs once inside an evaluator-owned OS file boundary.
// Provider CLIs are not children of this process and retain their native sandboxes.
import { runRepositoryVerification } from "../../server/verification.mjs";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const result = await runRepositoryVerification(JSON.parse(input));
console.log(JSON.stringify(result));
