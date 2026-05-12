import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  name?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate must be YYYY-MM-DD' })
  startDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  duration?: number;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'actualStartDate must be YYYY-MM-DD' })
  actualStartDate?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'actualEndDate must be YYYY-MM-DD' })
  actualEndDate?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber()
  @Min(0)
  plannedHours?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber()
  @Min(0)
  actualHours?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @IsOptional()
  @IsInt()
  assigneeId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  status?: string;
}
