/** Cifra de campos sensíveis em repouso (segredo TOTP, mensagens com contato, documentos). */
export interface SecretCipher {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

export const SECRET_CIPHER = Symbol('SECRET_CIPHER');
