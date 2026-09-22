// Resolve Grill provenance from its retained session, including older records
// that saved resolved answers without duplicating them in task.decisions.
export function decisionContext(task) {
  const questions = (task.grillSession?.questions ?? []).filter((question) => question.answer);
  const decisions = (task.decisions ?? []).map((decision) => {
    const question = questions.find(
      (item) => item.id === decision.grillQuestionId && item.answer === decision.answer,
    );
    return { ...decision, source: question ? answerSource(task, question) : "not-recorded" };
  });
  for (const question of questions) {
    if (decisions.some((decision) => decision.grillQuestionId === question.id)) continue;
    decisions.push({
      grillQuestionId: question.id,
      question: question.question,
      answer: question.answer,
      source: answerSource(task, question),
    });
  }
  return {
    count: decisions.length,
    text: decisions.length
      ? `Recorded decisions (authoritative; source identifies operator, automation or uncertain attribution):\n${decisions
          .map((decision) => `- ${decision.question}: ${decision.answer} [source: ${decision.source}]`)
          .join("\n")}\n\n`
      : "",
  };
}

function answerSource(task, question) {
  if (task.grillSession?.completionSource === "legacy-unverified") return "legacy-unverified";
  return ["automation-policy", "operator-answer", "operator-accepted-recommendation"].includes(
    question.answerSource,
  )
    ? question.answerSource
    : "legacy-unverified";
}
