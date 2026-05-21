import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * 仮プロジェクトの月工数を手入力する（担当者×案件×作業区分×年月で upsert）。
 * batch_id = NULL / source = 'manual' で保存され、再取込に影響されない。
 */
export class ManualEntryDto {
  @IsInt()
  assigneeId!: number;

  // 非稼働(zz相当)など案件に紐づかない手入力は null 可。
  @IsOptional()
  @IsInt()
  projectId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  workType?: string;

  @Matches(/^\d{4}-\d{2}$/)
  yearMonth!: string;

  // 取込(imported)を上書きする「manual overlay」を表現するため負の値も許可。
  // 表示上の total（imported + manual）を編集 popup で下げるユースケース：
  //   manual = newTotal - imported （負になり得る）。
  // hours === 0 は manual の明示削除（imported のみに戻す）。
  @IsNumber()
  hours!: number;
}
