import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  MessageEvent,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  Sse,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { DebateService } from './debate.service';
import { JudgeService } from './judge/judge.service';
import { SimulationEventsService } from './events/simulation-events.service';
import {
  CreateSimulationDto,
  AdvanceSimulationDto,
} from './dto/create-simulation.dto';
import { JudgeRoundDto } from './dto/judge-round.dto';

/**
 * Public debate API — no auth in v0.
 * Simulations persist to MongoDB Atlas.
 */
@Controller('debate')
export class DebateController {
  constructor(
    private readonly debate: DebateService,
    private readonly judge: JudgeService,
    private readonly events: SimulationEventsService,
  ) {}

  @Get('models')
  listModels() {
    return {
      models: [
        { id: 'qwen-plus', label: 'Qwen Plus (default)' },
        { id: 'qwen-turbo', label: 'Qwen Turbo' },
        { id: 'qwen-max', label: 'Qwen Max' },
      ],
    };
  }

  @Post('judge')
  async judgeRound(@Body() dto: JudgeRoundDto) {
    return this.judge.judgeRound(dto);
  }

  @Get('simulations')
  async list() {
    return { items: await this.debate.list() };
  }

  @Get('runs')
  listRuns(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.debate.listRuns(Number(limit) || 20, cursor);
  }

  @Post('simulations')
  create(@Body() dto: CreateSimulationDto) {
    return this.debate.create(dto);
  }

  @Get('simulations/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.debate.get(id);
  }

  @Post('simulations/:id/advance')
  advance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdvanceSimulationDto,
    @Query('runToEnd') runToEndQuery?: string,
  ) {
    const runToEnd =
      body?.runToEnd === true ||
      runToEndQuery === '1' ||
      runToEndQuery === 'true';
    return this.debate.advance(id, runToEnd);
  }

  @Post('simulations/:id/run')
  @HttpCode(202)
  run(@Param('id', ParseUUIDPipe) id: string) {
    return this.debate.startRun(id);
  }

  @Get('simulations/:id/events')
  async eventHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('after') after?: string,
    @Query('limit') limit?: string,
  ) {
    await this.debate.get(id);
    const items = await this.events.list(
      id,
      Number(after) || 0,
      Number(limit) || 200,
    );
    return {
      items,
      nextCursor: items.length
        ? items[items.length - 1]?.sequence ?? null
        : null,
    };
  }

  @Sse('simulations/:id/stream')
  stream(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('after') after?: string,
    @Headers('last-event-id') lastEventId?: string,
    @Req() request?: Request,
    @Res({ passthrough: true }) response?: Response,
  ): Observable<MessageEvent> {
    response?.setHeader('Cache-Control', 'no-cache, no-transform');
    response?.setHeader('X-Accel-Buffering', 'no');
    const initialCursor = Math.max(
      Number(after) || 0,
      Number(lastEventId) || 0,
    );

    return new Observable<MessageEvent>((subscriber) => {
      let cursor = initialCursor;
      let polling = false;
      let closed = false;
      let heartbeatAt = Date.now();

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
      };

      const poll = async () => {
        if (polling || closed) return;
        polling = true;
        try {
          const events = await this.events.list(id, cursor, 100);
          for (const event of events) {
            if (closed || event.sequence <= cursor) continue;
            cursor = event.sequence;
            subscriber.next({
              id: String(event.sequence),
              type: event.type,
              retry: 3000,
              data: event,
            });
            if (
              event.type === 'execution.completed' ||
              event.type === 'execution.failed'
            ) {
              const current = await this.debate.get(id);
              if (current.executionId === event.executionId) {
                subscriber.complete();
                cleanup();
                return;
              }
            }
          }
          if (Date.now() - heartbeatAt >= 15_000) {
            heartbeatAt = Date.now();
            subscriber.next({
              type: 'heartbeat',
              data: { simulationId: id, cursor, occurredAt: new Date().toISOString() },
            });
          }
        } catch (error) {
          subscriber.error(error);
          cleanup();
        } finally {
          polling = false;
        }
      };

      const timer = setInterval(() => {
        void poll();
      }, 700);
      request?.on('close', cleanup);
      void poll();
      return cleanup;
    });
  }
}
