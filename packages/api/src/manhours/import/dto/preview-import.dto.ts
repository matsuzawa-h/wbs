import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class PreviewImportDto {
  // multipart のテキストフィールドは文字列で届くため Number に変換。
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  fiscalYear!: number;
}
