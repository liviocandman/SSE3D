import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEXTURES_DIR = path.join(__dirname, "..", "public", "textures");

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
const cf = new CloudFrontClient({ region: "us-east-1" });

const BUCKET = process.env.S3_BUCKET_NAME;
const DISTRIBUTION_ID = process.env.CF_DISTRIBUTION_ID;

if (!BUCKET || !DISTRIBUTION_ID) {
  console.error("S3_BUCKET_NAME e CF_DISTRIBUTION_ID são obrigatórios");
  process.exit(1);
}

async function exists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const files = fs.readdirSync(TEXTURES_DIR).filter((f) => f.endsWith(".ktx2"));
  console.log(`Encontrados ${files.length} arquivos KTX2\n`);

  const uploaded = [];
  const forceInvalidation = process.argv.includes("--force-invalidation");

  for (const file of files) {
    if (await exists(file) && !forceInvalidation) {
      console.log(`⏭  ${file} — já existe`);
      continue;
    }
    const body = fs.readFileSync(path.join(TEXTURES_DIR, file));
    
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: file,
        Body: body,
        ContentType: "image/ktx2",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    console.log(`✓  ${file} — ${Math.round(body.length / 1024)} KB [image/ktx2]`);
    uploaded.push(file);
  }

  if (uploaded.length === 0 && !forceInvalidation) {
    console.log("\nNenhum arquivo novo. Invalidação não necessária.");
    return;
  }

  const invalidationPaths = forceInvalidation ? ["/*"] : uploaded.map((f) => `/${f}`);
  console.log(`\nInvalidando ${forceInvalidation ? "todos os arquivos" : uploaded.length + " arquivo(s)"} no CloudFront...`);
  
  await cf.send(
    new CreateInvalidationCommand({
      DistributionId: DISTRIBUTION_ID,
      InvalidationBatch: {
        Paths: {
          Quantity: invalidationPaths.length,
          Items: invalidationPaths,
        },
        CallerReference: Date.now().toString(),
      },
    }),
  );
  console.log("Invalidação criada. Propagação em ~30s.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
