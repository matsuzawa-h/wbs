import { ArrayMinSize, IsArray, IsInt, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ReorderItemDto {
  @IsInt()
  id!: number;

  @IsInt()
  sortOrder!: number;
}

export class ReorderTasksDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReorderItemDto)
  items!: ReorderItemDto[];
}
