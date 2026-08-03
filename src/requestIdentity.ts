export interface RequestIdentity {
  identity: string | null;
  generation: number;
}

export function isCurrentRequest(request: RequestIdentity, current: RequestIdentity) {
  return request.identity === current.identity && request.generation === current.generation;
}

export function matchesCandidateDiffResponse(
  requested: { id: string; revisionNumber: number; headRevision: string | null },
  response: { candidateId: string; revisionNumber: number; headRevision: string },
) {
  return Boolean(
    requested.headRevision &&
      response.candidateId === requested.id &&
      response.revisionNumber === requested.revisionNumber &&
      response.headRevision === requested.headRevision,
  );
}
