import type { FilePurpose, FileStatus } from '@f4d/contracts';
import { AggregateRoot } from '../../../shared/kernel/aggregate-root.js';
import { defineStateMachine } from '../../../shared/kernel/state-machine.js';

export interface StoredFileSnapshot {
  id: string;
  ownerId: string;
  purpose: FilePurpose;
  fileName: string;
  contentType: string;
  /** Tamanho declarado no pedido; o real é conferido no storage. */
  size: number;
  status: FileStatus;
  rejectionReason: string | null;
  createdAt: Date;
  readyAt: Date | null;
  version: number;
}

type FileEvent = 'uploaded' | 'accept' | 'reject';

export const storedFileMachine = defineStateMachine<FileStatus, FileEvent>({
  name: 'StoredFile',
  initial: 'PENDING_UPLOAD',
  terminal: ['READY', 'REJECTED'],
  transitions: {
    PENDING_UPLOAD: { uploaded: 'SCANNING', reject: 'REJECTED' },
    SCANNING: { accept: 'READY', reject: 'REJECTED' },
    READY: {},
    REJECTED: {},
  },
});

export const FileEvents = {
  Ready: 'files.FileReady',
  Rejected: 'files.FileRejected',
} as const;

/** Arquivo enviado por um usuário: só fica disponível depois de verificado. */
export class StoredFile extends AggregateRoot {
  protected readonly aggregateType = 'StoredFile';

  private constructor(
    private props: Omit<StoredFileSnapshot, 'id' | 'version'>,
    id: string,
    version: number,
  ) {
    super(id, version);
  }

  static request(input: {
    id: string;
    ownerId: string;
    purpose: FilePurpose;
    fileName: string;
    contentType: string;
    size: number;
    now: Date;
  }): StoredFile {
    const { id, now, ...rest } = input;
    return new StoredFile(
      { ...rest, status: 'PENDING_UPLOAD', rejectionReason: null, createdAt: now, readyAt: null },
      id,
      0,
    );
  }

  static rehydrate(snapshot: StoredFileSnapshot): StoredFile {
    const { id, version, ...props } = snapshot;
    return new StoredFile({ ...props }, id, version);
  }

  get ownerId(): string {
    return this.props.ownerId;
  }
  get purpose(): FilePurpose {
    return this.props.purpose;
  }
  get status(): FileStatus {
    return this.props.status;
  }
  get fileName(): string {
    return this.props.fileName;
  }
  get contentType(): string {
    return this.props.contentType;
  }
  get size(): number {
    return this.props.size;
  }

  /** Chave no bucket de quarentena (gerada pelo servidor; nunca o nome do usuário). */
  get quarantineKey(): string {
    return `quarantine/${this.id}`;
  }

  get finalKey(): string {
    return `files/${this.props.ownerId}/${this.id}`;
  }

  markUploaded(): void {
    this.transition('uploaded');
  }

  accept(now: Date): void {
    this.transition('accept');
    this.props.readyAt = now;
    this.record(FileEvents.Ready, now, { fileId: this.id, purpose: this.props.purpose });
  }

  reject(reason: string, now: Date): void {
    this.transition('reject');
    this.props.rejectionReason = reason;
    this.record(FileEvents.Rejected, now, { fileId: this.id, reason });
  }

  toSnapshot(): StoredFileSnapshot {
    return { ...this.props, id: this.id, version: this.version };
  }

  private transition(event: FileEvent): void {
    const result = storedFileMachine.transition(this.props.status, event, undefined);
    if (!result.ok) throw result.error;
    this.props.status = result.value;
  }
}
