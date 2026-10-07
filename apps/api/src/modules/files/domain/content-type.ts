import type { AllowedContentType } from '@f4d/contracts';

/** Quantos bytes iniciais bastam para identificar os tipos aceitos. */
export const SNIFF_BYTES = 16;

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  signature.every((value, index) => bytes[offset + index] === value);

/**
 * Identifica o tipo real pelo conteúdo (magic bytes), ignorando extensão e Content-Type
 * declarados. Só reconhece a lista permitida; qualquer outra coisa é `null` (recusado).
 */
export const sniffContentType = (bytes: Uint8Array): AllowedContentType | null => {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  // RIFF....WEBP
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'application/zip';
  return null;
};

/**
 * Nome exibido ao baixar: sem caminhos, caracteres de controle ou aspas (que quebrariam o
 * header Content-Disposition). O arquivo é sempre gravado com chave gerada pelo servidor.
 */
export const sanitizeFileName = (name: string): string => {
  const base = name.split(/[/\\]/).pop() ?? '';
  const cleaned = base
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex -- remover caracteres de controle é o objetivo
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
  return cleaned.replace(/^\.+/, '') || 'arquivo';
};
