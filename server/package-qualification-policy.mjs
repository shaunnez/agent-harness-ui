export function packageQualificationFailure(workPackageId, qualification, retained = false) {
  const failed = qualification.rows?.find((row) => row.status !== "passed");
  if (qualification.failureKind === "repository-baseline") {
    const commandIds = qualification.baselineVerification?.commandIds?.join(", ") || failed?.id;
    const revision = qualification.baselineVerification?.revision;
    const error = new Error(
      `Repository baseline verification failed${commandIds ? ` for ${commandIds}` : ""}${revision ? ` at ${revision.slice(0, 12)}` : ""}. The same command fails before ${workPackageId}'s changes, so retrying the retained slice cannot repair it.`,
    );
    error.code = "REPOSITORY_BASELINE_FAILURE";
    error.workPackageId = workPackageId;
    error.baselineVerification = qualification.baselineVerification;
    return error;
  }
  const error = new Error(
    `${workPackageId}${retained ? " retained slice" : ""} did not qualify: ${
      (qualification.rows ?? [])
        .filter((row) => row.status !== "passed")
        .map((row) => `${row.id} failed${row.failureDetails ? ` — ${row.failureDetails}` : "."}`)
        .join("\n") || "repository verification failed."
    }`,
  );
  error.code = "PACKAGE_QUALIFICATION_FAILED";
  error.qualification = qualification;
  return error;
}
