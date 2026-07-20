import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildJudgeUserPrompt,
  judgeSystemPrompt,
} from './judge.prompts';
import type {
  DebateMode,
  RoundJudgment,
  ScoreBreakdown,
} from '../types/simulation.types';
import {
  type LlmTraceCallback,
  QwenApiError,
  QwenLlmService,
} from '../llm/qwen-llm.service';

export type JudgeRoundInput = {
  topic: string;
  round: number;
  mode: DebateMode;
  defenderArgument: string;
  accuserArgument: string;
  model?: string;
  trace?: LlmTraceCallback;
};

type RawSideScores = {
  persuasion: number;
  coherence: number;
  effectiveness: number;
  contradictionPenalty: number;
};

type RawJudgeJson = {
  defender: RawSideScores;
  accuser: RawSideScores;
  winner: 'defender' | 'accuser' | 'tie';
  rationale: string;
};

@Injectable()
export class JudgeService {
  private readonly logger = new Logger(JudgeService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly llm: QwenLlmService,
  ) {}

  /**
   * Weights for final 0–10 score.
   * Shadow: persuasion-first, no moral penalty (handled in prompt).
   * Mirror: coherence/ethics-first.
   */
  private weights(mode: DebateMode) {
    if (mode === 'shadow') {
      return {
        persuasion: 0.4,
        coherence: 0.25,
        effectiveness: 0.2,
        contradiction: 0.15,
      };
    }
    return {
      persuasion: 0.25,
      coherence: 0.4,
      effectiveness: 0.2,
      contradiction: 0.15,
    };
  }

  computeTotal(mode: DebateMode, s: RawSideScores): ScoreBreakdown {
    const w = this.weights(mode);
    const persuasion = this.clamp(s.persuasion);
    const coherence = this.clamp(s.coherence);
    const effectiveness = this.clamp(s.effectiveness);
    const contradictionPenalty = this.clamp(s.contradictionPenalty);
    const positiveWeight = w.persuasion + w.coherence + w.effectiveness;
    const total = this.clamp(
      (persuasion * w.persuasion +
        coherence * w.coherence +
        effectiveness * w.effectiveness) /
        positiveWeight -
        contradictionPenalty * w.contradiction,
    );
    return {
      persuasion,
      coherence,
      effectiveness,
      contradictionPenalty,
      total: Math.round(total * 100) / 100,
    };
  }

  async judgeRound(input: JudgeRoundInput): Promise<RoundJudgment> {
    const system = judgeSystemPrompt(input.mode);
    const user = buildJudgeUserPrompt(input);

    let fallback: RoundJudgment['fallback'];
    if (this.llm.isConfigured()) {
      try {
        const raw = await this.llm.chatJson<RawJudgeJson>({
          model: input.model,
          system,
          user,
          temperature: input.mode === 'shadow' ? 0.7 : 0.3,
          trace: input.trace,
        });
        return this.toJudgment(input, raw, true);
      } catch (err) {
        fallback =
          err instanceof QwenApiError
            ? {
                errorCode: err.code,
                requestId: err.requestId,
                moderationBlocked: err.isModerationBlock,
              }
            : {
                errorCode: 'judge_llm_error',
                moderationBlocked: false,
              };
        this.logger.warn(
          `LLM judge failed, falling back to heuristic: ${String(err)}`,
        );
      }
    }

    const heuristic = this.heuristicJudge(input);
    return this.toJudgment(input, heuristic, false, fallback);
  }

