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

export class NewManhourCustomerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  code?: string | null;
}

export class ManhourCustomerResolutionDto {
  /** CSV「顧客名」(E列)。 */
  @IsString()
  name!: string;

  @IsIn(['link', 'create', 'skip'])
  action!: 'link' | 'create' | 'skip';

  @IsOptional()
  @IsInt()
  customerId?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => NewManhourCustomerDto)
  newCustomer?: NewManhourCustomerDto;
}

export class ManhourProjectResolutionDto {
  /** parser が割り当てた案件キー (`cd:<CD>` / `nm:<件名>`)。 */
  @IsString()
  projectKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  projectCode?: string | null;

  // link        = 既存プロジェクトに紐付け（複数CDが同じ projectId を指せば束ね）
  // newGroup     = 同じ groupKey のCDを 1 つの新規プロジェクトに束ねて作成
  // labelOnly    = projects マスタを作らず件名ラベルだけで計上（CD無し既定）
  @IsIn(['link', 'newGroup', 'labelOnly'])
  action!: 'link' | 'newGroup' | 'labelOnly';

  @IsOptional()
  @IsInt()
  projectId?: number;

  /** newGroup: 同一 groupKey のCDを 1 プロジェクトに集約。 */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  groupKey?: string;

  /** newGroup: 新規プロジェクト名（編集可。既定は件名ステム）。 */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  groupName?: string;

  /** この案件の CSV顧客名。新規作成時に顧客名寄せ結果で顧客へ紐づける。 */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerName?: string | null;
}

export class NewManhourOrganizationDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  code?: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;
}

export class ManhourOrganizationResolutionDto {
  // link    = 既存の組織に紐付け（CSV組織コードの一致候補）
  // create  = 新規組織を作成（CSV組織コード/名称をそのまま）
  // skip    = 組織を紐付けない（作成エンティティは organization_id NULL）
  @IsIn(['link', 'create', 'skip'])
  action!: 'link' | 'create' | 'skip';

  @IsOptional()
  @IsInt()
  organizationId?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => NewManhourOrganizationDto)
  newOrganization?: NewManhourOrganizationDto;
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

  /** project 化しない明細の内訳ラベル（件名）。 */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string | null;

  /** CSV顧客名(E列)の生値（明細表示用・顧客マスタ非依存）。 */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerLabel?: string | null;
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

  /** CSV組織の解決（未指定なら NULL のまま作成エンティティに紐付けない）。 */
  @IsOptional()
  @ValidateNested()
  @Type(() => ManhourOrganizationResolutionDto)
  organizationResolution?: ManhourOrganizationResolutionDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManhourAssigneeResolutionDto)
  assigneeResolution!: ManhourAssigneeResolutionDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManhourCustomerResolutionDto)
  customerResolution!: ManhourCustomerResolutionDto[];

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
