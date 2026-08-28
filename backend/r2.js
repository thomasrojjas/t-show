const crypto = require('crypto');
const { S3Client, DeleteObjectCommand, CopyObjectCommand } = require('@aws-sdk/client-s3');

function configured() {
  return Boolean(process.env.R2_ENDPOINT && process.env.R2_BUCKET && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
}

function client() {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
  });
}

async function deleteObject(key) {
  if (!configured() || !key) return;
  await client().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
}

async function duplicateProjectCover(sourceKey, projectId) {
  if (!configured() || !sourceKey) return null;
  const extension = sourceKey.split('.').pop().replace(/[^a-z0-9]/gi, '').toLowerCase() || 'webp';
  const targetKey = `projects/${projectId}/${crypto.randomUUID()}.${extension}`;
  await client().send(new CopyObjectCommand({
    Bucket: process.env.R2_BUCKET,
    CopySource: `${process.env.R2_BUCKET}/${sourceKey.split('/').map(encodeURIComponent).join('/')}`,
    Key: targetKey
  }));
  return targetKey;
}

module.exports = { configured, client, deleteObject, duplicateProjectCover };