  /** Demo scoring when DashScope key is absent — still exercises the full pipeline. */
  private heuristicJudge(input: JudgeRoundInput): RawJudgeJson {
    const d = this.scoreText(input.defenderArgument, input.mode);
    const a = this.scoreText(input.accuserArgument, input.mode);

    // Shadow nudges persuasion; Mirror nudges coherence.
    if (input.mode === 'shadow') {
      d.persuasion = this.clamp(d.persuasion + 0.8);
      a.persuasion = this.clamp(a.persuasion + 0.8);
    } else {
      d.coherence = this.clamp(d.coherence + 0.6);
      a.coherence = this.clamp(a.coherence + 0.6);
    }

    const dTotal = this.computeTotal(input.mode, d).total;
    const aTotal = this.computeTotal(input.mode, a).total;
    let winner: RawJudgeJson['winner'] = 'tie';
    if (dTotal > aTotal + 0.15) winner = 'defender';
    else if (aTotal > dTotal + 0.15) winner = 'accuser';

    const modeLabel = input.mode === 'shadow' ? 'Shadow' : 'Mirror';
    return {
      defender: d,
      accuser: a,
      winner,
      rationale: `[${modeLabel} · heuristic] Round winner: ${
        winner === 'tie'
          ? 'Tie'
          : winner === 'defender'
            ? 'Defender'
            : 'Accuser'
      }. Evaluation completed without the LLM (configure DASHSCOPE_API_KEY for a real Qwen judge). Defender ${dTotal.toFixed(1)} vs Accuser ${aTotal.toFixed(1)}.`,
    };
  }

  private scoreText(text: string, mode: DebateMode): RawSideScores {
    const len = text.trim().length;
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const hasStructure = /porque|por lo tanto|evidencia|dato|estudio|sin embargo/i.test(
      text,
    );
    const emotional = /siempre|nunca|destruir|obligar|odio|miedo|traidor/i.test(
      text,
    );
    const contradictions =
      (text.match(/sin embargo|pero|aunque/gi) ?? []).length > 3 ? 4 : 1;

    const base = this.clamp(3 + Math.min(words / 40, 4) + (hasStructure ? 1.5 : 0));
    const persuasion = this.clamp(
      base + (emotional ? 1.2 : 0) + (mode === 'shadow' ? 0.5 : 0),
    );
    const coherence = this.clamp(
      base + (hasStructure ? 1 : 0) - (emotional && mode === 'mirror' ? 1 : 0),
    );
    const effectiveness = this.clamp(base + (len > 120 ? 0.8 : 0));
    return {
      persuasion,
      coherence,
      effectiveness,
      contradictionPenalty: this.clamp(contradictions),
    };
  }

  private toJudgment(
    input: JudgeRoundInput,
    raw: RawJudgeJson,
    usedLlm: boolean,
    fallback?: RoundJudgment['fallback'],
  ): RoundJudgment {
    const defenderScore = this.computeTotal(input.mode, {
      persuasion: Number(raw.defender?.persuasion ?? 5),
      coherence: Number(raw.defender?.coherence ?? 5),
      effectiveness: Number(raw.defender?.effectiveness ?? 5),
      contradictionPenalty: Number(raw.defender?.contradictionPenalty ?? 0),
    });
    const accuserScore = this.computeTotal(input.mode, {
      persuasion: Number(raw.accuser?.persuasion ?? 5),
      coherence: Number(raw.accuser?.coherence ?? 5),
      effectiveness: Number(raw.accuser?.effectiveness ?? 5),
      contradictionPenalty: Number(raw.accuser?.contradictionPenalty ?? 0),
    });

    let winner: RoundJudgment['winner'] = 'tie';
    if (defenderScore.total > accuserScore.total + 0.15) winner = 'defender';
    else if (accuserScore.total > defenderScore.total + 0.15)
      winner = 'accuser';

    const declaredWinner =
      raw.winner === 'defender' ||
      raw.winner === 'accuser' ||
      raw.winner === 'tie'
        ? raw.winner
        : null;
    const normalizedNote =
      declaredWinner && declaredWinner !== winner
        ? ` Result normalized from the computed scores: ${winner}.`
        : '';

    return {
      round: input.round,
      defenderScore,
      accuserScore,
      winner,
      rationale: `${String(raw.rationale ?? 'No rationale provided')}${normalizedNote}`,
      mode: input.mode,
      usedLlm,
      ...(fallback ? { fallback } : {}),
    };
  }

  private clamp(n: number, min = 0, max = 10): number {
    if (Number.isNaN(n)) return min;
    return Math.min(max, Math.max(min, n));
  }
}
