import assert from "node:assert/strict";
import test from "node:test";
import {
  isGlobalAddress,
  normalizeRequestedUrl,
  validatePublicSourceUrl,
} from "@eversor/research-engine/research-source-policy.mjs";

test("private, reserved, mapped and mixed DNS answers are blocked", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "169.254.1.1",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
  ])
    assert.equal(isGlobalAddress(address), false, address);
  assert.equal(isGlobalAddress("93.184.216.34"), true);
  await assert.rejects(
    validatePublicSourceUrl("https://example.test", {
      lookup: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
    }),
    (error) => error.code === "private_network_url",
  );
});

test("credential-bearing query URLs fail closed without rewriting the resource", async () => {
  const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
  for (const url of [
    "https://example.test/file?token=secret",
    "https://example.test/file?X-Amz-Signature=secret",
    "https://example.test/file?x-goog-signature=secret",
    "https://example.test/file?sv=1&sig=secret",
  ])
    await assert.rejects(
      validatePublicSourceUrl(url, { lookup }),
      (error) => error.code === "secret_bearing_url" && !error.message.includes("secret"),
    );
});

test("run-local URL identity removes fragments/default ports but preserves query order", () => {
  assert.equal(
    normalizeRequestedUrl("https://Example.test:443/path/?b=2&a=1#section"),
    "https://example.test/path/?b=2&a=1",
  );
});
