import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Config, type R2Config } from "@/lib/env";

let client: S3Client | null = null;

function s3(cfg: R2Config): S3Client {
  if (client) return client;
  client = new S3Client({
    region: "auto",
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return client;
}

function cfg(): R2Config {
  const c = r2Config();
  if (!c) throw new Error("R2 is not configured");
  return c;
}

export function publicUrl(key: string) {
  return `${cfg().publicBaseUrl}/${key}`;
}

export async function presignPut(key: string, contentType: string, expiresIn = 900) {
  const c = cfg();
  return getSignedUrl(
    s3(c),
    new PutObjectCommand({ Bucket: c.bucket, Key: key, ContentType: contentType }),
    { expiresIn },
  );
}

export async function putBytes(key: string, body: Uint8Array, contentType: string) {
  const c = cfg();
  await s3(c).send(
    new PutObjectCommand({ Bucket: c.bucket, Key: key, Body: body, ContentType: contentType }),
  );
  return key;
}

export async function getBytes(key: string): Promise<Uint8Array> {
  const c = cfg();
  const res = await s3(c).send(new GetObjectCommand({ Bucket: c.bucket, Key: key }));
  return new Uint8Array(await res.Body!.transformToByteArray());
}
