import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type DragEvent,
} from 'react';
import {
	ApiError,
	bucketPath,
	query,
	request,
	type Bucket,
	type Folder,
	type ObjectPage,
	type S3Object,
	type SearchResult,
} from './api';

type SortKey = 'name' | 'size' | 'lastModified';
type Entry = (Folder & { kind: 'folder' }) | (S3Object & { kind: 'object' });
type RequestLog = { method: string; url: string; status: number; time: string };

const formatSize = (bytes: number) => {
	if (!bytes) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const index = Math.min(
		Math.floor(Math.log(bytes) / Math.log(1024)),
		units.length - 1,
	);
	return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
};
const formatDate = (value?: string) =>
	value
		? new Intl.DateTimeFormat(undefined, {
				dateStyle: 'medium',
				timeStyle: 'short',
			}).format(new Date(value))
		: '—';
const errorText = (error: unknown) =>
	error instanceof Error ? error.message : 'An unexpected error occurred';

function uploadFiles(
	bucket: string,
	prefix: string,
	files: File[],
	overwrite: boolean,
	onProgress: (value: number) => void,
) {
	return new Promise<void>((resolve, reject) => {
		const form = new FormData();
		form.set('prefix', prefix);
		form.set('overwrite', String(overwrite));
		files.forEach((file) => form.append('files', file));
		const xhr = new XMLHttpRequest();
		xhr.open('POST', `${bucketPath(bucket)}/objects`);
		xhr.upload.onprogress = (event) =>
			event.lengthComputable &&
			onProgress(Math.round((event.loaded / event.total) * 100));
		xhr.onload = () => {
			window.dispatchEvent(
				new CustomEvent('s3-api-request', {
					detail: {
						method: 'PUT',
						url: `${bucketPath(bucket)}/objects`,
						status: xhr.status,
						time: new Date().toISOString(),
					},
				}),
			);
			if (xhr.status >= 200 && xhr.status < 300) resolve();
			else {
				try {
					const body = JSON.parse(xhr.responseText);
					reject(
						new ApiError(
							body.error?.message,
							body.error?.code,
							xhr.status,
							body.error,
						),
					);
				} catch {
					reject(new ApiError(xhr.statusText, 'UploadFailed', xhr.status));
				}
			}
		};
		xhr.onerror = () => {
			window.dispatchEvent(
				new CustomEvent('s3-api-request', {
					detail: {
						method: 'PUT',
						url: `${bucketPath(bucket)}/objects`,
						status: 0,
						time: new Date().toISOString(),
					},
				}),
			);
			reject(new ApiError('Unable to reach the upload API', 'NetworkError', 0));
		};
		xhr.send(form);
	});
}

function Modal({
	title,
	children,
	onClose,
}: {
	title: string;
	children: React.ReactNode;
	onClose: () => void;
}) {
	useEffect(() => {
		const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
		window.addEventListener('keydown', close);
		return () => window.removeEventListener('keydown', close);
	}, [onClose]);
	return (
		<div className='modal-backdrop' onMouseDown={onClose}>
			<section
				className='modal'
				onMouseDown={(event) => event.stopPropagation()}
			>
				<header>
					<strong>{title}</strong>
					<button className='icon-button' onClick={onClose} aria-label='Close'>
						×
					</button>
				</header>
				{children}
			</section>
		</div>
	);
}

