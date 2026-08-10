import {
	CopyObjectCommand,
	CreateBucketCommand,
	DeleteBucketCommand,
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListBucketsCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	type S3Client,
} from '@aws-sdk/client-s3';

export interface S3Sender {
	send: S3Client['send'];
}

export class S3Service {
	constructor(private readonly client: S3Sender) {}

	async listBuckets() {
		const result = await this.client.send(new ListBucketsCommand({}));
		return (result.Buckets ?? []).map((bucket) => ({
			name: bucket.Name,
			creationDate: bucket.CreationDate?.toISOString(),
		}));
	}

	async createBucket(name: string) {
		await this.client.send(new CreateBucketCommand({ Bucket: name }));
	}

	async deleteBucket(name: string) {
		await this.client.send(new DeleteBucketCommand({ Bucket: name }));
	}

	async listObjects(bucket: string, prefix = '', continuationToken?: string) {
		const result = await this.client.send(
			new ListObjectsV2Command({
				Bucket: bucket,
				Prefix: prefix,
				Delimiter: '/',
				ContinuationToken: continuationToken,
			}),
		);

		const objects = await Promise.all(
			(result.Contents ?? [])
				.filter((item) => item.Key && item.Key !== prefix)
				.map(async (item) => {
					let contentType: string | undefined;
					try {
						const head = await this.client.send(
							new HeadObjectCommand({ Bucket: bucket, Key: item.Key! }),
						);
						contentType = head.ContentType;
					} catch {
						// Listing remains useful if an object disappears during metadata lookup.
					}
					return {
						key: item.Key!,
						name: item.Key!.slice(prefix.length),
						size: item.Size ?? 0,
						lastModified: item.LastModified?.toISOString(),
						etag: item.ETag,
						contentType,
					};
				}),
		);

		return {
			folders: (result.CommonPrefixes ?? [])
				.map((item) => item.Prefix)
				.filter((value): value is string => Boolean(value))
				.map((key) => ({
					key,
					name: key.slice(prefix.length).replace(/\/$/, ''),
				})),
			objects,
			nextContinuationToken: result.NextContinuationToken,
			isTruncated: result.IsTruncated ?? false,
		};
	}

	async exists(bucket: string, key: string) {
		try {
			await this.client.send(
				new HeadObjectCommand({ Bucket: bucket, Key: key }),
			);
			return true;
		} catch (error) {
			const status = (error as { $metadata?: { httpStatusCode?: number } })
				.$metadata?.httpStatusCode;
			const name = (error as { name?: string }).name;
			if (status === 404 || name === 'NotFound' || name === 'NoSuchKey')
				return false;
			throw error;
		}
	}

	async uploadObject(
		bucket: string,
		key: string,
		body: Buffer,
		contentType?: string,
	) {
		await this.client.send(
			new PutObjectCommand({
				Bucket: bucket,
				Key: key,
				Body: body,
				ContentType: contentType,
			}),
		);
	}

	async createFolder(bucket: string, key: string) {
		const folderKey = key.endsWith('/') ? key : `${key}/`;
		await this.client.send(
			new PutObjectCommand({
				Bucket: bucket,
				Key: folderKey,
				Body: Buffer.alloc(0),
			}),
		);
	}

	async getObject(bucket: string, key: string) {
		return this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
	}

	async deleteObject(bucket: string, key: string) {
		await this.client.send(
			new DeleteObjectCommand({ Bucket: bucket, Key: key }),
		);
	}

	async copyObject(bucket: string, sourceKey: string, destinationKey: string) {
		const copySource = `/${encodeURIComponent(bucket)}/${sourceKey.split('/').map(encodeURIComponent).join('/')}`;
		await this.client.send(
			new CopyObjectCommand({
				Bucket: bucket,
				Key: destinationKey,
				CopySource: copySource,
			}),
		);
	}

	async moveObject(bucket: string, sourceKey: string, destinationKey: string) {
		await this.copyObject(bucket, sourceKey, destinationKey);
		await this.deleteObject(bucket, sourceKey);
	}
}
