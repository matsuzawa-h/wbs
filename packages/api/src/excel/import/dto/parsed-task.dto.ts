import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ParsedTaskDto {
  @IsInt()
  index!: number;

  @IsIn([1, 2, 3])
  level!: 1 | 2 | 3;

  @IsOptional()
  @IsInt()
  parentIndex!: number | null;

  @IsString()
  name!: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate!: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  duration!: number | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  actualStartDate!: string | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  actualEndDate!: string | null;

  @IsOptional()
  @IsNumber()
  actualHours!: number | null;

  @IsInt()
  @Min(0)
  @Max(100)
  progress!: number;

  @IsString()
  status!: string;

  @IsOptional()
  @IsString()
  assigneeName!: string | null;
}

export class ParsedTaskArrayWrapper {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ParsedTaskDto)
  schedule!: ParsedTaskDto[];
}
