import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Bucket, ObjectStorage } from '../application/ports.js';

export interface S3StorageConfig {
  endpoint: string | undefined;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  buckets: Record<Bucket, string>;
}

/** `filename*` (RFC 6266/5987) preserva acentos; `filename` fica como fallback ASCII. */
const contentDisposition = (fileName: string): string => {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
};

const isNotFound = (error: unknown) =>
  error instanceof S3ServiceException &&
  (error.name === 'NotFound' || error.$metadata.httpStatusCode === 404);

/** Cloudflare R2 (produção) ou MinIO (dev) pela API S3. Buckets privados; acesso só assinado. */
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async presignUpload(input: {
    key: string;
    contentType: string;
    size: number;
    expiresInSeconds: number;
  }) {
    const command = new PutObjectCommand({
      Bucket: this.config.buckets.quarantine,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.size,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: input.expiresInSeconds,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return { url, method: 'PUT' as const, headers: { 'content-type': input.contentType } };
  }

  presignDownload(input: {
    key: string;
    fileName: string;
    expiresInSeconds: number;
  }): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.buckets.files,
        Key: input.key,
        ResponseContentDisposition: contentDisposition(input.fileName),
      }),
      { expiresIn: input.expiresInSeconds },
    );
  }

  async size(bucket: Bucket, key: string): Promise<number | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.buckets[bucket], Key: key }),
      );
      return head.ContentLength ?? null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async readHead(bucket: Bucket, key: string, bytes: number): Promise<Uint8Array> {
    return this.read(bucket, key, `bytes=0-${bytes - 1}`);
  }

  async readAll(bucket: Bucket, key: string): Promise<Uint8Array> {
    return this.read(bucket, key);
  }

  async promote(fromKey: string, toKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.config.buckets.files,
        Key: toKey,
        CopySource: `${this.config.buckets.quarantine}/${encodeURIComponent(fromKey)}`,
      }),
    );
    await this.remove('quarantine', fromKey);
  }

  async remove(bucket: Bucket, key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.buckets[bucket], Key: key }),
    );
  }

  private async read(bucket: Bucket, key: string, range?: string): Promise<Uint8Array> {
    const object = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.buckets[bucket],
        Key: key,
        ...(range ? { Range: range } : {}),
      }),
    );
    if (!object.Body) return new Uint8Array();
    return object.Body.transformToByteArray();
  }
}
