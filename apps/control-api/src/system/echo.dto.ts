import { ApiProperty } from '@nestjs/swagger'
import { IsString, Length } from 'class-validator'

export class EchoQuery {
  @ApiProperty({ example: 'hello', maxLength: 64, minLength: 1 })
  @IsString()
  @Length(1, 64)
  message!: string
}
