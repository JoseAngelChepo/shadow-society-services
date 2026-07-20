import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DebateController } from './debate.controller';
import { DebateService } from './debate.service';
import { JudgeService } from './judge/judge.service';
import { QwenLlmService } from './llm/qwen-llm.service';
import {
  SimulationEntity,
  SimulationSchema,
} from './schemas/simulation.schema';
import {
  SimulationExecutionEvent,
  SimulationExecutionEventSchema,
} from './schemas/simulation-execution-event.schema';
import { SimulationEventsService } from './events/simulation-events.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SimulationEntity.name, schema: SimulationSchema },
      {
        name: SimulationExecutionEvent.name,
        schema: SimulationExecutionEventSchema,
      },
    ]),
  ],
  controllers: [DebateController],
  providers: [
    DebateService,
    JudgeService,
    QwenLlmService,
    SimulationEventsService,
  ],
  exports: [
    DebateService,
    JudgeService,
    QwenLlmService,
    SimulationEventsService,
  ],
})
export class DebateModule {}
