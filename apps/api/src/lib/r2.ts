import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
  },
});

export async function getPlaybackUrl(key: string, expiresInSeconds = 300): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET ?? '',
    Key: key,
  });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

export async function uploadEpisodeVideo(key: string, filePath: string): Promise<void> {
  const fileStat = await stat(filePath);
  await client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET ?? '',
      Key: key,
      Body: createReadStream(filePath),
      ContentType: 'video/mp4',
      ContentLength: fileStat.size,
    }),
  );
}
