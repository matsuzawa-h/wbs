import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateTaskDto {
  @IsInt()
  @Min(1)
  @Max(3)
  level!: number;

  @IsOptional()
  @IsInt()
  parentId?: number | null;

  // Name may be empty: the UI inserts a row first and lets the user type
  // the name inline. Multiple users want to add several rows in a row
  // without being interrupted by a name prompt.
  @IsString()
  @MaxLength(500)
  name!: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate must be YYYY-MM-DD' })
  startDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  duration?: number;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'actualStartDate must be YYYY-MM-DD' })
  actualStartDate?: string | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'actualEndDate must be YYYY-MM-DD' })
  actualEndDate?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  plannedHours?: number | null;

  @IsOptional()
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

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
