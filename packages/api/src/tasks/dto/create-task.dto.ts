import {
  IsInt,
  IsNotEmpty,
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

  @IsString()
  @IsNotEmpty()
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
