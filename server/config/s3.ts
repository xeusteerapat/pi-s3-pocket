import { S3Client } from '@aws-sdk/client-s3';

export const s3Endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:4566';

export const s3Client = new S3Client({
	endpoint: s3Endpoint,
	region: process.env.AWS_REGION ?? 'us-east-1',
	credentials: {
		accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
		secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
	},
	forcePathStyle: true,
});
