// src/users/users.service.ts
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private repo: Repository<User>) {}

  async create(dto: CreateUserDto): Promise<Omit<User, 'passwordHash'>> {
    const exists = await this.repo.findOne({ where: { email: dto.email } });
    if (exists) throw new BadRequestException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = this.repo.create({
      email: dto.email,
      passwordHash,
      name: dto.name,
      role: dto.role ?? 'viewer',
    });
    const saved = await this.repo.save(user);
    // strip hash
    const { passwordHash: _, ...safe } = saved as any;
    return safe;
  }

  async findAll(): Promise<Omit<User, 'passwordHash'>[]> {
    return this.repo.find(); // passwordHash is select:false, so it won’t come back
  }

  async findOne(id: number): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async update(id: number, dto: UpdateUserDto): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    if (dto.email && dto.email !== user.email) {
      const taken = await this.repo.findOne({ where: { email: dto.email } });
      if (taken) throw new BadRequestException('Email already in use');
      user.email = dto.email;
    }

    if (dto.password) {
      user.passwordHash = await bcrypt.hash(dto.password, 10);
    }

    if (dto.name !== undefined) user.name = dto.name;
    if (dto.role) user.role = dto.role;

    const saved = await this.repo.save(user);
    const { passwordHash: _, ...safe } = saved as any;
    return safe;
  }

  async remove(id: number): Promise<{ deleted: true }> {
    const result = await this.repo.delete({ id } as FindOptionsWhere<User>);
    if (result.affected === 0) throw new NotFoundException('User not found');
    return { deleted: true };
  }

  // helper for future auth (email + password check)
  async findByEmailWithHash(email: string) {
    return this.repo
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email', { email })
      .getOne();
  }
}
