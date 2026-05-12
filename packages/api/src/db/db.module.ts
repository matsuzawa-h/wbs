import { Global, Module } from '@nestjs/common';
import { getDb, AppDb } from './index';

export const DB_TOKEN = Symbol('DB_TOKEN');

@Global()
@Module({
  providers: [
    {
      provide: DB_TOKEN,
      useFactory: (): AppDb => getDb(),
    },
  ],
  exports: [DB_TOKEN],
})
export class DbModule {}
