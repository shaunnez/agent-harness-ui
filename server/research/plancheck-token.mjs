// The bearer token for PlanCheck's rate library, kept current by the host.
//
// PlanCheck's tokens are JWTs that last 24 hours, so a token pasted into a file stops working a
// day later and every research run after that ends unassessed. With a mint command configured,
// the host mints a token when it has none, renews it before it expires, and mints once more if
// the library refuses one anyway. The token lives in this process (and in the optional cache
// file, owner-only); it is never put in an environment the model CLI inherits, and never logged.

import { execFile } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";

export const PLANCHECK_TOKEN_COMMAND_ENV_VAR = "RESEARCH_PLANCHECK_TOKEN_COMMAND";
export const PLANCHECK_TOKEN_FILE_ENV_VAR = "RESEARCH_PLANCHECK_TOKEN_FILE";

/** Renew this long before the token's own expiry, so no run starts on a token about to lapse. */
const RENEW_BEFORE_MS = 30 * 60_000;
const MINT_TIMEOUT_MS = 30_000;

/** One source per configuration, shared by every run in the process, so parallel runs share one
 *  token and one mint rather than each minting their own. */
const sources = new Map();

export function planCheckTokenSource({
  command = null,
  file = null,
  now = () => Date.now(),
  run = runCommand,
}) {
  if (!command && !file)
    throw new Error(
      `PlanCheck needs ${PLANCHECK_TOKEN_COMMAND_ENV_VAR} (a command that prints a fresh token) or ${PLANCHECK_TOKEN_FILE_ENV_VAR}.`,
    );
  const key = JSON.stringify([command, file]);
  if (run !== runCommand) return new PlanCheckTokenSource({ command, file, now, run });
  if (!sources.has(key)) sources.set(key, new PlanCheckTokenSource({ command, file, now, run }));
  return sources.get(key);
}

export class PlanCheckTokenSource {
  #command;
  #file;
  #now;
  #run;
  #current = null;
  #minting = null;

  constructor({ command, file, now, run }) {
    this.#command = command;
    this.#file = file;
    this.#now = now;
    this.#run = run;
  }

  /** A token with at least half an hour left, minted or read as needed. */
  async token() {
    if (this.#fresh(this.#current)) return this.#current.value;
    const saved = await this.#readFile();
    if (this.#fresh(saved)) {
      this.#current = saved;
      return saved.value;
    }
    if (!this.#command)
      throw tokenError(
        saved
          ? `The PlanCheck token in ${this.#file} has expired. Set ${PLANCHECK_TOKEN_COMMAND_ENV_VAR} so the host can renew it.`
          : `No PlanCheck token in ${this.#file}. Set ${PLANCHECK_TOKEN_COMMAND_ENV_VAR} so the host can mint one.`,
      );
    return this.#mint();
  }

  /** The library refused `value`: drop it and mint a new one. Null when nothing can be minted. */
  async refused(value) {
    if (this.#current?.value === value) this.#current = null;
    if (!this.#command) return null;
    return this.#mint();
  }

  #mint() {
    // Concurrent runs asking at once share one mint.
    this.#minting ??= (async () => {
      try {
        const output = await this.#run(this.#command);
        const value = output.trim().split("\n").at(-1)?.trim() ?? "";
        const expiresAt = expiryOf(value);
        if (!value || expiresAt == null)
          throw tokenError("The PlanCheck token command did not print a token.");
        this.#current = { value, expiresAt };
        await this.#writeFile(value);
        return value;
      } catch (error) {
        if (error?.provider === "plancheck") throw error;
        // The command's own error text can carry anything it printed; only its exit is reported.
        throw tokenError(`The PlanCheck token command failed (${error?.code ?? "no exit code"}).`);
      } finally {
        this.#minting = null;
      }
    })();
    return this.#minting;
  }

  #fresh(token) {
    return Boolean(token && token.expiresAt - this.#now() > RENEW_BEFORE_MS);
  }

  async #readFile() {
    if (!this.#file) return null;
    const value = (await readFile(this.#file, "utf8").catch(() => "")).trim();
    if (!value) return null;
    // A token with no readable expiry is trusted for this process only until the library refuses it.
    return { value, expiresAt: expiryOf(value) ?? Number.POSITIVE_INFINITY };
  }

  async #writeFile(value) {
    if (!this.#file) return;
    await writeFile(this.#file, `${value}\n`, { mode: 0o600 });
    await chmod(this.#file, 0o600).catch(() => undefined);
  }
}

/** A JWT's `exp`, in milliseconds, or null. The signature is PlanCheck's to check, not ours. */
export function expiryOf(token) {
  const payload = String(token ?? "").split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number.isFinite(claims?.exp) ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

function runCommand(command) {
  return new Promise((resolve, reject) => {
    execFile(
      "/bin/sh",
      ["-c", command],
      { timeout: MINT_TIMEOUT_MS, maxBuffer: 64 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(String(stdout))),
    );
  });
}

function tokenError(message) {
  const error = new Error(message);
  error.code = "plancheck_configuration";
  error.provider = "plancheck";
  error.category = "configuration";
  return error;
}
