import { IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

/** Direct Judge endpoint — evaluate one round without full simulation. */
export class JudgeRoundDto {
  @IsString()
  @MinLength(3)
  topic!: string;

  @IsInt()
  @Min(1)
  @Max(20)
  round!: number;

  @IsIn(['mirror', 'shadow'])
  mode!: 'mirror' | 'shadow';

  @IsString()
  @MinLength(1)
  defenderArgument!: string;

  @IsString()
  @MinLength(1)
  accuserArgument!: string;

  @IsOptional()
  @IsString()
  model?: string;
}
