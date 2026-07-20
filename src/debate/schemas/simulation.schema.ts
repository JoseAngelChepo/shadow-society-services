import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type {
  AgentMessage,
  AudienceState,
  ModerationEvent,
  MutationEvent,
  RoundJudgment,
  SimulationConfig,
  SimulationMetrics,
  SimulationStatus,
} from '../types/simulation.types';

export type SimulationDocument = HydratedDocument<SimulationEntity>;

@Schema({ collection: 'simulations', timestamps: false })
export class SimulationEntity {
  @Prop({ required: true, unique: true, index: true })
  id!: string;

  @Prop({ required: true })
  status!: SimulationStatus;

  @Prop({ type: Object, required: true })
  config!: SimulationConfig;

  @Prop({ required: true, default: 0 })
  currentRound!: number;

  @Prop({ type: [Object], default: [] })
  messages!: AgentMessage[];

  @Prop({ type: [Object], default: [] })
  judgments!: RoundJudgment[];

  @Prop({ type: [Object], default: [] })
  mutations!: MutationEvent[];

  @Prop({ type: Object, required: true })
  audience!: AudienceState;

  @Prop({ type: Object, required: true })
  metrics!: SimulationMetrics;

  @Prop({ required: true })
  createdAt!: string;

  @Prop({ required: true })
  updatedAt!: string;

  @Prop()
  completedAt?: string;

  @Prop()
  error?: string;

  @Prop({ type: [String], default: [] })
  warnings?: string[];

  @Prop({ type: [Object], default: [] })
  moderationEvents?: ModerationEvent[];

  @Prop({ required: true, default: 0 })
  eventSequence!: number;

  @Prop()
  executionId?: string;

  @Prop({ type: Object })
  executionLease?: {
    leaseId: string;
    expiresAt: string;
  };
}

export const SimulationSchema = SchemaFactory.createForClass(SimulationEntity);
