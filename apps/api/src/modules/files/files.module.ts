import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AUDIT_LOGGER, type AuditLogger } from '../../shared/application/audit-log.js';
import { ENV } from '../../shared/config/config.module.js';
import type { Env } from '../../shared/config/env.js';
import { CLOCK } from '../../shared/infra/core.module.js';
import { DatabaseContext } from '../../shared/infra/database/database-context.js';
import { ID_GENERATOR } from '../../shared/infra/id/uuid-v7.generator.js';
import { QueueName } from '../../shared/infra/queue/queue-names.js';
import type { Clock } from '../../shared/kernel/clock.js';
import type { IdGenerator } from '../../shared/kernel/domain-event.js';
import {
  FILES_DEPS,
  type FilesDeps,
  type MalwareScanner,
  type ObjectStorage,
} from './application/ports.js';
import {
  CompleteUpload,
  CreateUpload,
  ReadFile,
  ScanUploadedFile,
} from './application/use-cases.js';
import { ClamAvScanner, DisabledMalwareScanner } from './infrastructure/clamav-scanner.js';
import { DrizzleFileRepository } from './infrastructure/drizzle-file.repository.js';
import { S3ObjectStorage } from './infrastructure/s3-object-storage.js';
import { FilesController, FileScanProcessor } from './interface/files.controller.js';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
export const MALWARE_SCANNER = Symbol('MALWARE_SCANNER');

/** Providers comuns ao processo HTTP e ao worker. */
const sharedProviders = [
  {
    provide: OBJECT_STORAGE,
    inject: [ENV],
    useFactory: (env: Env): ObjectStorage =>
      new S3ObjectStorage({
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION,
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
        buckets: { quarantine: env.S3_BUCKET_QUARANTINE, files: env.S3_BUCKET_FILES },
      }),
  },
  {
    provide: MALWARE_SCANNER,
    inject: [ENV],
    useFactory: (env: Env): MalwareScanner =>
      env.MALWARE_SCAN === 'clamav'
        ? new ClamAvScanner(env.CLAMAV_HOST, env.CLAMAV_PORT)
        : new DisabledMalwareScanner(),
  },
  {
    provide: FILES_DEPS,
    inject: [
      DatabaseContext,
      ID_GENERATOR,
      CLOCK,
      AUDIT_LOGGER,
      OBJECT_STORAGE,
      MALWARE_SCANNER,
      getQueueToken(QueueName.Files),
    ],
    useFactory: (
      ctx: DatabaseContext,
      ids: IdGenerator,
      clock: Clock,
      audit: AuditLogger,
      storage: ObjectStorage,
      scanner: MalwareScanner,
      queue: Queue<{ fileId: string }>,
    ): FilesDeps => ({
      files: new DrizzleFileRepository(ctx, ids),
      storage,
      scanner,
      scheduler: {
        schedule: async (fileId) => {
          // jobId fixo: confirmar o upload duas vezes não agenda duas verificações.
          await queue.add(
            'scan',
            { fileId },
            {
              jobId: `scan:${fileId}`,
              attempts: 10,
              backoff: { type: 'exponential', delay: 15_000 },
            },
          );
        },
      },
      audit,
      uow: ctx,
      clock,
      ids,
    }),
  },
  ...[CreateUpload, CompleteUpload, ReadFile, ScanUploadedFile].map((UseCase) => ({
    provide: UseCase,
    inject: [FILES_DEPS],
    useFactory: (deps: FilesDeps) => new UseCase(deps),
  })),
];

@Module({
  imports: [BullModule.registerQueue({ name: QueueName.Files })],
  controllers: [FilesController],
  providers: sharedProviders,
})
export class FilesModule {}

@Module({
  imports: [BullModule.registerQueue({ name: QueueName.Files })],
  providers: [...sharedProviders, FileScanProcessor],
})
export class FilesWorkerModule {}
