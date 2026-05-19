import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class NewManhourEmployeeDto {
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
  department?: string | null;
}

export class ManhourAssigneeResolutionDto {
  @IsString()
  name!: string;

  @IsIn(['link', 'create', 'skip'])
  action!: 'link' | 'create' | 'skip';

  @IsOptional()
  @IsInt()
  assigneeId?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => NewManhourEmployeeDto)
  newEmployee?: NewManhourEmployeeDto;
}

export class ManhourProjectResolutionDto {
  /** parser が割り当てた案件キー (`cd:<CD>` / `nm:<件名>`)。 */
  @IsString()
  projectKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  projectCode?: string | null;

  @IsIn(['link', 'createProvisional'])
  action!: 'link' | 'createProvisional';

  @IsOptional()
  @IsInt()
  projectId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  provisionalName?: string;

  @IsOptional()
  @IsInt()
  customerId?: number | null;
}

export class ManhourEntryRowDto {
  @IsString()
  assigneeName!: string;

  /** zz(非稼働) は projectKey なし。 */
  @IsOptional()
  @IsString()
  projectKey?: string | null;

  @IsString()
  @MaxLength(8)
  workType!: string;

  @Matches(/^\d{4}-\d{2}$/)
  yearMonth!: string;

  @IsNumber()
  hours!: number;
}

export class ManhourCapacityRowDto {
  @IsString()
  assigneeName!: string;

  @Matches(/^\d{4}-\d{2}$/)
  yearMonth!: string;

  @IsNumber()
  baseHours!: number;
}

export class CommitManhourImportDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName!: string;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  fiscalYear!: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  orgCode?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManhourAssigneeResolutionDto)
  assigneeResolution!: ManhourAssigneeResolutionDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManhourProjectResolutionDto)
  projectResolution!: ManhourProjectResolutionDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManhourEntryRowDto)
  entries!: ManhourEntryRowDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManhourCapacityRowDto)
  capacities!: ManhourCapacityRowDto[];
}
