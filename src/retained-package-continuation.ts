export function supportsRetainedPackageContinuation(error: string | null | undefined): boolean {
  return /run exceeded \d+ seconds|harness stopped while this task was running|Candidate changed .+, which is outside the work package ownership \(/i.test(
    error ?? "",
  );
}
