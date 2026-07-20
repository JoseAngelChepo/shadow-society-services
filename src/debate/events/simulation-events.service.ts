import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import {
  SimulationEntity,
  type SimulationDocument,
} from '../schemas/simulation.schema';
import {
  SimulationExecutionEvent,
  type SimulationExecutionEventDocument,
} from '../schemas/simulation-execution-event.schema';
import type {
  AppendExecutionEvent,
  ExecutionEvent,
} from './simulation-events.types';

@Injectable()
export class SimulationEventsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(SimulationEntity.name)
    private readonly simulationModel: Model<SimulationDocument>,
    @InjectModel(SimulationExecutionEvent.name)
    private readonly eventModel: Model<SimulationExecutionEventDocument>,
  ) {}

  async append(input: AppendExecutionEvent): Promise<ExecutionEvent> {
    let result: ExecutionEvent | undefined;
    await this.connection.transaction(async (session) => {
      const simulation = await this.simulationModel
        .findOneAndUpdate(
          { id: input.simulationId },
          { $inc: { eventSequence: 1 } },
          { new: true, session },
        )
        .select({ eventSequence: 1 })
        .lean()
        .exec();
      if (!simulation) {
        throw new NotFoundException(
          `Simulation ${input.simulationId} not found`,
        );
      }

      const occurredAt = new Date().toISOString();
      const [created] = await this.eventModel.create(
        [
          {
            ...input,
            sequence: simulation.eventSequence,
            level: input.level ?? 'info',
            details: input.details
              ? this.sanitizeDetails(input.details)
              : undefined,
            schemaVersion: 1,
            occurredAt,
          },
        ],
        { session },
      );
      if (!created) throw new Error('Failed to persist execution event');
      result = this.toEvent(created.toObject());
    });
    if (!result) throw new Error('Execution event transaction did not commit');
    return result;
  }

  async list(
    simulationId: string,
    after = 0,
    limit = 200,
  ): Promise<ExecutionEvent[]> {
    const docs = await this.eventModel
      .find({ simulationId, sequence: { $gt: Math.max(0, after) } })
      .sort({ sequence: 1 })
      .limit(Math.min(500, Math.max(1, limit)))
      .lean()
      .exec();
    return docs.map((doc) => this.toEvent(doc));
  }

  private toEvent(
    doc: SimulationExecutionEvent | Record<string, unknown>,
  ): ExecutionEvent {
    const event = doc as SimulationExecutionEvent;
    return {
      simulationId: event.simulationId,
      executionId: event.executionId,
      sequence: event.sequence,
      type: event.type,
      level: event.level,
      phase: event.phase,
      ...(event.actor ? { actor: event.actor } : {}),
      ...(event.round != null ? { round: event.round } : {}),
      message: event.message,
      ...(event.details ? { details: event.details } : {}),
      schemaVersion: event.schemaVersion,
      occurredAt: event.occurredAt,
    };
  }

  private sanitizeDetails(
    value: Record<string, unknown>,
  ): Record<string, unknown> {
    return this.sanitizeValue(value, 0) as Record<string, unknown>;
  }

  private sanitizeValue(value: unknown, depth: number): unknown {
    if (depth > 12) return '[MAX_DEPTH]';
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item, depth + 1));
    }
    if (!value || typeof value !== 'object') return value;

    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (
        /authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|secret|cookie/i.test(
          key,
        )
      ) {
        output[key] = '[REDACTED]';
      } else {
        output[key] = this.sanitizeValue(item, depth + 1);
      }
    }
    return output;
  }
}
