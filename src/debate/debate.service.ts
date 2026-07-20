import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { JudgeService } from './judge/judge.service';
import {
  type LlmTraceCallback,
  type LlmTraceEntry,
  QwenApiError,
  QwenLlmService,
} from './llm/qwen-llm.service';
import {
  accuserSystemPrompt,
  buildAgentUserPrompt,
  defenderSystemPrompt,
  mediatorSystemPrompt,
  publicVoteSystemPrompt,
} from './agents/agent.prompts';
import type { CreateSimulationDto } from './dto/create-simulation.dto';
import {
  SimulationEntity,
  type SimulationDocument,
} from './schemas/simulation.schema';
import type {
  AgentMessage,
  AudienceState,
  ModerationActor,
  ModerationEvent,
  MutationEvent,
  Simulation,
  SimulationMetrics,
} from './types/simulation.types';
import { SimulationEventsService } from './events/simulation-events.service';
import type { AppendExecutionEvent } from './events/simulation-events.types';

type PublicVote = {
  voter: number;
  favoredSide: 'defender' | 'accuser';
  reason: string;
};

@Injectable()
export class DebateService {
  private readonly logger = new Logger(DebateService.name);
  private readonly activeAdvances = new Set<string>();
  private readonly leaseDurationMs = 10 * 60 * 1000;

  constructor(
    @InjectModel(SimulationEntity.name)
    private readonly simModel: Model<SimulationDocument>,
    private readonly judge: JudgeService,
    private readonly llm: QwenLlmService,
    private readonly events: SimulationEventsService,
  ) {}