export default function App() {
	const [health, setHealth] = useState<{
		connected: boolean;
		endpoint: string;
	}>({ connected: false, endpoint: 'http://localhost:4566' });
	const [buckets, setBuckets] = useState<Bucket[]>([]);
	const [bucket, setBucket] = useState('');
	const [prefix, setPrefix] = useState('');
	const [page, setPage] = useState<ObjectPage>({
		folders: [],
		objects: [],
		isTruncated: false,
	});
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [search, setSearch] = useState('');
	const [globalSearch, setGlobalSearch] = useState('');
	const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
	const [searching, setSearching] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	const [sort, setSort] = useState<SortKey>('name');
	const [ascending, setAscending] = useState(true);
	const [uploadProgress, setUploadProgress] = useState<number | null>(null);
	const [dragging, setDragging] = useState(false);
	const [requestLogs, setRequestLogs] = useState<RequestLog[]>([]);
	const [preview, setPreview] = useState<{
		object: S3Object;
		url?: string;
		text?: string;
		error?: string;
	} | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		const capture = (event: Event) => {
			const log = (event as CustomEvent<RequestLog>).detail;
			setRequestLogs((current) => [log, ...current].slice(0, 8));
		};
		window.addEventListener('s3-api-request', capture);
		return () => window.removeEventListener('s3-api-request', capture);
	}, []);

	useEffect(() => {
		const term = globalSearch.trim();
		if (!term) {
			setSearchResults(null);
			setSearching(false);
			return;
		}
		let active = true;
		setSearching(true);
		const timer = window.setTimeout(async () => {
			try {
				const result = await request<SearchResult>(
					`/api/search?${query({ q: term })}`,
				);
				if (active) setSearchResults(result);
			} catch (err) {
				if (active) setError(errorText(err));
			} finally {
				if (active) setSearching(false);
			}
		}, 300);
		return () => {
			active = false;
			window.clearTimeout(timer);
		};
	}, [globalSearch]);

	const checkHealth = useCallback(async () => {
		try {
			const result = await request<{ connected: boolean; endpoint: string }>(
				'/api/health',
			);
			setHealth(result);
		} catch (err) {
			if (
				err instanceof ApiError &&
				err.details &&
				typeof err.details === 'object'
			) {
				setHealth({ connected: false, endpoint: health.endpoint });
			} else setHealth((old) => ({ ...old, connected: false }));
		}
	}, [health.endpoint]);

	const loadBuckets = useCallback(async () => {
		try {
			const result = await request<{ buckets: Bucket[] }>('/api/buckets');
			setBuckets(result.buckets);
			setError('');
		} catch (err) {
			setError(
				`Unable to connect to S3 at ${health.endpoint}. ${errorText(err)} Make sure Floci is running.`,
			);
		}
	}, [health.endpoint]);

	const loadObjects = useCallback(
		async (append = false, token?: string) => {
			if (!bucket) return;
			setLoading(true);
			try {
				const result = await request<ObjectPage>(
					`${bucketPath(bucket)}/objects?${query({ prefix, continuationToken: token })}`,
				);
				setPage((old) =>
					append
						? {
								...result,
								folders: [...old.folders, ...result.folders],
								objects: [...old.objects, ...result.objects],
							}
						: result,
				);
				setError('');
			} catch (err) {
				setError(errorText(err));
			} finally {
				setLoading(false);
			}
		},
		[bucket, prefix],
	);

	useEffect(() => {
		void checkHealth();
		void loadBuckets();
		const timer = window.setInterval(checkHealth, 15000);
		return () => window.clearInterval(timer);
	}, [checkHealth, loadBuckets]);
	useEffect(() => {
		setPage({ folders: [], objects: [], isTruncated: false });
		void loadObjects();
	}, [loadObjects]);

	const entries = useMemo<Entry[]>(() => {
		const all: Entry[] = [
			...page.folders.map((item) => ({ ...item, kind: 'folder' as const })),
			...page.objects.map((item) => ({ ...item, kind: 'object' as const })),
		].filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));
		return all.sort((a, b) => {
			if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
			let result = 0;
			if (sort === 'name') result = a.name.localeCompare(b.name);
			else if (sort === 'size')
				result = ('size' in a ? a.size : 0) - ('size' in b ? b.size : 0);
			else
				result =
					new Date(
						'lastModified' in a && a.lastModified ? a.lastModified : 0,
					).getTime() -
					new Date(
						'lastModified' in b && b.lastModified ? b.lastModified : 0,
					).getTime();
			return ascending ? result : -result;
		});
	}, [page, search, sort, ascending]);

	const chooseBucket = (name: string) => {
		setBucket(name);
		setPrefix('');
		setSearch('');
	};
	const chooseSearchBucket = (name: string) => {
		chooseBucket(name);
		setGlobalSearch('');
		setSearchOpen(false);
	};
	const chooseSearchObject = (result: SearchResult['objects'][number]) => {
		setBucket(result.bucket);
		const slash = result.key.lastIndexOf('/');
		setPrefix(slash >= 0 ? result.key.slice(0, slash + 1) : '');
		setSearch(slash >= 0 ? result.key.slice(slash + 1) : result.key);
		setGlobalSearch('');
		setSearchOpen(false);
	};
	const showError = (err: unknown) => setError(errorText(err));

	async function createBucket() {
		const name = window.prompt('Bucket name');
		if (!name) return;
		if (
			name.length < 3 ||
			name.length > 63 ||
			!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name)
		)
			return setError(
				'Bucket names must be 3–63 characters using lowercase letters, numbers, dots, or hyphens.',
			);
		try {
			await request('/api/buckets', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name }),
			});
			await loadBuckets();
			chooseBucket(name);
		} catch (err) {
			showError(err);
		}
	}

	async function deleteBucket(name: string) {
		if (!window.confirm(`Delete bucket “${name}”? It must be empty.`)) return;
		try {
			await request(bucketPath(name), { method: 'DELETE' });
			if (bucket === name) {
				setBucket('');
				setPrefix('');
			}
			await loadBuckets();
		} catch (err) {
			showError(err);
		}
	}

	async function doUpload(files: File[]) {
		if (!bucket || !files.length) return;
		setUploadProgress(0);
		try {
			try {
				await uploadFiles(bucket, prefix, files, false, setUploadProgress);
			} catch (err) {
				if (
					err instanceof ApiError &&
					err.code === 'ObjectAlreadyExists' &&
					window.confirm(`${err.message}\n\nOverwrite existing object(s)?`)
				) {
					await uploadFiles(bucket, prefix, files, true, setUploadProgress);
				} else throw err;
			}
			await loadObjects();
		} catch (err) {
			showError(err);
		} finally {
			setUploadProgress(null);
			if (inputRef.current) inputRef.current.value = '';
		}
	}

	async function createFolder() {
		const name = window.prompt('Folder name');
		if (!name) return;
		const key = `${prefix}${name.replace(/^\/+|\/+$/g, '')}/`;
		try {
			await request(`${bucketPath(bucket)}/folders`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ key }),
			});
			await loadObjects();
		} catch (err) {
			showError(err);
		}
	}

	async function deleteObject(object: S3Object) {
		if (!window.confirm(`Delete “${object.key}”?`)) return;
		try {
			await request(
				`${bucketPath(bucket)}/objects?${query({ key: object.key })}`,
				{ method: 'DELETE' },
			);
			await loadObjects();
		} catch (err) {
			showError(err);
		}
	}

	async function transfer(object: S3Object, operation: 'copy' | 'move') {
		const label = operation === 'move' ? 'Rename / move' : 'Copy';
		const destinationKey = window.prompt(
			`${label} “${object.key}” to:`,
			object.key,
		);
		if (!destinationKey || destinationKey === object.key) return;
		const execute = (overwrite: boolean) =>
			request(`${bucketPath(bucket)}/objects/${operation}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sourceKey: object.key,
					destinationKey,
					overwrite,
				}),
			});
		try {
			try {
				await execute(false);
			} catch (err) {
				if (
					err instanceof ApiError &&
					err.code === 'ObjectAlreadyExists' &&
					window.confirm(`${err.message}\n\nOverwrite it?`)
				)
					await execute(true);
				else throw err;
			}
			await loadObjects();
		} catch (err) {
			showError(err);
		}
	}

	async function openPreview(object: S3Object) {
		setPreview({ object });
		const extension = object.name.toLowerCase().split('.').pop() ?? '';
		if (
			![
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
			].includes(extension)
		)
			return setPreview({
				object,
				error: 'Preview is unavailable for this file type.',
			});
		if (
			['txt', 'log', 'md', 'json'].includes(extension) &&
			object.size > 5 * 1024 * 1024
		)
			return setPreview({ object, error: 'Text preview is limited to 5 MB.' });
		try {
			const response = await fetch(
				`${bucketPath(bucket)}/objects/preview?${query({ key: object.key })}`,
			);
			if (!response.ok)
				throw new Error(
					(await response.json()).error?.message ?? response.statusText,
				);
			if (['txt', 'log', 'md', 'json'].includes(extension)) {
				let text = await response.text();
				if (extension === 'json')
					try {
						text = JSON.stringify(JSON.parse(text), null, 2);
					} catch {
						/* show invalid JSON as-is */
					}
				setPreview({ object, text });
			} else
				setPreview({ object, url: URL.createObjectURL(await response.blob()) });
		} catch (err) {
			setPreview({ object, error: errorText(err) });
		}
	}

	function closePreview() {
		if (preview?.url) URL.revokeObjectURL(preview.url);
		setPreview(null);
	}

	function changeSort(next: SortKey) {
		if (sort === next) setAscending((value) => !value);
		else {
			setSort(next);
			setAscending(true);
		}
	}

	const crumbs = prefix.split('/').filter(Boolean);
	const loadedSize = page.objects.reduce(
		(total, object) => total + object.size,
		0,
	);
	const currentBucket = buckets.find((item) => item.name === bucket);
	return (
		<div className='app'>
			<header className='topbar'>
				<div className='brand'>
					<span className='brand-mark'>♧</span>
					<span>
						<h1>s3-local-console</h1>
						<small>local development file manager</small>
					</span>
				</div>
				<div className='header-controls'>
					<div className='global-search'>
						<span>⌕</span>
						<input
							value={globalSearch}
							onChange={(event) => {
								setGlobalSearch(event.target.value);
								setSearchOpen(true);
							}}
							onFocus={() => setSearchOpen(true)}
							onBlur={() => window.setTimeout(() => setSearchOpen(false), 150)}
							placeholder='Search all buckets and objects…'
						/>
						{searching && <i>…</i>}
						{searchOpen && globalSearch.trim() && (
							<div className='search-results'>
								{searchResults?.buckets.map((result) => (
									<button
										key={`bucket-${result.name}`}
										onClick={() => chooseSearchBucket(result.name)}
									>
										<span className='result-icon'>▱</span>
										<span>
											<b>{result.name}</b>
											<small>Bucket</small>
										</span>
									</button>
								))}
								{searchResults?.objects.map((result) => (
									<button
										key={`${result.bucket}-${result.key}`}
										onClick={() => chooseSearchObject(result)}
									>
										<span className='result-icon'>⌑</span>
										<span>
											<b>{result.key}</b>
											<small>
												s3://{result.bucket} · {formatSize(result.size)}
											</small>
										</span>
									</button>
								))}
								{!searching &&
									searchResults &&
									!searchResults.buckets.length &&
									!searchResults.objects.length && (
										<p>No matches for “{globalSearch}”</p>
									)}
								{searchResults?.truncated && (
									<footer>Showing the first 100 object matches</footer>
								)}
							</div>
						)}
					</div>
					<div className='endpoint-pill'>
						⌁ <b>Floci</b>
						<span>{health.endpoint}</span>
					</div>
					<div className={`status ${health.connected ? 'online' : 'offline'}`}>
						<span className='dot' />
						{health.connected ? 'connected' : 'offline'}
					</div>
					<button
						className='credentials'
						onClick={() =>
							window.alert(
								'S3 credentials are configured securely on the server through environment variables.',
							)
						}
					>
						⌘ Local credentials
					</button>
				</div>
			</header>

			<aside className='sidebar'>
				<div className='sidebar-title'>
					<strong>Buckets</strong>
					<button onClick={() => void loadBuckets()} title='Refresh buckets'>
						↻
					</button>
				</div>
				<div className='bucket-list'>
					{buckets.map((item) => (
						<div
							className={`bucket ${bucket === item.name ? 'active' : ''}`}
							key={item.name}
						>
							<button
								className='bucket-name'
								onClick={() => chooseBucket(item.name)}
								title={item.name}
							>
								▱{' '}
								<span>
									<b>{item.name}</b>
									{item.creationDate && (
										<small>Created {formatDate(item.creationDate)}</small>
									)}
								</span>
							</button>
							<button
								className='delete-small'
								onClick={() => void deleteBucket(item.name)}
								title='Delete bucket'
							>
								×
							</button>
						</div>
					))}
					{!buckets.length && <p className='empty-side'>No buckets</p>}
					<button className='create-bucket' onClick={createBucket}>
						＋ Create bucket
					</button>
				</div>
				<section className='request-log'>
					<h3>Request log</h3>
					{requestLogs.length ? (
						requestLogs.map((log, index) => (
							<div className='log-entry' key={`${log.time}-${index}`}>
								<span>
									{new Date(log.time).toLocaleTimeString([], { hour12: false })}
								</span>{' '}
								<b
									className={
										log.status >= 400 || !log.status ? 'log-error' : ''
									}
								>
									{log.method} {log.status || 'ERR'}
								</b>
								<small>
									{log.url
										.replace('/api/buckets/', 's3://')
										.replace('/api/', '/')}
								</small>
							</div>
						))
					) : (
						<p>No requests yet</p>
					)}
				</section>
			</aside>

			<main
				className={`main ${dragging ? 'dragging' : ''}`}
				onDragEnter={(event) => {
					event.preventDefault();
					if (bucket) setDragging(true);
				}}
				onDragOver={(event) => event.preventDefault()}
				onDragLeave={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget as Node))
						setDragging(false);
				}}
				onDrop={(event: DragEvent) => {
					event.preventDefault();
					setDragging(false);
					void doUpload(Array.from(event.dataTransfer.files));
				}}
			>
				{error && (
					<div className='error-banner'>
						<span>{error}</span>
						<button onClick={() => setError('')}>×</button>
					</div>
				)}
				{!bucket ? (
					<div className='welcome'>
						<div className='welcome-icon'>▱</div>
						<h2>Select a bucket</h2>
						<p>Choose a bucket in the sidebar or create a new one.</p>
					</div>
				) : (
					<>
						<section className='bucket-overview'>
							<div className='bucket-heading'>
								<div>
									<h2>s3://{bucket}</h2>
									<p>
										region us-east-1{' '}
										{currentBucket?.creationDate && (
											<>· created {formatDate(currentBucket.creationDate)}</>
										)}
									</p>
								</div>
								<div className='overview-actions'>
									<button
										className='primary'
										onClick={() => inputRef.current?.click()}
									>
										↥ Upload
									</button>
									<button onClick={createFolder}>▱ New folder</button>
									<button
										className='delete-overview'
										onClick={() => void deleteBucket(bucket)}
									>
										Delete bucket
									</button>
								</div>
							</div>
							<div className='bucket-stats'>
								<div>
									<span>▧</span>
									<b>{page.objects.length}</b>
									<small>Loaded objects</small>
								</div>
								<div>
									<span>▤</span>
									<b>{formatSize(loadedSize)}</b>
									<small>Loaded size</small>
								</div>
								<div>
									<span>⌑</span>
									<b>local</b>
									<small>Access</small>
								</div>
							</div>
						</section>
						<nav className='breadcrumbs'>
							<button onClick={() => setPrefix('')}>{bucket}</button>
							{crumbs.map((crumb, index) => (
								<span key={`${crumb}-${index}`}>
									{' '}
									/{' '}
									<button
										onClick={() =>
											setPrefix(`${crumbs.slice(0, index + 1).join('/')}/`)
										}
									>
										{crumb}
									</button>
								</span>
							))}
						</nav>
						<div className='toolbar'>
							<input
								ref={inputRef}
								hidden
								type='file'
								multiple
								onChange={(event) =>
									void doUpload(Array.from(event.target.files ?? []))
								}
							/>
							<button
								onClick={() => void loadObjects()}
								disabled={loading}
								title='Refresh objects'
							>
								↻
							</button>
							<input
								className='search'
								placeholder='Filter current folder…'
								value={search}
								onChange={(event) => setSearch(event.target.value)}
							/>
						</div>
						{uploadProgress !== null && (
							<div className='progress'>
								<div style={{ width: `${uploadProgress}%` }} />
								<span>Uploading… {uploadProgress}%</span>
							</div>
						)}
						<div className='table-wrap'>
							<table>
								<thead>
									<tr>
										<th>
											<button onClick={() => changeSort('name')}>
												Key {sort === 'name' && (ascending ? '↑' : '↓')}
											</button>
										</th>
										<th>Content type</th>
										<th>
											<button onClick={() => changeSort('size')}>
												Size {sort === 'size' && (ascending ? '↑' : '↓')}
											</button>
										</th>
										<th>
											<button onClick={() => changeSort('lastModified')}>
												Last modified{' '}
												{sort === 'lastModified' && (ascending ? '↑' : '↓')}
											</button>
										</th>
										<th>ETag</th>
										<th>Actions</th>
									</tr>
								</thead>
								<tbody>
									{entries.map((entry) =>
										entry.kind === 'folder' ? (
											<tr key={`f-${entry.key}`} className='folder-row'>
												<td colSpan={5}>
													<button
														className='entry-name'
														onClick={() => setPrefix(entry.key)}
													>
														📁 <span>{entry.name}</span>
													</button>
												</td>
												<td />
											</tr>
										) : (
											<tr key={`o-${entry.key}`} title={entry.key}>
												<td>
													<button
														className='entry-name'
														onClick={() => void openPreview(entry)}
													>
														📄 <span>{entry.name}</span>
													</button>
													<small className='full-key'>{entry.key}</small>
												</td>
												<td>{entry.contentType ?? '—'}</td>
												<td>{formatSize(entry.size)}</td>
												<td>{formatDate(entry.lastModified)}</td>
												<td className='etag'>{entry.etag ?? '—'}</td>
												<td>
													<div className='actions'>
														<button onClick={() => void openPreview(entry)}>
															Preview
														</button>
														<a
															href={`${bucketPath(bucket)}/objects/download?${query({ key: entry.key })}`}
														>
															Download
														</a>
														<button
															onClick={() => void transfer(entry, 'move')}
														>
															Rename
														</button>
														<button
															onClick={() => void transfer(entry, 'copy')}
														>
															Copy
														</button>
														<button
															className='danger'
															onClick={() => void deleteObject(entry)}
														>
															Delete
														</button>
													</div>
												</td>
											</tr>
										),
									)}
									{!entries.length && !loading && (
										<tr>
											<td colSpan={6} className='empty-table'>
												This folder is empty.
											</td>
										</tr>
									)}
								</tbody>
							</table>
							{loading && <div className='loading'>Loading…</div>}
						</div>
						{page.isTruncated && (
							<button
								className='load-more'
								disabled={loading}
								onClick={() =>
									void loadObjects(true, page.nextContinuationToken)
								}
							>
								Load more
							</button>
						)}
						<div className='utility-panels'>
							<button
								className='upload-zone'
								onClick={() => inputRef.current?.click()}
							>
								<span>↥</span>
								<b>Drop files here to upload</b>
								<small>up to 100 MB per object · 20 files per request</small>
							</button>
							<section className='cli-panel'>
								<h3>Equivalent CLI</h3>
								<pre>{`aws --endpoint-url ${health.endpoint} \\\n  s3 ls s3://${bucket}/${prefix}\n\naws --endpoint-url ${health.endpoint} \\\n  s3 cp ./file.txt s3://${bucket}/${prefix}`}</pre>
							</section>
						</div>
						{dragging && (
							<div className='drop-overlay'>
								Drop files to upload into <strong>{prefix || '/'}</strong>
							</div>
						)}
					</>
				)}
			</main>

			{preview && (
				<Modal title={preview.object.name} onClose={closePreview}>
					<div className='metadata'>
						<span>
							<b>Key</b>
							{preview.object.key}
						</span>
						<span>
							<b>Size</b>
							{formatSize(preview.object.size)}
						</span>
						<span>
							<b>Type</b>
							{preview.object.contentType ?? 'Unknown'}
						</span>
						<span>
							<b>Modified</b>
							{formatDate(preview.object.lastModified)}
						</span>
						<span>
							<b>ETag</b>
							{preview.object.etag ?? '—'}
						</span>
					</div>
					<div className='preview-body'>
						{preview.error && (
							<div className='unsupported'>{preview.error}</div>
						)}
						{preview.text !== undefined && <pre>{preview.text}</pre>}
						{preview.url &&
							preview.object.name.toLowerCase().endsWith('.pdf') && (
								<iframe src={preview.url} title={preview.object.name} />
							)}
						{preview.url &&
							!preview.object.name.toLowerCase().endsWith('.pdf') && (
								<img src={preview.url} alt={preview.object.name} />
							)}
						{!preview.error && preview.text === undefined && !preview.url && (
							<div className='loading'>Loading preview…</div>
						)}
					</div>
					<footer className='modal-footer'>
						<a
							className='button primary'
							href={`${bucketPath(bucket)}/objects/download?${query({ key: preview.object.key })}`}
						>
							Download
						</a>
						<button onClick={closePreview}>Close</button>
					</footer>
				</Modal>
			)}
		</div>
	);
}
