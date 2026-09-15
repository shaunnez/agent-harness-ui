export function supportsRetainedPackageContinuation(error: string | null | undefined): boolean {
  return /run exceeded \d+ seconds|harness stopped while this task was running|(?:retained slice )?did not qualify/i.test(
    error ?? "",
  );
}
