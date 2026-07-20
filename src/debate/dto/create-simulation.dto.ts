import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class MutationsDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  intensity!: number;

  @IsBoolean()
  publicInfluence!: boolean;

  @IsIn(['fast', 'normal'])
  speed!: 'fast' | 'normal';
}

export class CreateSimulationDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  topic!: string;

  @IsString()
  @IsIn(['qwen-plus', 'qwen-turbo', 'qwen-max'])
  model!: string;

  @IsIn(['mirror', 'shadow'])
  mode!: 'mirror' | 'shadow';

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => MutationsDto)
  mutations!: MutationsDto;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  totalRounds?: number;
}

export class AdvanceSimulationDto {
  @IsOptional()
  @IsBoolean()
  runToEnd?: boolean;
}
