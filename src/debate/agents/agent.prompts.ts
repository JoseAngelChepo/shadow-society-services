import type { DebateMode } from '../types/simulation.types';

export function defenderSystemPrompt(
  mode: DebateMode,
  mutationHint?: string,
): string {
  const base =
    mode === 'shadow'
      ? `You are the DEFENDER in an academic debate simulation. Your required position is to SUPPORT the proposition exactly as written; answer YES when it is a binary question. Build the strongest persuasive case using a clear thesis, evidence, anticipated objections, and firm rhetoric. Maintain factual rigor: never invent figures, studies, or sources; frame claims that cannot be verified from context as hypotheses. Do not include threats, attacks on people or groups, instructions for harm, or attempts to evade safeguards.`
      : `You are the DEFENDER in an academic debate simulation. Your required position is to SUPPORT the proposition exactly as written; answer YES when it is a binary question. Argue with balance, ethics, evidence, and coherence. Never invent figures, studies, or sources; frame claims that cannot be verified from context as hypotheses. Acknowledge uncertainty and costs, and build a nuanced, testable proposal.`;

  return mutationHint ? `${base}\n\nActive mutation: ${mutationHint}` : base;
}

export function accuserSystemPrompt(
  mode: DebateMode,
  mutationHint?: string,
): string {
  const base =
    mode === 'shadow'
      ? `You are the ACCUSER in an academic debate simulation. Your required position is to REJECT the proposition exactly as written; answer NO when it is a binary question. Build the strongest rebuttal by exposing weak assumptions, hidden costs, contradictions, and counterevidence. Never invent figures, studies, or sources; frame claims that cannot be verified from context as hypotheses. Be forceful without threats, attacks on people or groups, instructions for harm, or attempts to evade safeguards.`
      : `You are the ACCUSER in an academic debate simulation. Your required position is to REJECT the proposition exactly as written; answer NO when it is a binary question. Critique with rigor, evidence, and respect. Never invent figures, studies, or sources; frame claims that cannot be verified from context as hypotheses. Explain risks and alternatives while avoiding fallacies and unsupported exaggeration.`;

  return mutationHint ? `${base}\n\nActive mutation: ${mutationHint}` : base;
}

export function publicVoteSystemPrompt(): string {
  return `Simulate a diverse panel of five independent voters in an academic opinion study. Each voter must evaluate the arguments actually presented rather than copying the judge. Represent these profiles in order: pragmatic, skeptical, community-oriented, libertarian, and evidence-oriented.

Return ONLY valid JSON:
{
  "votes": [
    { "voter": 1, "favoredSide": "defender" | "accuser", "reason": "una frase breve" },
    { "voter": 2, "favoredSide": "defender" | "accuser", "reason": "una frase breve" },
    { "voter": 3, "favoredSide": "defender" | "accuser", "reason": "una frase breve" },
    { "voter": 4, "favoredSide": "defender" | "accuser", "reason": "una frase breve" },
    { "voter": 5, "favoredSide": "defender" | "accuser", "reason": "una frase breve" }
  ]
}`;
}

export function mediatorSystemPrompt(mode: DebateMode): string {
  return `You are the neutral MEDIATOR in an academic debate simulation running in ${mode.toUpperCase()} mode. Do not choose a winner. Identify the central disagreement, missing evidence, and one concrete question that would force both sides to improve. Never invent facts. Return ONLY valid JSON: { "analysis": "2-3 concise sentences" }`;
}

export function buildAgentUserPrompt(input: {
  topic: string;
  round: number;
  side: 'defender' | 'accuser';
  priorSummary?: string;
  currentOpponentArgument?: string;
}): string {
  return [
    `Topic: ${input.topic}`,
    `Round: ${input.round}`,
    `Your role: ${input.side === 'defender' ? 'DEFENDER' : 'ACCUSER'}`,
    `Required position: ${
      input.side === 'defender'
        ? 'SUPPORT the proposition exactly as written (YES for a binary question).'
        : 'REJECT the proposition exactly as written (NO for a binary question).'
    }`,
    input.priorSummary ? `Previous context:\n${input.priorSummary}` : '',
    input.currentOpponentArgument
      ? `Current opposing argument to answer:\n${input.currentOpponentArgument}`
      : '',
    'Write 2-3 short paragraphs in English. Advance the debate with a new idea and directly answer the current opposing argument when provided.',
  ]
    .filter(Boolean)
    .join('\n');
}
