# Floci S3 Pocket

A lightweight local S3 file browser for developers using [Floci](https://github.com/hectorvent/floci). The browser talks only to a local Express API; all S3 access is handled server-side with AWS SDK v3 and path-style URLs.

## Features

- Floci connection status and useful offline errors
- List, create, and safely delete buckets
- Prefix/delimiter folder navigation with breadcrumbs and paginated results
- Multi-file picker and drag-and-drop uploads with progress and overwrite confirmation
- Streaming downloads and safe previews for text, JSON, images, SVG, and PDF
- Create logical folders, delete, copy, and move/rename objects
- Search the current folder and sort by name, size, or modified date
- Object key, size, content type, modified date, and ETag metadata

## Requirements

- Node.js 20+
- Docker with Compose (to run Floci), or an existing local Floci instance

## Run locally

```bash
# 1. Start Floci
docker compose up -d

# 2. Configure and start the application
cp .env.example .env
npm install
npm run dev
```

Open <http://localhost:5173>. The API runs at <http://localhost:3001> and Vite proxies `/api` to it.

All S3 settings are environment variables. Defaults target `http://localhost:4566` with `test` credentials and never target AWS unless explicitly configured.

## Add test data

Create a bucket in the UI, or use an AWS-compatible CLI:

```bash
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  aws --endpoint-url http://localhost:4566 s3 mb s3://demo-bucket

echo '{"hello":"Floci"}' > /tmp/example.json
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  aws --endpoint-url http://localhost:4566 s3 cp /tmp/example.json s3://demo-bucket/documents/example.json
```

Refresh the UI and select `demo-bucket`.

## Checks and production build

```bash
npm test
npm run typecheck
npm run build
npm start       # serves dist/ and the API on port 3001 after npm run build
```

## Architecture

```text
React + Vite browser UI
        │ /api
        ▼
Express REST adapter
        │ AWS SDK v3
        ▼
Floci (localhost:4566)
```

S3 calls are centralized in `server/services/s3.service.ts`; route handlers handle HTTP validation and streaming.

## Limits

- Uploads are buffered by the local API and limited to 100 MB per file and 20 files per request.
- Text previews are limited in the UI to 5 MB.
- Folders are logical prefixes represented by zero-byte keys ending in `/`.
- Recursive folder or bucket deletion is intentionally not provided.
- This is a local development tool and has no authentication.
