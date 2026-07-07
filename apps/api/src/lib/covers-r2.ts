import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_COVERS_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_COVERS_SECRET_ACCESS_KEY ?? '',
  },
});

export async function uploadCoverImage(key: string, body: Buffer, contentType: string): Promise<string> {
  await client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_COVERS_BUCKET ?? '',
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );

  return `${(process.env.R2_COVERS_PUBLIC_URL ?? '').replace(/\/$/, '')}/${key}`;
}
