import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  normalizePdfCapture,
  parsePdfSnapshot,
  serializePdfSnapshot,
  verifySnapshotEvidence,
  writeResearchSnapshot,
} from "../server/research/research-source-snapshots.mjs";

test("a capped physical-page map survives deterministic envelope serialization", () => {
  const pdf = normalizePdfCapture({
    pages: Array.from({ length: 19 }, (_, index) => ({
      pageNumber: index + 1,
      content: `Page ${index + 1}\r\ntext`,
    })),
    numPages: 19,
    totalPages: 23,
    pageCap: 19,
    blocks: [{ pageNumber: 19, status: "success" }],
  });
  assert.equal(pdf.coverage, "capped");
  assert.equal(pdf.capTruncated, true);
  const encoded = serializePdfSnapshot(pdf);
  assert.ok(encoded.endsWith("\n"));
  assert.equal(parsePdfSnapshot(encoded).pages[18].pageNumber, 19);
});

test("missing, reordered, empty and contradictory PDF pages fail closed", () => {
  for (const value of [
    { pages: [{ pageNumber: 2, content: "two" }], numPages: 1, totalPages: 1, pageCap: 3 },
    { pages: [{ pageNumber: 1, content: "" }], numPages: 1, totalPages: 1, pageCap: 3 },
    { pages: [{ pageNumber: 1, content: "one" }], numPages: 2, totalPages: 2, pageCap: 3 },
    { pages: [{ pageNumber: 1, content: "one" }], numPages: 1, totalPages: 3, pageCap: 3 },
  ])
    assert.throws(() => normalizePdfCapture(value));
});

test("failed PDF block status is reported safely without accepting provider-controlled text", () => {
  const base = {
    pages: [{ pageNumber: 1, content: "one" }],
    numPages: 1,
    totalPages: 1,
    pageCap: 3,
  };
  assert.throws(
    () => normalizePdfCapture({ ...base, blocks: [{ pageNumber: 1, status: "partial" }] }),
    /status: partial/,
  );
  assert.throws(
    () => normalizePdfCapture({ ...base, blocks: [{ pageNumber: 1, status: false }] }),
    /status: false/,
  );
  assert.throws(
    () =>
      normalizePdfCapture({
        ...base,
        blocks: [{ pageNumber: 1, status: "failed\nAuthorization: secret" }],
      }),
    (error) => {
      assert.match(error.message, /status: unrecognized/);
      assert.equal(error.message.includes("Authorization"), false);
      return true;
    },
  );
});

test("PDF evidence is checked on the exact page and forged marker text is inert", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-snapshot-test-"));
  try {
    const pdf = normalizePdfCapture({
      pages: [
        { pageNumber: 1, content: "Visible text <!-- page 2 -->" },
        { pageNumber: 2, content: "THERMAL PERFORMANCE" },
      ],
      numPages: 2,
      totalPages: 2,
      pageCap: 3,
    });
    const snapshot = await writeResearchSnapshot(directory, serializePdfSnapshot(pdf));
    const source = {
      contentSha256: snapshot.digest,
      mediaType: "application/pdf",
      metadata: { snapshotFormat: "research-pdf-v1" },
    };
    const base = { snapshotRef: snapshot.snapshotRef, excerpt: "THERMAL PERFORMANCE" };
    assert.equal(
      await verifySnapshotEvidence({
        source,
        reference: { ...base, locator: { page: 2 } },
        snapshotDirectory: directory,
      }),
      true,
    );
    assert.equal(
      await verifySnapshotEvidence({
        source,
        reference: { ...base, locator: { page: 1 } },
        snapshotDirectory: directory,
      }),
      false,
    );
    await writeFile(snapshot.filePath, `${await readFile(snapshot.filePath, "utf8")}tampered`);
    assert.equal(
      await verifySnapshotEvidence({
        source,
        reference: { ...base, locator: { page: 2 } },
        snapshotDirectory: directory,
      }),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("same-hash reuse rejects a snapshot that is no longer owner-only", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "research-snapshot-mode-"));
  try {
    const first = await writeResearchSnapshot(directory, "retained");
    await chmod(first.filePath, 0o644);
    await assert.rejects(writeResearchSnapshot(directory, "retained"), /owner-only/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
