export interface OnboardingProposal {
  determined: boolean;
  reason: string | null;
  commands: Array<{
    id: string;
    command: string[];
    cwd?: string;
    timeoutMs?: number;
    evidence: { kind: string; detail: string };
    claimedEvidence?: string | null;
    evidenceDisagrees?: boolean;
  }>;
  notes: string[];
}
export interface OnboardingReview {
  repositoryRoot: string;
  proposal: OnboardingProposal;
  alreadyOnboarded: boolean;
  manifestPath: string;
  manifestPreview: string | null;
}
