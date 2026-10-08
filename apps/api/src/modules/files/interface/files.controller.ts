import { Controller, Inject } from '@nestjs/common';
import { apiRoutes, type CreateUploadResponse, type FileDto } from '@f4d/contracts';
import { Processor } from '@nestjs/bullmq';
import { ReportingWorkerHost } from '../../../shared/infra/queue/reporting-worker-host.js';
import type { Job } from 'bullmq';
import type { RequestMeta } from '../../../shared/application/audit-log.js';
import { QueueName } from '../../../shared/infra/queue/queue-names.js';
import {
  CurrentPrincipal,
  type Principal,
  RequestContext,
} from '../../../shared/interface/http/auth/principal.js';
import {
  type ContractRequest,
  ContractRoute,
  ValidRequest,
} from '../../../shared/interface/http/contract-route.js';
import {
  CompleteUpload,
  CreateUpload,
  ReadFile,
  ScanUploadedFile,
} from '../application/use-cases.js';
import type { StoredFile } from '../domain/stored-file.js';

const routes = apiRoutes.files;

export const toFileDto = (file: StoredFile): FileDto => {
  const s = file.toSnapshot();
  return {
    id: s.id,
    purpose: s.purpose,
    fileName: s.fileName,
    contentType: s.contentType,
    size: s.size,
    status: s.status,
    rejectionReason: s.rejectionReason,
    createdAt: s.createdAt.toISOString(),
  };
};

@Controller()
export class FilesController {
  constructor(
    private readonly createUpload: CreateUpload,
    private readonly completeUpload: CompleteUpload,
    private readonly readFile: ReadFile,
  ) {}

  @ContractRoute(routes.createUpload)
  async create(
    @ValidRequest() { body }: ContractRequest<typeof routes.createUpload>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<CreateUploadResponse> {
    const result = await this.createUpload.execute(principal.userId, body);
    return {
      file: toFileDto(result.file),
      upload: result.upload,
      expiresAt: result.expiresAt.toISOString(),
    };
  }

  @ContractRoute(routes.completeUpload)
  async complete(
    @ValidRequest() { params }: ContractRequest<typeof routes.completeUpload>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<FileDto> {
    return toFileDto(await this.completeUpload.execute(principal.userId, params.fileId));
  }

  @ContractRoute(routes.getFile)
  async get(
    @ValidRequest() { params }: ContractRequest<typeof routes.getFile>,
    @CurrentPrincipal() principal: Principal,
  ): Promise<FileDto> {
    return toFileDto(await this.readFile.get(principal, params.fileId));
  }

  @ContractRoute(routes.downloadUrl)
  async download(
    @ValidRequest() { params }: ContractRequest<typeof routes.downloadUrl>,
    @CurrentPrincipal() principal: Principal,
    @RequestContext() meta: RequestMeta,
  ): Promise<{ url: string; expiresAt: string }> {
    const { url, expiresAt } = await this.readFile.downloadUrl(principal, params.fileId, meta);
    return { url, expiresAt: expiresAt.toISOString() };
  }
}

/** Worker: verificação de tipo real + antivírus de cada upload confirmado. */
@Processor(QueueName.Files, { concurrency: 2 })
export class FileScanProcessor extends ReportingWorkerHost {
  constructor(@Inject(ScanUploadedFile) private readonly scan: ScanUploadedFile) {
    super();
  }

  async process(job: Job<{ fileId: string }>): Promise<void> {
    await this.scan.execute(job.data.fileId);
  }
}
