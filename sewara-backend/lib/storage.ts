// @ts-nocheck
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Storage abstraction untuk future-proof migration
class StorageProvider {
  async upload(key, file, contentType) { throw new Error('Not implemented'); }
  async getSignedURL(key, expiresIn = 3600) { throw new Error('Not implemented'); }
  async delete(key) { throw new Error('Not implemented'); }
}

// R2 implementation with SSE-S3 (Server-Side Managed Encryption)
class R2StorageSSE extends StorageProvider {
  constructor() {
    super();
    this.client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
    this.bucket = process.env.R2_BUCKET_NAME;
  }

  async upload(key, file, contentType) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: file,
      ContentType: contentType,
      // SSE-S3: R2 manages encryption at rest
      ServerSideEncryption: 'AES256',
    });
    return await this.client.send(command);
  }

  async getSignedURL(key, expiresIn = 3600) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      // No encryption headers needed for SSE-S3
    });
    return await getSignedUrl(this.client, command, { expiresIn });
  }

  async delete(key) {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return await this.client.send(command);
  }
}

// Factory: export instance
export const storage = new R2StorageSSE();

// Helper functions
export function buildStorageKey(userId, memberId, type, ext) {
  return `${userId}/${memberId}_${type}.${ext}`;
}

export function parseStorageKey(key) {
  // Parse: "abc-123/member-001_ktp.jpg" -> { userId, memberId, type, ext }
  const [userId, filename] = key.split('/');
  const [memberWithType, ext] = filename.split('.');
  const lastUnderscoreIndex = memberWithType.lastIndexOf('_');
  const memberId = memberWithType.substring(0, lastUnderscoreIndex);
  const type = memberWithType.substring(lastUnderscoreIndex + 1);
  return { userId, memberId, type, ext };
}
