// src/users/dto/create-user.dto.ts
import { IsEmail, IsNotEmpty, MinLength, IsString, IsOptional, IsIn } from 'class-validator';

export class CreateUserDto {
  @IsEmail() email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsIn(['admin', 'pilot', 'viewer'])
  role?: 'admin' | 'pilot' | 'viewer';
}
