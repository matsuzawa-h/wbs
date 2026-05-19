import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * 稼働見通し用の仮プロジェクトを手動作成する（is_provisional = 1）。
 */
export class ManualProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  projectCode?: string | null;

  @IsOptional()
  @IsInt()
  customerId?: number | null;
}
