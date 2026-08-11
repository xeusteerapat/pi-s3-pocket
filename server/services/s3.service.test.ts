import {
	CopyObjectCommand,
	DeleteObjectCommand,
	HeadObjectCommand,
	ListBucketsCommand,
	ListObjectsV2Command,
	PutObjectCommand,
} from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { S3Service } from './s3.service';

const serviceWith = (send: ReturnType<typeof vi.fn>) =>
	new S3Service({ send: send as never });

describe('S3Service', () => {
	it('lists buckets', async () => {
		const send = vi.fn().mockResolvedValue({
			Buckets: [{ Name: 'demo', CreationDate: new Date('2026-01-01') }],
		});
		await expect(serviceWith(send).listBuckets()).resolves.toEqual([
			{ name: 'demo', creationDate: '2026-01-01T00:00:00.000Z' },
		]);
		expect(send.mock.calls[0][0]).toBeInstanceOf(ListBucketsCommand);
	});

	it('searches bucket names and paginated object keys', async () => {
		const send = vi.fn(async (command) => {
			if (command instanceof ListBucketsCommand) {
				return { Buckets: [{ Name: 'cool-bucket' }, { Name: 'documents' }] };
			}
			if (command instanceof ListObjectsV2Command) {
				if (command.input.Bucket === 'cool-bucket') return { Contents: [] };
				if (!command.input.ContinuationToken) {
					return {
						Contents: [{ Key: 'ordinary.txt' }],
						NextContinuationToken: 'page-2',
						IsTruncated: true,
					};
				}
				return {
					Contents: [{ Key: 'archive/cool-object.json', Size: 12 }],
					IsTruncated: false,
				};
			}
			return {};
		});

		await expect(serviceWith(send).search('COOL')).resolves.toEqual({
			buckets: [{ name: 'cool-bucket', creationDate: undefined }],
			objects: [
				{
					bucket: 'documents',
					key: 'archive/cool-object.json',
					size: 12,
					lastModified: undefined,
					etag: undefined,
				},
			],
			truncated: false,
		});
	});

	it('lists objects and common prefixes', async () => {
		const send = vi.fn(async (command) => {
			if (command instanceof HeadObjectCommand)
				return { ContentType: 'application/pdf' };
			return {
				CommonPrefixes: [{ Prefix: 'documents/2026/' }],
				Contents: [
					{
						Key: 'documents/report.pdf',
						Size: 42,
						ETag: '"abc"',
						LastModified: new Date('2026-01-02'),
					},
				],
				IsTruncated: true,
				NextContinuationToken: 'next',
			};
		});
		await expect(
			serviceWith(send).listObjects('demo', 'documents/'),
		).resolves.toEqual({
			folders: [{ key: 'documents/2026/', name: '2026' }],
			objects: [
				{
					key: 'documents/report.pdf',
					name: 'report.pdf',
					size: 42,
					etag: '"abc"',
					lastModified: '2026-01-02T00:00:00.000Z',
					contentType: 'application/pdf',
				},
			],
			isTruncated: true,
			nextContinuationToken: 'next',
		});
	});

	it('uses prefix, delimiter, and continuation token for navigation', async () => {
		const send = vi.fn().mockResolvedValue({});
		await serviceWith(send).listObjects('demo', 'a/b/', 'token');
		const command = send.mock.calls[0][0] as ListObjectsV2Command;
		expect(command.input).toMatchObject({
			Bucket: 'demo',
			Prefix: 'a/b/',
			Delimiter: '/',
			ContinuationToken: 'token',
		});
	});

	it('uploads an object with its content type', async () => {
		const send = vi.fn().mockResolvedValue({});
		await serviceWith(send).uploadObject(
			'demo',
			'a.txt',
			Buffer.from('hello'),
			'text/plain',
		);
		const command = send.mock.calls[0][0] as PutObjectCommand;
		expect(command.input).toMatchObject({
			Bucket: 'demo',
			Key: 'a.txt',
			ContentType: 'text/plain',
		});
	});

	it('deletes an object', async () => {
		const send = vi.fn().mockResolvedValue({});
		await serviceWith(send).deleteObject('demo', 'old.txt');
		expect(send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
	});

	it('copies before deleting when moving', async () => {
		const send = vi.fn().mockResolvedValue({});
		await serviceWith(send).moveObject(
			'demo',
			'old name.txt',
			'folder/new.txt',
		);
		expect(send.mock.calls[0][0]).toBeInstanceOf(CopyObjectCommand);
		expect((send.mock.calls[0][0] as CopyObjectCommand).input.CopySource).toBe(
			'/demo/old%20name.txt',
		);
		expect(send.mock.calls[1][0]).toBeInstanceOf(DeleteObjectCommand);
	});

	it('does not delete the source when a move copy fails', async () => {
		const send = vi.fn().mockRejectedValue(new Error('copy failed'));
		await expect(
			serviceWith(send).moveObject('demo', 'old.txt', 'new.txt'),
		).rejects.toThrow('copy failed');
		expect(send).toHaveBeenCalledTimes(1);
	});

	it('surfaces errors when Floci is unavailable', async () => {
		const offline = Object.assign(
			new Error('connect ECONNREFUSED 127.0.0.1:4566'),
			{ code: 'ECONNREFUSED' },
		);
		const send = vi.fn().mockRejectedValue(offline);
		await expect(serviceWith(send).listBuckets()).rejects.toMatchObject({
			code: 'ECONNREFUSED',
		});
	});
});
