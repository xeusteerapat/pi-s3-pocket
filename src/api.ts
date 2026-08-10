export interface Bucket { name: string; creationDate?: string }
export interface Folder { key: string; name: string }
export interface S3Object {
  key: string;
  name: string;
  size: number;
  lastModified?: string;
  etag?: string;
  contentType?: string;
}
export interface ObjectPage {
  folders: Folder[];
  objects: S3Object[];
  nextContinuationToken?: string;
  isTruncated: boolean;
}

export class ApiError extends Error {
  constructor(message: string, public code = "RequestFailed", public status = 500, public details?: unknown) { super(message); }
}

export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(payload?.error?.message ?? response.statusText, payload?.error?.code, response.status, payload?.error);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export const bucketPath = (bucket: string) => `/api/buckets/${encodeURIComponent(bucket)}`;
export const query = (values: Record<string, string | undefined>) => {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => value !== undefined && params.set(key, value));
  return params.toString();
};
