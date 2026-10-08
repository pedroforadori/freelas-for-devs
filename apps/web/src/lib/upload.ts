import { unwrap } from '@f4d/api-client';
import {
  type AllowedContentType,
  FILE_RULES,
  type FileDto,
  type FilePurpose,
} from '@f4d/contracts';
import { api } from './api';

export class UploadRejectedError extends Error {}

/** Mesmas regras da API, conferidas antes de pedir a URL (feedback imediato). */
export const checkFile = (file: File, purpose: FilePurpose): string | null => {
  const rules = FILE_RULES[purpose];
  if (!rules.contentTypes.includes(file.type as AllowedContentType))
    return `"${file.name}": tipo de arquivo não aceito.`;
  if (file.size > rules.maxBytes)
    return `"${file.name}": maior que ${Math.round(rules.maxBytes / 1024 / 1024)} MB.`;
  return null;
};

/**
 * Upload direto para o storage (ADR-0009): a API autoriza com URL pré-assinada (tipo e tamanho
 * fixos), o browser envia o arquivo e a API confirma — a verificação de segurança segue no worker.
 */
export const uploadFile = async (file: File, purpose: FilePurpose): Promise<FileDto> => {
  const problem = checkFile(file, purpose);
  if (problem) throw new UploadRejectedError(problem);

  const { file: created, upload } = await unwrap(
    api.POST('/v1/files/uploads', {
      body: { purpose, fileName: file.name, contentType: file.type, size: file.size },
    }),
  );
  const sent = await fetch(upload.url, {
    method: upload.method,
    headers: upload.headers,
    body: file,
  });
  if (!sent.ok) throw new UploadRejectedError(`Não foi possível enviar "${file.name}".`);
  return unwrap(
    api.POST('/v1/files/{fileId}/complete', { params: { path: { fileId: created.id } } }),
  );
};
