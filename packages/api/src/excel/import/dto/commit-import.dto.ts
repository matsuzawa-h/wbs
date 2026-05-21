import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ParsedTaskDto } from './parsed-task.dto';

export class NewEmployeeDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  code?: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameKana?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  employmentStart?: string | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  employmentEnd?: string | null;

  @IsOptional()
  @IsBoolean()
  worksOnHolidays?: boolean;
}

export class AssigneeResolutionDto {
  @IsString()
  name!: string;

  @IsIn(['link', 'create', 'skip'])
  action!: 'link' | 'create' | 'skip';

  @IsOptional()
  @IsInt()
  employeeId?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => NewEmployeeDto)
  newEmployee?: NewEmployeeDto;
}

export class CommitImportDto {
  @IsOptional()
  @IsInt()
  customerId!: number | null;

  // プロジェクト概要画面の組織割当と整合。未指定（null）なら所属なしで作成。
  @IsOptional()
  @IsInt()
  organizationId?: number | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  projectName!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ParsedTaskDto)
  schedule!: ParsedTaskDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssigneeResolutionDto)
  assigneeResolution!: AssigneeResolutionDto[];
}
