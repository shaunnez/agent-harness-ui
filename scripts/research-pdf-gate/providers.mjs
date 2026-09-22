import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 20_000_000;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function containedFile(sourceDirectory, filename) {
  const root = path.resolve(sourceDirectory);
  const candidate = path.resolve(root, filename);
  if (path.dirname(candidate) !== root) throw new Error(`Unsafe local source filename: ${filename}`);
  return candidate;
}

export class PlanCheckPdfProvider {
  constructor({
    repositoryPath,
    sourceDirectory,
    pythonPath,
    adapterPath,
    executeVision = false,
    commandRunner = execFileAsync,
  }) {
    this.name = "plancheck-legacy-assessment";
    this.repositoryPath = path.resolve(repositoryPath);
    this.sourceDirectory = path.resolve(sourceDirectory);
    this.pythonPath = pythonPath ?? path.join(this.repositoryPath, "backend", ".venv", "bin", "python");
    this.adapterPath = path.resolve(adapterPath);
    this.executeVision = executeVision;
    this.commandRunner = commandRunner;
  }

  argumentsFor(testCase, planOnly) {
    const args = [
      this.adapterPath,
      "--repository",
      this.repositoryPath,
      "--source",
      containedFile(this.sourceDirectory, testCase.localFilename),
      "--max-pages",
      String(testCase.maxPages),
    ];
    if (planOnly) args.push("--plan-only");
    if (this.executeVision && !planOnly) args.push("--execute-vision");
    return args;
  }

  async invoke(testCase, planOnly) {
    const response = await this.commandRunner(this.pythonPath, this.argumentsFor(testCase, planOnly), {
      timeout: 900_000,
      maxBuffer: MAX_BUFFER,
      env: process.env,
    });
    return JSON.parse(response.stdout);
  }

  async plan(testCase) {
    const payload = await this.invoke(testCase, true);
    if (payload.sourceSha256 !== testCase.sourceSha256) {
      throw new Error(`Source hash mismatch for ${testCase.id}.`);
    }
    return payload;
  }

  async retrieve(testCase) {
    const payload = await this.invoke(testCase, false);
    if (payload.sourceSha256 !== testCase.sourceSha256) {
      throw new Error(`Source hash mismatch for ${testCase.id}.`);
    }
    if (payload.extractorError) throw new Error(payload.extractorError);
    return {
      provider: this.name,
      request: {
        localFilename: testCase.localFilename,
        maxPages: testCase.maxPages,
        executeVision: this.executeVision,
      },
      content: payload.content,
      pages: payload.pages,
      contentSha256: sha256(payload.content),
      metadata: {
        durationMs: payload.durationMs,
        characterCount: payload.content.length,
        sourceSha256: payload.sourceSha256,
        extractorRoute: payload.extractorRoute ?? "legacy-assessment-text-extraction",
        sourceBytes: payload.sourceBytes,
        totalPages: payload.totalPages,
        parsedPages: payload.parsedPageLimit,
        sparsePages: payload.sparsePages,
        pagesFromText: payload.pagesFromText,
        pagesFromVision: payload.pagesFromVision,
        pagesMissing: payload.pagesMissing,
        extractionComplete: payload.pagesMissing.length === 0,
        visionCalls: payload.visionCalls,
        originalSourceBytesRetained: true,
        extractedSnapshotRetained: true,
        estimatedCostUsd: 0,
      },
    };
  }
}
