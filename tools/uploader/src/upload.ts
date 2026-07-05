import 'dotenv/config';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

interface Args {
  file: string;
  seriesId: string;
  episodeNumber: number;
  title: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const idx = argv.indexOf(flag);
    if (idx === -1) throw new Error(`missing ${flag}`);
    return argv[idx + 1];
  };
  return {
    file: get('--file'),
    seriesId: get('--series-id'),
    episodeNumber: Number(get('--episode')),
    title: get('--title'),
  };
}

function runFfmpeg(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i', input,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      '-y', output,
    ]);
    proc.on('error', reject);
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
}

function probeDuration(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file,
    ]);
    let out = '';
    proc.stdout.on('data', (chunk) => (out += chunk));
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}`));
      resolve(Math.round(Number(out.trim())));
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = path.join(path.dirname(args.file), `${path.parse(args.file).name}-encoded.mp4`);

  console.log('Transcoding...');
  await runFfmpeg(args.file, outputPath);

  const durationSeconds = await probeDuration(outputPath);
  const r2Key = `series/${args.seriesId}/episode-${args.episodeNumber}.mp4`;

  console.log('Uploading to R2...');
  const client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    },
  });
  const body = await readFile(outputPath);
  await client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET ?? '',
    Key: r2Key,
    Body: body,
    ContentType: 'video/mp4',
  }));

  console.log('Registering episode via admin API...');
  const res = await fetch(`${process.env.API_BASE_URL}/api/admin/episodes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.ADMIN_TOKEN}`,
    },
    body: JSON.stringify({
      seriesId: args.seriesId,
      episodeNumber: args.episodeNumber,
      title: args.title,
      r2Key,
      durationSeconds,
    }),
  });
  if (!res.ok) {
    throw new Error(`register failed: ${res.status} ${await res.text()}`);
  }
  console.log('Done:', await res.json());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
