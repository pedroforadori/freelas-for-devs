import { z } from 'zod';
import { Permission } from '../auth/permissions.js';
import { defineRoute } from '../http/route.js';

export const FilePurpose = {
  PortfolioImage: 'PORTFOLIO_IMAGE',
  ProjectAttachment: 'PROJECT_ATTACHMENT',
  DeliveryFile: 'DELIVERY_FILE',
} as const;
export type FilePurpose = (typeof FilePurpose)[keyof typeof FilePurpose];
export const filePurposeSchema = z.enum(
  Object.values(FilePurpose) as [FilePurpose, ...FilePurpose[]],
);

export type AllowedContentType =
  'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf' | 'application/zip';

const MB = 1024 * 1024;

/**
 * Tipos aceitos e tamanho máximo por finalidade. A API confere de novo pelo conteúdo real
 * (magic bytes) depois do upload — a declaração do cliente nunca é confiável.
 */
export const FILE_RULES: Readonly<
  Record<FilePurpose, { contentTypes: readonly AllowedContentType[]; maxBytes: number }>
> = {
  PORTFOLIO_IMAGE: { contentTypes: ['image/png', 'image/jpeg', 'image/webp'], maxBytes: 5 * MB },
  PROJECT_ATTACHMENT: {
    contentTypes: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'application/zip'],
    maxBytes: 20 * MB,
  },
  /** Arquivos das entregas (código-fonte em ZIP, documentos, prints). */
  DELIVERY_FILE: {
    contentTypes: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'application/zip'],
    maxBytes: 50 * MB,
  },
};

export const FileStatus = {
  PendingUpload: 'PENDING_UPLOAD',
  Scanning: 'SCANNING',
  Ready: 'READY',
  Rejected: 'REJECTED',
} as const;
export type FileStatus = (typeof FileStatus)[keyof typeof FileStatus];
export const fileStatusSchema = z.enum(Object.values(FileStatus) as [FileStatus, ...FileStatus[]]);

export const fileSchema = z
  .object({
    id: z.uuid(),
    purpose: filePurposeSchema,
    fileName: z.string(),
    contentType: z.string(),
    size: z.number().int(),
    status: fileStatusSchema,
    rejectionReason: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'File' });

export const createUploadRequestSchema = z
  .object({
    purpose: filePurposeSchema,
    fileName: z.string().trim().min(1).max(200),
    contentType: z.string().max(100),
    size: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const rules = FILE_RULES[value.purpose];
    if (!rules.contentTypes.includes(value.contentType as AllowedContentType)) {
      ctx.addIssue({
        code: 'custom',
        path: ['contentType'],
        message: 'Tipo de arquivo não permitido.',
      });
    }
    if (value.size > rules.maxBytes) {
      ctx.addIssue({
        code: 'custom',
        path: ['size'],
        message: `Arquivo maior que ${Math.round(rules.maxBytes / MB)} MB.`,
      });
    }
  })
  .meta({ id: 'CreateUploadRequest' });

export const createUploadResponseSchema = z
  .object({
    file: fileSchema,
    upload: z.object({
      /**
       * PUT direto para o storage com exatamente estes headers. Tipo e tamanho fazem parte da
       * assinatura: o storage recusa um arquivo diferente do declarado.
       */
      url: z.string(),
      method: z.literal('PUT'),
      headers: z.record(z.string(), z.string()),
    }),
    expiresAt: z.iso.datetime(),
  })
  .meta({ id: 'CreateUploadResponse' });

export type FileDto = z.infer<typeof fileSchema>;
export type CreateUploadRequest = z.infer<typeof createUploadRequestSchema>;
export type CreateUploadResponse = z.infer<typeof createUploadResponseSchema>;

const fileParams = z.object({ fileId: z.uuid() });
const upload = { permission: Permission.FilesUpload } as const;

export const fileRoutes = {
  createUpload: defineRoute({
    method: 'post',
    path: '/v1/files/uploads',
    operationId: 'createUpload',
    summary: 'Autoriza um upload: devolve URL PUT pré-assinada (tipo e tamanho fixados).',
    tags: ['files'],
    auth: upload,
    request: { body: createUploadRequestSchema },
    responses: { 201: createUploadResponseSchema },
  }),
  completeUpload: defineRoute({
    method: 'post',
    path: '/v1/files/{fileId}/complete',
    operationId: 'completeUpload',
    summary: 'Confirma o envio; o arquivo passa por verificação de tipo e antivírus.',
    tags: ['files'],
    auth: upload,
    request: { params: fileParams },
    responses: { 202: fileSchema },
  }),
  getFile: defineRoute({
    method: 'get',
    path: '/v1/files/{fileId}',
    operationId: 'getFile',
    summary: 'Situação do arquivo (verificação em andamento, pronto ou recusado).',
    tags: ['files'],
    auth: 'authenticated',
    request: { params: fileParams },
    responses: { 200: fileSchema },
  }),
  downloadUrl: defineRoute({
    method: 'get',
    path: '/v1/files/{fileId}/download',
    operationId: 'getFileDownloadUrl',
    summary: 'URL assinada de curta duração (5 min) para baixar um arquivo pronto.',
    tags: ['files'],
    auth: 'authenticated',
    request: { params: fileParams },
    responses: { 200: z.object({ url: z.string(), expiresAt: z.iso.datetime() }) },
  }),
} as const;