  async create(dto: CreateSimulationDto): Promise<Simulation> {
    const now = new Date().toISOString();
    const sim: Simulation = {
      id: randomUUID(),
      status: 'configured',
      config: {
        topic: dto.topic.trim(),
        model: dto.model,
        mode: dto.mode,
        mutations: {
          intensity: dto.mutations.intensity,
          publicInfluence: dto.mutations.publicInfluence,
          speed: dto.mutations.speed,
        },
        totalRounds: dto.totalRounds ?? 5,
      },
      currentRound: 0,
      messages: [],
      judgments: [],
      mutations: [],
      audience: { defender: 50, accuser: 50 },
      metrics: this.emptyMetrics(),
      warnings: [],
      moderationEvents: [],
      eventSequence: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.simModel.create(sim);
    return sim;
  }

  async list(): Promise<Simulation[]> {
    const docs = await this.simModel
      .find()
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()
      .exec();
    return docs.map((d) => this.toSimulation(d));
  }

  async get(id: string): Promise<Simulation> {
    const doc = await this.simModel.findOne({ id }).lean().exec();
    if (!doc) throw new NotFoundException(`Simulation ${id} not found`);
    return this.toSimulation(doc);
  }

  async listRuns(limit = 20, cursor?: string) {
    const safeLimit = Math.min(50, Math.max(1, limit));
    const query = cursor ? { createdAt: { $lt: cursor } } : {};
    const docs = await this.simModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(safeLimit + 1)
      .select({
        id: 1,
        status: 1,
        config: 1,
        currentRound: 1,
        judgments: 1,
        metrics: 1,
        warnings: 1,
        moderationEvents: 1,
        createdAt: 1,
        updatedAt: 1,
        completedAt: 1,
      })
      .lean()
      .exec();
    const hasMore = docs.length > safeLimit;
    const page = docs.slice(0, safeLimit);
    return {
      items: page.map((doc) => {
        const sim = this.toSimulation(doc);
        const defenderWins = sim.judgments.filter(
          (judgment) => judgment.winner === 'defender',
        ).length;
        const accuserWins = sim.judgments.filter(
          (judgment) => judgment.winner === 'accuser',
        ).length;
        const finalWinner =
          defenderWins === accuserWins
            ? 'tie'
            : defenderWins > accuserWins
              ? 'defender'
              : 'accuser';
        return {
          id: sim.id,
          topic: sim.config.topic,
          mode: sim.config.mode,
          model: sim.config.model,
          status: sim.status,
          currentRound: sim.currentRound,
          totalRounds: sim.config.totalRounds,
          finalWinner:
            sim.status === 'completed' ? finalWinner : null,
          warningCount: sim.warnings?.length ?? 0,
          moderationCount: sim.moderationEvents?.length ?? 0,
          metrics: sim.metrics,
          createdAt: sim.createdAt,
          updatedAt: sim.updatedAt,
          completedAt: sim.completedAt,
        };
      }),
      nextCursor:
        hasMore && page.length ? page[page.length - 1]?.createdAt ?? null : null,
    };
  }

  async startRun(id: string): Promise<{
    simulationId: string;
    executionId: string;
    status: 'running';
    streamUrl: string;
  }> {
    const executionId = randomUUID();
    const now = new Date().toISOString();
    const expiresAt = new Date(
      Date.now() + this.leaseDurationMs,
    ).toISOString();
    const acquired = await this.simModel
      .findOneAndUpdate(
        {
          id,
          status: { $ne: 'completed' },
          $or: [
            { executionLease: { $exists: false } },
            { 'executionLease.expiresAt': { $lte: now } },
          ],
        },
        {
          $set: {
            status: 'running',
            executionId,
            executionLease: { leaseId: executionId, expiresAt },
            updatedAt: now,
          },
          $unset: { error: 1 },
        },
        { new: true },
      )
      .lean()
      .exec();
    if (!acquired) {
      const existing = await this.get(id);
      if (existing.status === 'completed') {
        throw new ConflictException(`Simulation ${id} is already completed`);
      }
      throw new ConflictException(`Simulation ${id} is already running`);
    }

    await this.events.append({
      simulationId: id,
      executionId,
      type: 'execution.queued',
      phase: 'execution',
      message: 'Simulation queued for background execution.',
      details: { totalRounds: acquired.config.totalRounds },
    });

    setImmediate(() => {
      void this.runInBackground(id, executionId);
    });
    return {
      simulationId: id,
      executionId,
      status: 'running',
      streamUrl: `/api/v1/debate/simulations/${id}/stream`,
    };
  }

  async advance(
    id: string,
    runToEnd = false,
    leaseId?: string,
  ): Promise<Simulation> {
    if (this.activeAdvances.has(id)) {
      throw new ConflictException(`Simulation ${id} is already advancing`);
    }
    this.activeAdvances.add(id);
    try {
      let sim = await this.get(id);
      if (sim.status === 'completed') return sim;
      if (
        sim.executionLease &&
        sim.executionLease.expiresAt > new Date().toISOString() &&
        sim.executionLease.leaseId !== leaseId
      ) {
        throw new ConflictException(`Simulation ${id} is already running`);
      }

      sim.status = 'running';
      sim.error = undefined;
      await this.persist(sim);

      const target = runToEnd
        ? sim.config.totalRounds
        : Math.min(sim.currentRound + 1, sim.config.totalRounds);

      try {
        while (sim.currentRound < target) {
          sim = await this.runOneRound(sim);
          await this.persist(sim);
          if (leaseId) await this.renewLease(id, leaseId);
        }
        if (sim.currentRound >= sim.config.totalRounds) {
          sim.status = 'completed';
          sim.completedAt = new Date().toISOString();
          sim.metrics = this.computeMetrics(sim);
        }
        sim.updatedAt = new Date().toISOString();
        await this.persist(sim);
        return sim;
      } catch (err) {
        sim.status = 'failed';
        sim.error = String(err);
        sim.updatedAt = new Date().toISOString();
        await this.persist(sim);
        this.logger.error(err);
        throw err;
      }
    } finally {
      this.activeAdvances.delete(id);
    }
  }

  private async runInBackground(
    id: string,
    executionId: string,
  ): Promise<void> {
    try {
      await this.events.append({
        simulationId: id,
        executionId,
        type: 'execution.started',
        phase: 'execution',
        message: 'Background execution started.',
      });
      const completed = await this.advance(id, true, executionId);
      await this.events.append({
        simulationId: id,
        executionId,
        type: 'execution.completed',
        phase: 'execution',
        message: 'Simulation completed.',
        details: {
          status: completed.status,
          currentRound: completed.currentRound,
          totalRounds: completed.config.totalRounds,
          warningCount: completed.warnings?.length ?? 0,
        },
      });
    } catch (error) {
      this.logger.error(`Background run ${executionId} failed`, error);
      try {
        await this.events.append({
          simulationId: id,
          executionId,
          type: 'execution.failed',
          level: 'error',
          phase: 'execution',
          message: 'Simulation execution failed.',
          details: { error: String(error) },
        });
      } catch (eventError) {
        this.logger.error('Failed to persist execution failure event', eventError);
      }
    } finally {
      await this.simModel
        .updateOne(
          { id, 'executionLease.leaseId': executionId },
          { $unset: { executionLease: 1 } },
        )
        .exec();
    }
  }

  private async renewLease(id: string, leaseId: string): Promise<void> {
    const expiresAt = new Date(
      Date.now() + this.leaseDurationMs,
    ).toISOString();
    const result = await this.simModel
      .updateOne(
        { id, 'executionLease.leaseId': leaseId },
        { $set: { 'executionLease.expiresAt': expiresAt } },
      )
      .exec();
    if (!result.matchedCount) {
      throw new ConflictException(`Execution lease lost for simulation ${id}`);
    }
  }

  private async persist(sim: Simulation): Promise<void> {
    sim.updatedAt = new Date().toISOString();
    const {
      eventSequence: _eventSequence,
      executionLease: _executionLease,
      ...persisted
    } = sim;
    await this.simModel
      .findOneAndUpdate({ id: sim.id }, { $set: persisted }, { upsert: true })
      .exec();
  }

  private toSimulation(doc: Record<string, unknown> | SimulationDocument): Simulation {
    const d = doc as Simulation;
    return {
      id: d.id,
      status: d.status,
      config: d.config,
      currentRound: d.currentRound,
      messages: d.messages ?? [],
      judgments: d.judgments ?? [],
      mutations: d.mutations ?? [],
      audience: d.audience,
      metrics: d.metrics,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      completedAt: d.completedAt,
      error: d.error,
      warnings: d.warnings ?? [],
      moderationEvents: d.moderationEvents ?? [],
      eventSequence: d.eventSequence ?? 0,
      executionId: d.executionId,
      executionLease: d.executionLease,
    };
  }

  private async runOneRound(sim: Simulation): Promise<Simulation> {
    const round = sim.currentRound + 1;
    await this.emitEvent(sim, {
      type: 'round.started',
      phase: 'round',
      round,
      message: `Round ${round} started.`,
      details: { totalRounds: sim.config.totalRounds },
    });
    const mutationHint = this.latestMutationHint(sim);
    let defenderText: string;
    let accuserText: string;

    // Alternate who opens. The second speaker must answer the current argument,
    // which avoids two disconnected monologues and removes fixed turn advantage.
    if (round % 2 === 1) {
      defenderText = await this.generateSideArgument(
        sim,
        'defender',
        round,
        mutationHint,
      );
      accuserText = await this.generateSideArgument(
        sim,
        'accuser',
        round,
        mutationHint,
        defenderText,
      );
    } else {
      accuserText = await this.generateSideArgument(
        sim,
        'accuser',
        round,
        mutationHint,
      );
      defenderText = await this.generateSideArgument(
        sim,
        'defender',
        round,
        mutationHint,
        accuserText,
      );
    }

    const [mediatorText, judgment] = await Promise.all([
      this.generateMediator(sim, round, defenderText, accuserText),
      this.judge.judgeRound({
        topic: sim.config.topic,
        round,
        mode: sim.config.mode,
        defenderArgument: defenderText,
        accuserArgument: accuserText,
        model: sim.config.model,
        trace: this.llmTrace(sim, round, 'judge', 'judgment'),
      }),
    ]);
    if (!judgment.usedLlm) {
      this.addWarning(
        sim,
        `Round ${round}: Judge used heuristic fallback instead of Qwen.`,
      );
      if (judgment.fallback?.moderationBlocked) {
        this.addModerationEvent(
          sim,
          round,
          'judge',
          judgment.fallback.errorCode,
          judgment.fallback.requestId,
        );
      }
      await this.emitEvent(sim, {
        type: judgment.fallback?.moderationBlocked
          ? 'moderation.blocked'
          : 'judgment.fallback',
        level: 'warn',
        phase: 'judgment',
        actor: 'judge',
        round,
        message: 'Judge used the heuristic fallback.',
        details: { fallback: judgment.fallback },
      });
    }

    const defenderMsg = this.msg(
      round,
      'defender',
      'Defender',
      defenderText,
    );
    const accuserMsg = this.msg(round, 'accuser', 'Accuser', accuserText);
    const mediatorMsg = this.msg(
      round,
      'mediator',
      'Mediator',
      mediatorText,
    );
    sim.messages.push(defenderMsg, accuserMsg, mediatorMsg);
    for (const message of [defenderMsg, accuserMsg, mediatorMsg]) {
      await this.emitEvent(sim, {
        type: 'agent.message',
        phase: 'agent',
        actor: message.role,
        round,
        message: `${message.agentName} produced a message.`,
        details: { message },
      });
    }

    sim.judgments.push(judgment);
    await this.emitEvent(sim, {
      type: 'judgment.created',
      phase: 'judgment',
      actor: 'judge',
      round,
      message: `Judge selected ${judgment.winner}.`,
      details: { judgment },
    });

    const judgeMsg = this.msg(
      round,
      'judge',
      'Judge',
      `Round winner: ${
        judgment.winner === 'tie'
          ? 'Tie'
          : judgment.winner === 'defender'
            ? 'Defender'
            : 'Accuser'
      }\n\n${judgment.rationale}\n\nScores — Defender: ${judgment.defenderScore.total} | Accuser: ${judgment.accuserScore.total}`,
    );
    sim.messages.push(judgeMsg);

    const mutateEvery = sim.config.mutations.speed === 'fast' ? 1 : 2;
    if (
      sim.config.mutations.publicInfluence &&
      round % mutateEvery === 0 &&
      judgment.winner !== 'tie'
    ) {
      const outcome = await this.applyMutation(
        sim,
        round,
        judgment.winner,
        defenderText,
        accuserText,
        mediatorText,
      );
      sim.mutations.push(outcome.event);
      sim.audience = outcome.event.audience;
      sim.messages.push(...outcome.messages);
      await this.emitEvent(sim, {
        type: 'mutation.applied',
        phase: 'mutation',
        actor: 'public',
        round,
        message: `Public mutation favored ${outcome.event.favoredSide}.`,
        details: {
          mutation: outcome.event,
          publicMessages: outcome.messages,
        },
      });
    } else if (judgment.winner !== 'tie') {
      sim.audience = this.nudgeAudience(sim.audience, judgment.winner, 3);
    }

    sim.currentRound = round;
    await this.emitEvent(sim, {
      type: 'round.completed',
      phase: 'round',
      round,
      message: `Round ${round} completed.`,
      details: {
        currentRound: round,
        totalRounds: sim.config.totalRounds,
        audience: sim.audience,
        warningCount: sim.warnings?.length ?? 0,
        moderationCount: sim.moderationEvents?.length ?? 0,
      },
    });
    return sim;
  }

  private async generateSideArgument(
    sim: Simulation,
    side: 'defender' | 'accuser',
    round: number,
    mutationHint?: string,
    currentOpponentArgument?: string,
  ): Promise<string> {
    const system =
      side === 'defender'
        ? defenderSystemPrompt(sim.config.mode, mutationHint)
        : accuserSystemPrompt(sim.config.mode, mutationHint);

    const prior = sim.messages
      .filter((m) => m.role === 'defender' || m.role === 'accuser')
      .slice(-4)
      .map((m) => `${m.agentName}: ${m.content}`)
      .join('\n\n');

    const user = buildAgentUserPrompt({
      topic: sim.config.topic,
      round,
      side,
      priorSummary: prior || undefined,
      currentOpponentArgument,
    });

    if (this.llm.isConfigured()) {
      try {
        const intensity = sim.config.mutations.intensity / 100;
        const activeMutationBoost =
          sim.mutations[sim.mutations.length - 1]?.temperatureBoost ?? 0;
        const temp =
          sim.config.mode === 'shadow'
            ? 0.72 + intensity * 0.28 + activeMutationBoost
            : 0.35 + intensity * 0.18 + activeMutationBoost * 0.35;
        return await this.llmFreeText({
          system,
          user,
          model: sim.config.model,
          temperature: Math.min(temp, 1.15),
          trace: this.llmTrace(sim, round, side, 'agent'),
        });
      } catch (err) {
        this.logger.warn(`Agent LLM failed (${side}): ${String(err)}`);
        this.recordModerationError(sim, round, side, err);
        this.addWarning(
          sim,
          `Round ${round}: ${side} used fallback instead of Qwen.`,
        );
        await this.emitFallbackEvent(sim, round, side, err);
      }
    }

    return this.mockArgument(sim, side, round);
  }

  private async llmFreeText(params: {
    system: string;
    user: string;
    model?: string;
    temperature?: number;
    trace?: LlmTraceCallback;
  }): Promise<string> {
    const result = await this.llm.chatJson<{ argument: string }>({
      system: `${params.system}\n\nReturn ONLY JSON: { "argument": "your complete English argument" }`,
      user: params.user,
      model: params.model,
      temperature: params.temperature,
      trace: params.trace,
    });
    if (!result.argument?.trim()) {
      throw new Error('Empty argument from LLM');
    }
    return result.argument.trim();
  }

  private mockArgument(
    sim: Simulation,
    side: 'defender' | 'accuser',
    round: number,
  ): string {
    const topic = sim.config.topic;
    const mode = sim.config.mode;
    if (side === 'defender') {
      return mode === 'shadow'
        ? `[R${round} · Shadow · Defender] On "${topic}": the supporting position offers immediate benefits and a clear call to action. Its strongest case turns urgency into a concrete proposal while grounding claims in verifiable evidence and directly addressing costs.`
        : `[R${round} · Mirror · Defender] On "${topic}": the proposition should be supported with appropriate nuance. There are potential benefits, risks to mitigate, and a balance between freedom and responsibility. A gradual, transparent, and reviewable approach is preferable.`;
    }
    return mode === 'shadow'
      ? `[R${round} · Shadow · Accuser] On "${topic}": the proposition underestimates costs and critical assumptions. The strongest rebuttal contrasts its promises with measurable consequences, offers a clear alternative, and identifies where the evidence fails to support the conclusion.`
      : `[R${round} · Mirror · Accuser] On "${topic}": a legitimate critique identifies unaccounted costs, confirmation bias, and less harmful alternatives. Caution, evidence, and public deliberation are warranted before scaling the proposal.`;
  }

  private async generateMediator(
    sim: Simulation,
    round: number,
    defenderArgument: string,
    accuserArgument: string,
  ): Promise<string> {
    if (this.llm.isConfigured()) {
      try {
        const result = await this.llm.chatJson<{ analysis: string }>({
          system: mediatorSystemPrompt(sim.config.mode),
          user: [
            `Topic: ${sim.config.topic}`,
            `Round: ${round}`,
            `Defender: ${defenderArgument}`,
            `Accuser: ${accuserArgument}`,
          ].join('\n\n'),
          model: sim.config.model,
          temperature: 0.25,
          trace: this.llmTrace(sim, round, 'mediator', 'mediation'),
        });
        if (result.analysis?.trim()) return result.analysis.trim();
      } catch (err) {
        this.logger.warn(`Mediator LLM failed: ${String(err)}`);
        this.recordModerationError(sim, round, 'mediator', err);
        this.addWarning(
          sim,
          `Round ${round}: mediator used fallback instead of Qwen.`,
        );
        await this.emitFallbackEvent(sim, round, 'mediator', err);
      }
    }
    return `The central disagreement is which benefits and costs should receive priority. Both sides need comparable evidence and testable criteria; the decisive question is what concrete outcome would demonstrate that one position works better than the alternative.`;
  }

  private async applyMutation(
    sim: Simulation,
    round: number,
    favored: 'defender' | 'accuser',
    defenderArgument: string,
    accuserArgument: string,
    mediatorAnalysis: string,
  ): Promise<{ event: MutationEvent; messages: AgentMessage[] }> {
    let votes = this.fallbackPublicVotes(favored);
    if (this.llm.isConfigured()) {
      try {
        const result = await this.llm.chatJson<{
          votes: PublicVote[];
        }>({
          system: publicVoteSystemPrompt(),
          user: [
            `Topic: ${sim.config.topic}`,
            `Defender argument: ${defenderArgument}`,
            `Accuser argument: ${accuserArgument}`,
            `Mediator's neutral observation: ${mediatorAnalysis}`,
            `Audience before voting: Defender ${sim.audience.defender}% / Accuser ${sim.audience.accuser}%`,
          ].join('\n\n'),
          model: sim.config.model,
          temperature: 0.65,
          trace: this.llmTrace(sim, round, 'public', 'public_vote'),
        });
        const validated = this.validatePublicVotes(result.votes);
        if (validated) votes = validated;
      } catch (err) {
        this.logger.warn(`Public panel LLM failed: ${String(err)}`);
        this.recordModerationError(sim, round, 'public', err);
        this.addWarning(
          sim,
          `Round ${round}: public panel used fallback instead of Qwen.`,
        );
        await this.emitFallbackEvent(sim, round, 'public', err);
      }
    }

    const defenderVotes = votes.filter(
      (vote) => vote.favoredSide === 'defender',
    ).length;
    const side = defenderVotes >= 3 ? 'defender' : 'accuser';
    const intensity = sim.config.mutations.intensity / 100;
    const boost = 0.1 + intensity * 0.4;
    const audience = this.nudgeAudience(
      sim.audience,
      side,
      5 + intensity * 10,
    );
    const promptHint =
      side === 'defender'
        ? `Increase rhetorical intensity (+temp ~${boost.toFixed(2)}). Address the evidence that moved the audience toward the Defender.`
        : `Increase rhetorical intensity (+temp ~${boost.toFixed(2)}). Address the evidence that moved the audience toward the Accuser.`;

    return {
      event: {
        round,
        favoredSide: side,
        temperatureBoost: boost,
        promptHint,
        audience,
        publicVotes: votes,
      },
      messages: votes.map((vote) =>
        this.msg(
          round,
          'public',
          `Public ${vote.voter}`,
          `${vote.favoredSide === 'defender' ? 'Defender' : 'Accuser'}: ${vote.reason}`,
        ),
      ),
    };
  }

  private validatePublicVotes(votes: unknown): PublicVote[] | null {
    if (!Array.isArray(votes) || votes.length !== 5) return null;
    const normalized = votes.map((raw, index) => {
      const vote = raw as Partial<PublicVote>;
      if (
        vote.favoredSide !== 'defender' &&
        vote.favoredSide !== 'accuser'
      ) {
        return null;
      }
      return {
        voter: index + 1,
        favoredSide: vote.favoredSide,
        reason: String(vote.reason || 'More convincing argument.').slice(
          0,
          240,
        ),
      };
    });
    return normalized.every((vote): vote is PublicVote => vote !== null)
      ? normalized
      : null;
  }

  private fallbackPublicVotes(
    favored: 'defender' | 'accuser',
  ): PublicVote[] {
    const other = favored === 'defender' ? 'accuser' : 'defender';
    const sides: Array<'defender' | 'accuser'> = [
      favored,
      other,
      favored,
      other,
      favored,
    ];
    const reasons = [
      'Presented the most actionable proposal.',
      'Explained the risks and costs more clearly.',
      'Addressed the central issue more directly.',
      'Showed greater caution about missing evidence.',
      'Connected the conclusion to its premises more effectively.',
    ];
    return sides.map((favoredSide, index) => ({
      voter: index + 1,
      favoredSide,
      reason: reasons[index] ?? 'More convincing argument.',
    }));
  }

  private llmTrace(
    sim: Simulation,
    round: number,
    actor: ModerationActor,
    phase: string,
  ): LlmTraceCallback {
    return async (entry: LlmTraceEntry) => {
      await this.events.append({
        simulationId: sim.id,
        executionId: sim.executionId ?? sim.id,
        type: entry.type,
        level: entry.level,
        phase,
        actor,
        round,
        message: entry.message,
        details: entry.details,
      });
    };
  }

  private async emitEvent(
    sim: Simulation,
    event: Omit<
      AppendExecutionEvent,
      'simulationId' | 'executionId'
    >,
  ): Promise<void> {
    try {
      await this.events.append({
        simulationId: sim.id,
        executionId: sim.executionId ?? sim.id,
        ...event,
      });
    } catch (error) {
      this.logger.warn(`Failed to persist execution event: ${String(error)}`);
    }
  }

  private async emitFallbackEvent(
    sim: Simulation,
    round: number,
    actor: ModerationActor,
    error: unknown,
  ): Promise<void> {
    const moderationBlocked =
      error instanceof QwenApiError && error.isModerationBlock;
    const latestModeration = moderationBlocked
      ? sim.moderationEvents
          ?.slice()
          .reverse()
          .find((event) => event.round === round && event.actor === actor)
      : undefined;
    await this.emitEvent(sim, {
      type: moderationBlocked ? 'moderation.blocked' : 'agent.fallback',
      level: 'warn',
      phase: actor === 'public' ? 'public_vote' : 'agent',
      actor,
      round,
      message: moderationBlocked
        ? `${actor} request was blocked by provider moderation.`
        : `${actor} used a deterministic fallback.`,
      details: {
        fallback: true,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: error instanceof Error ? error.message : String(error),
        ...(latestModeration ? { moderation: latestModeration } : {}),
      },
    });
  }

  private recordModerationError(
    sim: Simulation,
    round: number,
    actor: ModerationActor,
    error: unknown,
  ): void {
    if (!(error instanceof QwenApiError) || !error.isModerationBlock) return;
    this.addModerationEvent(
      sim,
      round,
      actor,
      error.code,
      error.requestId,
    );
  }

  private addModerationEvent(
    sim: Simulation,
    round: number,
    actor: ModerationActor,
    errorCode: string,
    requestId?: string,
  ): void {
    sim.moderationEvents ??= [];
    const duplicate = sim.moderationEvents.some(
      (event) =>
        event.round === round &&
        event.actor === actor &&
        event.requestId === requestId &&
        event.errorCode === errorCode,
    );
    if (duplicate) return;

    const event: ModerationEvent = {
      round,
      actor,
      provider: 'dashscope',
      errorCode,
      ...(requestId ? { requestId } : {}),
      primaryCategory: 'content_moderation_filter',
      confidence: 'high',
      inspectionStage: 'input_or_output_unknown',
      explanation:
        'DashScope rejected the request during automated data inspection. The API does not reveal whether the input or generated output triggered the block.',
      possibleUnderlyingMechanisms: [
        'safety_alignment',
        'corporate_policy',
        'contextual_risk_detection',
      ],
      occurredAt: new Date().toISOString(),
    };
    sim.moderationEvents.push(event);
  }

  private addWarning(sim: Simulation, warning: string): void {
    sim.warnings ??= [];
    if (!sim.warnings.includes(warning)) sim.warnings.push(warning);
  }

  private nudgeAudience(
    current: AudienceState,
    side: 'defender' | 'accuser',
    delta: number,
  ): AudienceState {
    let defender = current.defender;
    let accuser = current.accuser;
    if (side === 'defender') {
      defender = Math.min(90, defender + delta);
      accuser = 100 - defender;
    } else {
      accuser = Math.min(90, accuser + delta);
      defender = 100 - accuser;
    }
    return {
      defender: Math.round(defender * 10) / 10,
      accuser: Math.round(accuser * 10) / 10,
    };
  }

  private latestMutationHint(sim: Simulation): string | undefined {
    const last = sim.mutations[sim.mutations.length - 1];
    return last?.promptHint;
  }

  private computeMetrics(sim: Simulation): SimulationMetrics {
    const audienceGrowth = { ...sim.audience };
    const judgments = sim.judgments;
    if (!judgments.length) {
      return { ...this.emptyMetrics(), audienceGrowth };
    }

    const avgPersuasion =
      judgments.reduce(
        (s, j) =>
          s + (j.defenderScore.persuasion + j.accuserScore.persuasion) / 2,
        0,
      ) / judgments.length;
    const avgCoherence =
      judgments.reduce(
        (s, j) =>
          s + (j.defenderScore.coherence + j.accuserScore.coherence) / 2,
        0,
      ) / judgments.length;

    let convergence: number | null = null;
    for (const m of sim.mutations) {
      if (Math.abs(m.audience.defender - m.audience.accuser) > 20) {
        convergence = m.round;
        break;
      }
    }

    const societalRevealIndex =
      sim.config.mode === 'shadow'
        ? Math.min(
            100,
            Math.round(
              avgPersuasion * 8 + Math.abs(audienceGrowth.defender - 50),
            ),
          )
        : Math.min(100, Math.max(0, Math.round(avgCoherence * 10)));

    const moralDecayScore =
      sim.config.mode === 'shadow'
        ? Math.min(
            100,
            Math.max(
              0,
              Math.round((avgPersuasion - avgCoherence + 5) * 10),
            ),
          )
        : Math.min(100, Math.round(Math.max(0, 5 - avgCoherence) * 8));

    return {
      societalRevealIndex,
      moralDecayScore,
      audienceGrowth,
      convergenceSpeedRounds: convergence,
      averagePersuasionShadow:
        sim.config.mode === 'shadow'
          ? Math.round(avgPersuasion * 100) / 100
          : null,
      averageCoherenceMirror:
        sim.config.mode === 'mirror'
          ? Math.round(avgCoherence * 100) / 100
          : null,
    };
  }

  private emptyMetrics(): SimulationMetrics {
    return {
      societalRevealIndex: null,
      moralDecayScore: null,
      audienceGrowth: { defender: 50, accuser: 50 },
      convergenceSpeedRounds: null,
      averagePersuasionShadow: null,
      averageCoherenceMirror: null,
    };
  }

  private msg(
    round: number,
    role: AgentMessage['role'],
    agentName: string,
    content: string,
  ): AgentMessage {
    return {
      id: randomUUID(),
      round,
      role,
      agentName,
      content,
      createdAt: new Date().toISOString(),
    };
  }
}
