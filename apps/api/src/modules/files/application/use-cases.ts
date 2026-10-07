import { type CreateUploadRequest, FILE_RULES, type Role } from '@f4d/contracts';
import { SYSTEM_REQUEST, type RequestMeta } from '../../../shared/application/audit-log.js';
import { sanitizeFileName, SNIFF_BYTES, sniffContentType } from '../domain/content-type.js';
import { FileNotFoundError, FileNotReadyError, UploadMissingError } from '../domain/errors.js';
import { StoredFile } from '../domain/stored-file.js';
import type { FilesDeps } from './ports.js';

const UPLOAD_WINDOW_SECONDS = 10 * 60;
const DOWNLOAD_WINDOW_SECONDS = 5 * 60;

export interface Requester {
  userId: string;
  roles: readonly Role[];
}

/**
 * Política de leitura: dono ou Admin. Outros acessos (ex.: participantes de um projeto)
 * entram aqui quando os módulos de projeto existirem. Sem acesso → "não encontrado",
 * para não revelar que o arquivo existe.
 */
const canRead = (requester: Requester, file: StoredFile): boolean =>
  file.ownerId === requester.userId || requester.roles.includes('ADMIN');

abstract class FilesUseCase {
  constructor(protected readonly deps: FilesDeps) {}

  protected async load(id: string): Promise<StoredFile> {
    const file = await this.deps.files.find(id);
    if (!file) throw new FileNotFoundError();
    return file;
  }

  protected async loadReadable(requester: Requester, id: string): Promise<StoredFile> {
    const file = await this.deps.files.find(id);
    if (!file || !canRead(requester, file)) throw new FileNotFoundError();
    return file;
  }
}

export class CreateUpload extends FilesUseCase {
  async execute(ownerId: string, input: CreateUploadRequest) {
    const { files, storage, clock, ids } = this.deps;
    const now = clock.now();
    const file = StoredFile.request({
      id: ids.next(),
      ownerId,
      purpose: input.purpose,
      fileName: sanitizeFileName(input.fileName),
      contentType: input.contentType,
      size: input.size,
      now,
    });
    await files.save(file);

    const upload = await storage.presignUpload({
      key: file.quarantineKey,
      contentType: file.contentType,
      // Tamanho exato na assinatura (já validado contra o limite da finalidade no contrato).
      size: input.size,
      expiresInSeconds: UPLOAD_WINDOW_SECONDS,
    });
    return { file, upload, expiresAt: new Date(now.getTime() + UPLOAD_WINDOW_SECONDS * 1000) };
  }
}

export class CompleteUpload extends FilesUseCase {
  async execute(ownerId: string, fileId: string): Promise<StoredFile> {
    const { files, storage, scheduler } = this.deps;
    const file = await this.load(fileId);
    if (file.ownerId !== ownerId) throw new FileNotFoundError();
    // Idempotente: repetir a confirmação não reprocessa.
    if (file.status !== 'PENDING_UPLOAD') return file;

    const size = await storage.size('quarantine', file.quarantineKey);
    if (size === null) throw new UploadMissingError();

    const sizeMatches = size <= FILE_RULES[file.purpose].maxBytes && size === file.size;
    if (sizeMatches) {
      file.markUploaded();
    } else {
      file.reject('O arquivo enviado não corresponde ao declarado.', this.deps.clock.now());
      await storage.remove('quarantine', file.quarantineKey);
    }
    await files.save(file);
    if (sizeMatches) await scheduler.schedule(file.id);
    return file;
  }
}

/**
 * Executado pelo worker: confere o tipo real (magic bytes) e passa o antivírus. Só então o
 * arquivo sai da quarentena. Falha do antivírus (ex.: ClamAV fora) lança erro → o job é
 * repetido com backoff; o arquivo nunca é liberado sem verificação.
 */
export class ScanUploadedFile extends FilesUseCase {
  async execute(fileId: string): Promise<void> {
    const { files, storage, scanner, clock, audit } = this.deps;
    const file = await this.deps.files.find(fileId);
    if (file?.status !== 'SCANNING') return;

    const detected = sniffContentType(
      await storage.readHead('quarantine', file.quarantineKey, SNIFF_BYTES),
    );
    const allowed = FILE_RULES[file.purpose].contentTypes;
    if (!detected || detected !== file.contentType || !allowed.includes(detected)) {
      await this.reject(file, 'O conteúdo do arquivo não corresponde a um tipo permitido.');
      return;
    }

    const verdict = await scanner.scan(await storage.readAll('quarantine', file.quarantineKey));
    if (!verdict.clean) {
      await this.reject(file, 'O arquivo foi bloqueado pela verificação de segurança.');
      await audit.record({
        actorId: null,
        action: 'files.malware_detected',
        targetType: 'file',
        targetId: file.id,
        metadata: { ownerId: file.ownerId, signature: verdict.signature },
        request: SYSTEM_REQUEST,
      });
      return;
    }

    await storage.promote(file.quarantineKey, file.finalKey);
    file.accept(clock.now());
    await files.save(file);
  }

  private async reject(file: StoredFile, reason: string): Promise<void> {
    file.reject(reason, this.deps.clock.now());
    await this.deps.files.save(file);
    await this.deps.storage.remove('quarantine', file.quarantineKey);
  }
}

export class ReadFile extends FilesUseCase {
  get(requester: Requester, fileId: string): Promise<StoredFile> {
    return this.loadReadable(requester, fileId);
  }

  async downloadUrl(
    requester: Requester,
    fileId: string,
    meta: RequestMeta,
  ): Promise<{ url: string; expiresAt: Date }> {
    const file = await this.loadReadable(requester, fileId);
    if (file.status !== 'READY') throw new FileNotReadyError();
    const url = await this.deps.storage.presignDownload({
      key: file.finalKey,
      fileName: file.fileName,
      expiresInSeconds: DOWNLOAD_WINDOW_SECONDS,
    });
    if (file.ownerId !== requester.userId) {
      // Acesso de terceiros (ex.: Admin) a arquivo alheio fica registrado.
      await this.deps.audit.record({
        actorId: requester.userId,
        action: 'files.downloaded_by_other',
        targetType: 'file',
        targetId: file.id,
        metadata: { ownerId: file.ownerId },
        request: meta,
      });
    }
    return {
      url,
      expiresAt: new Date(this.deps.clock.now().getTime() + DOWNLOAD_WINDOW_SECONDS * 1000),
    };
  }
}
