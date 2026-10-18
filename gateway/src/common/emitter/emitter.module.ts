import { Global, Module } from '@nestjs/common';
import { UserEmitter } from './user-emitter.service';

@Global()
@Module({ providers: [UserEmitter], exports: [UserEmitter] })
export class EmitterModule {}
