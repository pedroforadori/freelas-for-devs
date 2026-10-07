import type { AuditLogger } from '../../../shared/application/audit-log.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import type { Clock } from '../../../shared/kernel/clock.js';
import type { IdGenerator } from '../../../shared/kernel/domain-event.js';
import type { StoredFile } from '../domain/stored-file.js';

export interface FileRepository {
  find(id: string): Promise<StoredFile | null>;
  save(file: StoredFile): Promise<void>;
}

export type Bucket = 'quarantine' | 'files';

/** Storage S3-compatível (Cloudflare R2 em produção, MinIO em dev). */
export interface ObjectStorage {
  /** URL PUT pré-assinada com Content-Type e Content-Length exatos na assinatura. */
  presignUpload(input: {
    key: string;
    contentType: string;
    size: number;
    expiresInSeconds: number;
  }): Promise<{ url: string; method: 'PUT'; headers: Record<string, string> }>;
  presignDownload(input: {
    key: string;
    fileName: string;
    expiresInSeconds: number;
  }): Promise<string>;
  /** Tamanho real do objeto, ou null se não existe. */
  size(bucket: Bucket, key: string): Promise<number | null>;
  readHead(bucket: Bucket, key: string, bytes: number): Promise<Uint8Array>;
  readAll(bucket: Bucket, key: string): Promise<Uint8Array>;
  /** Move da quarentena para o bucket definitivo. */
  promote(fromKey: string, toKey: string): Promise<void>;
  remove(bucket: Bucket, key: string): Promise<void>;
}

export type ScanVerdict = { clean: true } | { clean: false; signature: string };

export interface MalwareScanner {
  scan(content: Uint8Array): Promise<ScanVerdict>;
}

/** Agenda a verificação assíncrona (worker). */
export interface FileScanScheduler {
  schedule(fileId: string): Promise<void>;
}

export interface FilesDeps {
  files: FileRepository;
  storage: ObjectStorage;
  scanner: MalwareScanner;
  scheduler: FileScanScheduler;
  audit: AuditLogger;
  uow: UnitOfWork;
  clock: Clock;
  ids: IdGenerator;
}

export const FILES_DEPS = Symbol('FILES_DEPS');
