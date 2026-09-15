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
  return new Error(
    `${workPackageId}${retained ? " retained slice" : ""} did not qualify: ${failed?.id ?? "repository verification"} failed${failed?.failureDetails ? ` — ${failed.failureDetails}` : "."}`,
  );
}
