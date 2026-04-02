import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME;

// Points to the backend folder where the .bsp files are generated
const KERNELS_DIR = path.resolve(__dirname, "../sse3d-api/kernels");

const KERNELS_TO_UPLOAD = [
  "spk/de440.bsp",
  "spk/mar099_min.bsp",
  "spk/jup365_min.bsp",
  "spk/sat441_min.bsp",
  "spk/ura111_min.bsp",
  "spk/nep081_min.bsp",
  "spk/plu060_min.bsp",
];

async function uploadKernels() {
  if (!BUCKET_NAME) {
    console.error("❌ ERROR: The S3_BUCKET_NAME variable is not defined.");
    process.exit(1);
  }

  console.log(
    `🚀 Starting Multipart Upload of ${KERNELS_TO_UPLOAD.length} Kernels to S3...`,
  );

  for (const fileKey of KERNELS_TO_UPLOAD) {
    const filePath = path.join(KERNELS_DIR, fileKey);

    if (!fs.existsSync(filePath)) {
      console.error(`⚠️ Local file not found, skipping: ${filePath}`);
      continue;
    }

    const fileStream = fs.createReadStream(filePath);
    const stat = fs.statSync(filePath);
    const s3Key = `kernels/${fileKey}`; // Will be saved as kernels/spk/file.bsp

    console.log(
      `\n📤 Processing ${fileKey} (${(stat.size / 1024 / 1024).toFixed(2)} MB)...`,
    );

    try {
      const parallelUploads3 = new Upload({
        client: s3Client,
        params: {
          Bucket: BUCKET_NAME,
          Key: s3Key,
          Body: fileStream,
          ContentType: "application/octet-stream",
          ACL: "public-read", // Make the file publicly readable
        },
        partSize: 1024 * 1024 * 15, // Divide into 15 MB chunks
        leavePartsOnError: false,
      });

      parallelUploads3.on("httpUploadProgress", (progress) => {
        if (progress.total) {
          const percent = ((progress.loaded / progress.total) * 100).toFixed(1);
          process.stdout.write(`   Progress: ${percent}%\r`);
        }
      });

      await parallelUploads3.done();
      console.log(`\n✅ Success: s3://${BUCKET_NAME}/${s3Key}`);
    } catch (err) {
      console.error(`\n❌ Error uploading ${fileKey}:`, err);
    }
  }

  console.log("\n🎉 All Kernels have been synchronized with the Cloud!");
}

uploadKernels();
