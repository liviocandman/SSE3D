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
const MODELS_DIR = path.join(__dirname, "..", "public", "models", "orion");

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
const cf = new CloudFrontClient({ region: "us-east-1" });

const BUCKET = process.env.S3_BUCKET_NAME;
const DISTRIBUTION_ID = process.env.CF_DISTRIBUTION_ID;
const MODEL_PREFIX = "models/orion";

if (!BUCKET || !DISTRIBUTION_ID) {
  console.error("S3_BUCKET_NAME e CF_DISTRIBUTION_ID são obrigatórios");
  process.exit(1);
}

if (!fs.existsSync(MODELS_DIR)) {
  console.error(`Diretório de modelos não encontrado: ${MODELS_DIR}`);
  process.exit(1);
}

function toS3Key(file) {
  return MODEL_PREFIX ? `${MODEL_PREFIX}/${file}` : file;
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
  const files = fs
    .readdirSync(MODELS_DIR)
    .filter((file) => file.endsWith(".glb"));

  console.log(`Encontrados ${files.length} arquivos GLB em ${MODELS_DIR}\n`);

  const uploaded = [];
  const forceInvalidation = process.argv.includes("--force-invalidation");

  for (const file of files) {
    const key = toS3Key(file);

    if (await exists(key) && !forceInvalidation) {
      console.log(`⏭  ${key} — já existe`);
      continue;
    }

    const body = fs.readFileSync(path.join(MODELS_DIR, file));

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: "model/gltf-binary",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );

    console.log(`✓  ${key} — ${Math.round(body.length / 1024)} KB [model/gltf-binary]`);
    uploaded.push(key);
  }

  if (uploaded.length === 0 && !forceInvalidation) {
    console.log("\nNenhum modelo novo. Invalidação não necessária.");
    return;
  }

  const invalidationPaths = forceInvalidation
    ? [`/${MODEL_PREFIX}/*`]
    : uploaded.map((key) => `/${key}`);

  console.log(
    `\nInvalidando ${forceInvalidation ? "todos os modelos" : uploaded.length + " modelo(s)"} no CloudFront...`,
  );

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
