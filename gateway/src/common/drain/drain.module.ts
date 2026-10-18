import { Global, Module } from '@nestjs/common';
import { DrainService } from './drain.service';

@Global()
@Module({ providers: [DrainService], exports: [DrainService] })
export class DrainModule {}
