import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsInt } from 'class-validator';

export class SetMembersDto {
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Type(() => Number)
  employeeIds!: number[];
}
