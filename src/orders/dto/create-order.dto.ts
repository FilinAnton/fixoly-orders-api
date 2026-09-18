import { ApiProperty } from '@nestjs/swagger';
import { WindowType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsString,
  MaxLength,
  MinLength,
  Min,
} from 'class-validator';

export class CreateOrderDto {
  @ApiProperty({ example: 'Jane Smith' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  clientName!: string;

  @ApiProperty({ example: '42 King Street, Toronto, ON' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  address!: string;

  @ApiProperty({ enum: WindowType, example: WindowType.tilt_turn })
  @IsEnum(WindowType)
  windowType!: WindowType;

  @ApiProperty({ example: 120.5, description: 'Width in centimeters' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  width!: number;

  @ApiProperty({ example: 140, description: 'Height in centimeters' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  height!: number;
}
