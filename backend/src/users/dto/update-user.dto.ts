// src/users/dto/update-user.dto.ts
import { IsEmail, IsOptional, MinLength, IsString, IsIn } from 'class-validator';

export class UpdateUserDto {
  @IsOptional() @IsEmail()
  email?: string;

  @IsOptional() @IsString() @MinLength(8)
  password?: string;

  @IsOptional() @IsString()
  name?: string;

  @IsOptional() @IsIn(['admin', 'pilot', 'viewer'])
  role?: 'admin' | 'pilot' | 'viewer';
}
