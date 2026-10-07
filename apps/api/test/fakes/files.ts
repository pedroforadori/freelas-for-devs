import type {
  Bucket,
  MalwareScanner,
  ObjectStorage,
  ScanVerdict,
} from '../../src/modules/files/application/ports.js';

/** Storage em memória que imita o contrato do S3/R2 (incluindo o PUT pré-assinado). */
export class InMemoryObjectStorage implements ObjectStorage {
  readonly objects: Record<Bucket, Map<string, Uint8Array>> = {
    quarantine: new Map(),
    files: new Map(),
  };
  readonly pendingUploads = new Map<string, { contentType: string; size: number }>();

  presignUpload(input: {
    key: string;
    contentType: string;
    size: number;
    expiresInSeconds: number;
  }) {
    this.pendingUploads.set(input.key, { contentType: input.contentType, size: input.size });
    return Promise.resolve({
      url: `https://storage.test/quarantine/${input.key}?X-Amz-Signature=fake`,
      method: 'PUT' as const,
      headers: { 'content-type': input.contentType },
    });
  }

  /** Simula o PUT do browser: o storage real recusaria tipo/tamanho diferentes da assinatura. */
  simulateUpload(url: string, content: Uint8Array, contentType: string): void {
    const key = decodeURIComponent(new URL(url).pathname.replace(/^\/quarantine\//, ''));
    const expected = this.pendingUploads.get(key);
    if (!expected || expected.contentType !== contentType || expected.size !== content.length) {
      throw new Error('SignatureDoesNotMatch');
    }
    this.objects.quarantine.set(key, content);
  }

  /** Simula um cliente que burla a assinatura (ex.: storage mal configurado). */
  forceObject(key: string, content: Uint8Array): void {
    this.objects.quarantine.set(key, content);
  }

  presignDownload(input: { key: string; fileName: string; expiresInSeconds: number }) {
    return Promise.resolve(
      `https://storage.test/files/${input.key}?response-content-disposition=attachment`,
    );
  }
  size(bucket: Bucket, key: string) {
    return Promise.resolve(this.objects[bucket].get(key)?.length ?? null);
  }
  readHead(bucket: Bucket, key: string, bytes: number) {
    return Promise.resolve((this.objects[bucket].get(key) ?? new Uint8Array()).subarray(0, bytes));
  }
  readAll(bucket: Bucket, key: string) {
    return Promise.resolve(this.objects[bucket].get(key) ?? new Uint8Array());
  }
  promote(fromKey: string, toKey: string) {
    const content = this.objects.quarantine.get(fromKey);
    if (!content) return Promise.reject(new Error('NoSuchKey'));
    this.objects.files.set(toKey, content);
    this.objects.quarantine.delete(fromKey);
    return Promise.resolve();
  }
  remove(bucket: Bucket, key: string) {
    this.objects[bucket].delete(key);
    return Promise.resolve();
  }
}

/** Antivírus de teste: acusa a string EICAR (arquivo de teste padrão de antivírus). */
export class EicarScanner implements MalwareScanner {
  scan(content: Uint8Array): Promise<ScanVerdict> {
    return Promise.resolve(
      Buffer.from(content).toString('latin1').includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')
        ? { clean: false, signature: 'Eicar-Signature' }
        : { clean: true },
    );
  }
}
