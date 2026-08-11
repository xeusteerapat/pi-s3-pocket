import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import type { S3Service } from '../services/s3.service';

const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 100 * 1024 * 1024, files: 20 },
});

function requireBucket(value: unknown) {
	if (
		typeof value !== 'string' ||
		value.length < 3 ||
		value.length > 63 ||
		!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(value) ||
		/\.\.|\.-|-\./.test(value) ||
		/^\d+\.\d+\.\d+\.\d+$/.test(value)
	)
		throw Object.assign(new Error('Invalid bucket name'), {
			status: 400,
			code: 'InvalidBucketName',
		});
	return value;
}

function requireKey(value: unknown) {
	if (typeof value !== 'string' || !value || value.includes('\0')) {
		throw Object.assign(new Error('A valid object key is required'), {
			status: 400,
			code: 'InvalidObjectKey',
		});
	}
	return value;
}

function safeFilename(key: string) {
	return (key.split('/').pop() || 'download').replace(/[\r\n"\\/]/g, '_');
}

function pipeBody(body: unknown, res: Response) {
	if (body && typeof (body as { pipe?: unknown }).pipe === 'function') {
		(body as NodeJS.ReadableStream).pipe(res);
		return;
	}
	throw Object.assign(new Error('S3 returned an unsupported response stream'), {
		status: 502,
		code: 'InvalidS3Response',
	});
}

export function createApiRouter(service: S3Service, endpoint: string) {
	const router = Router();

	router.get('/health', async (_req, res) => {
		try {
			await service.listBuckets();
			res.json({ connected: true, endpoint });
		} catch (error) {
			const detail = error instanceof Error ? error.message : '';
			const message =
				detail ||
				`Unable to connect to S3 at ${endpoint}. Make sure Floci is running.`;
			res.status(503).json({
				connected: false,
				endpoint,
				error: { code: 'S3Offline', message },
			});
		}
	});

	router.get('/search', async (req, res) => {
		const searchQuery =
			typeof req.query.q === 'string' ? req.query.q.trim() : '';
		if (!searchQuery || searchQuery.length > 200) {
			throw Object.assign(
				new Error('Search query must be between 1 and 200 characters'),
				{
					status: 400,
					code: 'InvalidSearchQuery',
				},
			);
		}
		res.json(await service.search(searchQuery));
	});

	router.get('/buckets', async (_req, res) =>
		res.json({ buckets: await service.listBuckets() }),
	);
	router.post('/buckets', async (req, res) => {
		const name = requireBucket(req.body?.name);
		await service.createBucket(name);
		res.status(201).json({ name });
	});
	router.delete('/buckets/:bucket', async (req, res) => {
		await service.deleteBucket(requireBucket(req.params.bucket));
		res.status(204).end();
	});

	router.get('/buckets/:bucket/objects', async (req, res) => {
		const result = await service.listObjects(
			requireBucket(req.params.bucket),
			typeof req.query.prefix === 'string' ? req.query.prefix : '',
			typeof req.query.continuationToken === 'string'
				? req.query.continuationToken
				: undefined,
		);
		res.json(result);
	});

	router.post(
		'/buckets/:bucket/objects',
		upload.array('files', 20),
		async (req: Request, res) => {
			const bucket = requireBucket(req.params.bucket);
			const prefix = typeof req.body.prefix === 'string' ? req.body.prefix : '';
			const overwrite = req.body.overwrite === 'true';
			const files = (req.files as Express.Multer.File[] | undefined) ?? [];
			if (!files.length)
				throw Object.assign(new Error('At least one file is required'), {
					status: 400,
					code: 'MissingFile',
				});

			const keys = files.map((file) =>
				requireKey(`${prefix}${file.originalname}`),
			);
			if (!overwrite) {
				const conflicts = (
					await Promise.all(
						keys.map(async (key) =>
							(await service.exists(bucket, key)) ? key : null,
						),
					)
				).filter(Boolean);
				if (conflicts.length)
					throw Object.assign(
						new Error(`Object already exists: ${conflicts.join(', ')}`),
						{ status: 409, code: 'ObjectAlreadyExists', conflicts },
					);
			}
			await Promise.all(
				files.map((file, index) =>
					service.uploadObject(bucket, keys[index], file.buffer, file.mimetype),
				),
			);
			res.status(201).json({ keys });
		},
	);

	router.post('/buckets/:bucket/folders', async (req, res) => {
		const key = requireKey(req.body?.key);
		await service.createFolder(requireBucket(req.params.bucket), key);
		res.status(201).json({ key: key.endsWith('/') ? key : `${key}/` });
	});

	router.get('/buckets/:bucket/objects/download', async (req, res) => {
		const key = requireKey(req.query.key);
		const object = await service.getObject(
			requireBucket(req.params.bucket),
			key,
		);
		res.setHeader(
			'Content-Type',
			object.ContentType ?? 'application/octet-stream',
		);
		if (object.ContentLength !== undefined)
			res.setHeader('Content-Length', object.ContentLength.toString());
		res.setHeader(
			'Content-Disposition',
			`attachment; filename="${safeFilename(key)}"`,
		);
		pipeBody(object.Body, res);
	});

	router.get('/buckets/:bucket/objects/preview', async (req, res) => {
		const key = requireKey(req.query.key);
		const extension = key.toLowerCase().split('.').pop() ?? '';
		const allowed = new Set([
			'txt',
			'log',
			'md',
			'json',
			'png',
			'jpg',
			'jpeg',
			'gif',
			'webp',
			'svg',
			'pdf',
		]);
		if (!allowed.has(extension))
			throw Object.assign(
				new Error('Preview is not supported for this file type'),
				{ status: 415, code: 'PreviewUnsupported' },
			);
		const object = await service.getObject(
			requireBucket(req.params.bucket),
			key,
		);
		res.setHeader(
			'Content-Type',
			object.ContentType ?? 'application/octet-stream',
		);
		res.setHeader(
			'Content-Disposition',
			`inline; filename="${safeFilename(key)}"`,
		);
		pipeBody(object.Body, res);
	});

	router.delete('/buckets/:bucket/objects', async (req, res) => {
		await service.deleteObject(
			requireBucket(req.params.bucket),
			requireKey(req.query.key),
		);
		res.status(204).end();
	});

	for (const operation of ['copy', 'move'] as const) {
		router.post(`/buckets/:bucket/objects/${operation}`, async (req, res) => {
			const bucket = requireBucket(req.params.bucket);
			const sourceKey = requireKey(req.body?.sourceKey);
			const destinationKey = requireKey(req.body?.destinationKey);
			if (sourceKey === destinationKey)
				throw Object.assign(new Error('Source and destination must differ'), {
					status: 400,
					code: 'InvalidDestination',
				});
			if (
				!req.body?.overwrite &&
				(await service.exists(bucket, destinationKey))
			) {
				throw Object.assign(
					new Error(`Object already exists: ${destinationKey}`),
					{ status: 409, code: 'ObjectAlreadyExists' },
				);
			}
			await service[operation === 'copy' ? 'copyObject' : 'moveObject'](
				bucket,
				sourceKey,
				destinationKey,
			);
			res.status(201).json({ sourceKey, destinationKey });
		});
	}

	return router;
}
