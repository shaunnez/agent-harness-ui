import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkPackages } from "../server/structured-output.mjs";

/**
 * A package that declares test work must own somewhere to put it. The check that enforces
 * that once demanded a literal test path, which rejected valid plans in every project that
 * colocates tests with the code they cover.
 *
 * EXP-001's `C4-backend` case hit this at three of six plan attempts. The package below is
 * the one AH-023 was rejected for, renumbered S1 so it can stand alone: it owns `frontend/src/features/tender-assessment/`,
 * which holds 39 colocated `.test.tsx` files in that repository, and names two of them in
 * its own description.
 */
function plan(packages) {
  const body = JSON.stringify({ disposition: "changes-required", evidence: [], packages });
  return `<work-packages>\n${body}\n</work-packages>`;
}

const OWNED_DIRECTORY_PACKAGE = {
  id: "S1",
  title: "Review and All Tenders",
  // Verbatim from the plan AH-023 was rejected for.
  description:
    "Add reviewer create/revise controls and API calls, render every grouped claim with group/shared/dispute metadata, consume canonical persisted subtotals on Review and All Tenders, preserve independent extra-work, and extend model/component/parity tests.",
  dependencies: [],
  ownedPaths: ["frontend/src/features/tender-assessment/"],
  verificationCommandIds: ["frontend-test"],
};

test("a package owning a directory may declare test work inside it", () => {
  const parsed = parseWorkPackages(plan([OWNED_DIRECTORY_PACKAGE]));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, "S1");
  // normalizeOwnedPath drops the trailing slash.
  assert.deepEqual(parsed[0].ownedPaths, ["frontend/src/features/tender-assessment"]);
});

test("a package declaring test work while owning only plain files is still refused", () => {
  // The check still has to catch the case it was written for: test work promised against
  // paths that cannot hold a test.
  assert.throws(
    () =>
      parseWorkPackages(
        plan([
          {
            ...OWNED_DIRECTORY_PACKAGE,
            ownedPaths: ["backend/remedy_prices/models.py", "backend/remedy_prices/router.py"],
          },
        ]),
      ),
    /ownedPaths contains no explicit test file or test directory/,
  );
});

test("an explicit test file and an explicit tests directory both still satisfy the check", () => {
  for (const [ownedPath, normalized] of [
    ["tests/unit/remedy_prices/", "tests/unit/remedy_prices"],
    ["tests/unit/registers/x.test.ts", "tests/unit/registers/x.test.ts"],
  ]) {
    const parsed = parseWorkPackages(plan([{ ...OWNED_DIRECTORY_PACKAGE, ownedPaths: [ownedPath] }]));
    assert.equal(parsed[0].ownedPaths[0], normalized);
  }
});

test("a package that never mentions test work needs no test path", () => {
  const parsed = parseWorkPackages(
    plan([
      {
        ...OWNED_DIRECTORY_PACKAGE,
        description: "Regenerate the frontend API schema from the backend contract.",
        ownedPaths: ["frontend/src/api/schema.d.ts"],
      },
    ]),
  );
  assert.equal(parsed[0].ownedPaths[0], "frontend/src/api/schema.d.ts");
});
