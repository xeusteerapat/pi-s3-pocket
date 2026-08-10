# Task: Build a Local S3 Web UI for Floci

Build a lightweight web application for browsing and managing an S3-compatible storage service running locally with **Floci**.

The application is intended primarily as a **developer tool for local development**, similar to a minimal S3 console.

Keep the implementation simple, maintainable, and easy to run locally. Avoid unnecessary abstractions or enterprise-level architecture.

## Floci Environment

Assume Floci is running locally with:

```env
S3_ENDPOINT=http://localhost:4566
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
```

Use AWS SDK for JavaScript v3.

Configure the S3 client approximately as:

```ts
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? "http://localhost:4566",
  region: process.env.AWS_REGION ?? "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
  },
  forcePathStyle: true,
});
```

Do not connect to real AWS by default.

All S3 configuration must be configurable through environment variables.

---

# Architecture

Prefer the following architecture:

```text
Browser
   │
   ▼
Web UI
   │
   │ HTTP
   ▼
Local Backend API
   │
   │ AWS SDK v3
   ▼
Floci
http://localhost:4566
```

Do not access S3 directly from the browser.

The backend should act as a thin adapter around the AWS S3 SDK.

If this repository already contains a frontend/backend stack, inspect the existing codebase first and reuse its conventions.

If creating a new application, prefer:

Frontend:

* React
* TypeScript
* Vite

Backend:

* Node.js
* TypeScript
* Express or Fastify

S3 SDK:

```text
@aws-sdk/client-s3
```

Keep frontend and backend dependencies minimal.

---

# Core User Experience

The application should behave like a small file explorer.

Example:

```text
┌───────────────────────────────────────────────────────────┐
│ Local S3                                      Floci ●     │
├─────────────────┬─────────────────────────────────────────┤
│ Buckets         │ my-bucket / documents /                 │
│                 │                                         │
│ > my-bucket     │ Name           Size       Modified      │
│   images        │ 📁 invoices                            │
│   test-data     │ 📄 report.pdf  1.4 MB     10 Aug 2026 │
│                 │ 📄 data.json   12 KB      10 Aug 2026 │
│                 │                                         │
│ + New Bucket    │                 Upload                  │
└─────────────────┴─────────────────────────────────────────┘
```

The UI should prioritize utility over visual complexity.

---

# Bucket Operations

Implement the following bucket operations.

## List Buckets

Display all available S3 buckets.

Show:

* bucket name
* creation date if available

Selecting a bucket should display its contents.

## Create Bucket

Provide a "New Bucket" action.

Ask for:

```text
Bucket name
```

Validate the name before submitting.

Refresh the bucket list after creation.

## Delete Bucket

Allow deleting a bucket.

Require confirmation before deletion.

If deletion fails because the bucket is not empty, display the actual S3 error instead of hiding it.

Do not automatically recursively delete bucket contents unless explicitly requested by the user.

---

# Object Operations

Implement standard object CRUD-like operations.

## List Objects

Use `ListObjectsV2`.

Support navigation using:

```text
Prefix
Delimiter="/"
```

This should provide a filesystem-like experience.

Example S3 keys:

```text
documents/report.pdf
documents/2026/invoice.pdf
images/logo.png
```

should appear as:

```text
/
├── documents/
│   ├── report.pdf
│   └── 2026/
│       └── invoice.pdf
└── images/
    └── logo.png
```

Remember that S3 does not have real directories.

Treat prefixes as folders in the UI.

## Upload Object

Allow uploading one or multiple files.

Support:

* file picker
* drag and drop

When the user is currently inside:

```text
documents/2026/
```

uploading:

```text
report.pdf
```

should create:

```text
documents/2026/report.pdf
```

Show upload progress when reasonably possible.

After upload succeeds, refresh the current directory.

## Download Object

Provide a download action for every object.

Stream the object through the backend rather than loading the entire object into memory when possible.

Preserve:

* filename
* content type

## Delete Object

Allow deleting an object.

Require confirmation.

Support selecting multiple objects and deleting them together if straightforward to implement.

## Replace Object

Uploading a file to an existing key should ask for confirmation before overwriting it.

The PUT operation may replace the existing S3 object.

## Rename / Move Object

S3 does not provide a native rename operation.

Implement rename/move using:

```text
CopyObject
      ↓
DeleteObject
```

Only delete the original object after the copy succeeds.

Example:

```text
documents/report.pdf
```

renamed to:

```text
documents/final-report.pdf
```

should internally perform:

```text
CopyObject
documents/report.pdf
→
documents/final-report.pdf

then

DeleteObject
documents/report.pdf
```

## Copy Object

Optionally expose a "Copy" action.

Ask for the destination key.

Use `CopyObject`.

---

# Folder Operations

Since S3 folders are logical prefixes, do not introduce a complicated filesystem abstraction.

Provide a simple "Create Folder" action by creating a zero-byte object ending with `/`, for example:

```text
documents/
```

or otherwise use the simplest S3-compatible approach supported by the existing implementation.

Folder navigation should primarily be based on prefixes.

Breadcrumb example:

```text
my-bucket / documents / invoices / 2026
```

Every breadcrumb segment should be clickable.

---

# File Information

For every object display:

* filename
* full key
* size
* last modified date
* ETag when available
* content type when available

Format sizes into human-readable values:

```text
1.2 KB
4.8 MB
1.1 GB
```

---

# File Preview

Add a simple preview panel or modal.

Preview only formats that are easy and safe to display.

Initially support:

### Text

```text
.txt
.log
.md
```

### JSON

```text
.json
```

Pretty-print JSON when valid.

### Images

```text
.png
.jpg
.jpeg
.gif
.webp
.svg
```

### PDF

Allow opening or displaying the PDF using the browser if convenient.

For unsupported binary files, show metadata and provide a Download button instead.

Do not attempt to build complex editors.

---

# Search / Filter

Provide a simple search/filter box for the currently displayed directory.

Filter by object name.

This can initially be client-side filtering.

Do not implement Elasticsearch, indexing, or another search service.

---

# Sorting

Allow sorting files by:

* name
* size
* last modified

Folders should appear before files.

---

# UI Behavior

Use a clean developer-tool style interface.

Recommended layout:

```text
Header
├── application name
├── Floci endpoint
└── connection status

Sidebar
└── bucket list

Main Area
├── breadcrumb
├── toolbar
│   ├── Upload
│   ├── New Folder
│   ├── Refresh
│   └── Search
└── object table
```

Object table:

```text
Name | Size | Last Modified | Actions
```

Actions can include:

```text
Preview
Download
Rename
Copy
Delete
```

Avoid excessive card-based UI.

A table/file-browser layout is preferred.

---

# Connection Status

The application should detect whether Floci is reachable.

Display something like:

```text
Floci ● Connected
```

or:

```text
Floci ● Offline
```

If Floci is unavailable, show a useful error such as:

```text
Unable to connect to S3 at http://localhost:4566.

Make sure Floci is running.
```

Do not crash the application.

---

# Backend API

Design a small REST API.

Suggested endpoints:

```text
GET    /api/health

GET    /api/buckets
POST   /api/buckets
DELETE /api/buckets/:bucket

GET    /api/buckets/:bucket/objects?prefix=...

POST   /api/buckets/:bucket/objects
GET    /api/buckets/:bucket/objects/download?key=...
GET    /api/buckets/:bucket/objects/preview?key=...
DELETE /api/buckets/:bucket/objects?key=...

POST   /api/buckets/:bucket/objects/copy
POST   /api/buckets/:bucket/objects/move
```

The exact API structure may be adjusted if there is a cleaner design.

Important:

Do not place an S3 object key directly into a URL path such as:

```text
/objects/documents/foo/bar.txt
```

because object keys may contain arbitrary `/` characters.

Prefer passing the key as:

```text
?key=documents/foo/bar.txt
```

or in the request body.

---

# Error Handling

Return useful errors from the backend.

Use a consistent API response structure.

Example:

```json
{
  "error": {
    "code": "NoSuchBucket",
    "message": "The specified bucket does not exist"
  }
}
```

The frontend should show user-friendly error messages without hiding useful S3 error information.

Handle common cases:

* Floci offline
* bucket not found
* object not found
* bucket already exists
* bucket not empty
* upload failure
* download failure
* invalid object key

---

# Safety

This application is primarily intended for local development.

Nevertheless:

* require confirmation before destructive actions
* never silently overwrite files
* never silently recursively delete buckets
* never log file contents
* never log AWS credentials
* sanitize filenames used in `Content-Disposition`
* properly encode/decode object keys

Do not implement authentication unless the existing project already requires it.

---

# Pagination

`ListObjectsV2` may return paginated responses.

Design the backend so pagination is handled correctly using:

```text
ContinuationToken
NextContinuationToken
```

The UI may either:

1. provide "Load More", or
2. automatically retrieve the next page.

Do not assume all objects fit in one S3 response.

---

# S3 SDK Organization

Keep all S3-specific logic in a dedicated module.

For example:

```text
server/
├── config/
│   └── s3.ts
├── services/
│   └── s3.service.ts
├── routes/
│   ├── buckets.ts
│   └── objects.ts
└── index.ts
```

Do not scatter AWS SDK calls throughout route handlers.

Example responsibilities:

```text
s3.service.ts

listBuckets()
createBucket()
deleteBucket()

listObjects()
uploadObject()
getObject()
deleteObject()

copyObject()
moveObject()
```

---

# Development Environment

Provide a Docker Compose configuration for Floci if the repository does not already contain one.

Example:

```yaml
services:
  floci:
    image: floci/floci:latest
    ports:
      - "4566:4566"
    volumes:
      - ./data:/app/data
```

The web application itself does not need to run inside Docker unless doing so simplifies the existing project.

Provide:

```text
.env.example
```

with:

```env
S3_ENDPOINT=http://localhost:4566
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
```

---

# Developer Experience

Provide simple commands such as:

```bash
npm install
npm run dev
```

If frontend and backend are separate applications, provide one root command that starts both when practical.

Document how to:

1. start Floci
2. start the web application
3. create a test bucket
4. upload test data
5. access the UI

---

# Testing

Add focused tests for the important S3 service logic.

At minimum test:

* listing buckets
* listing objects
* prefix navigation
* uploading
* deleting
* rename/move behavior
* errors when Floci is unavailable

Do not spend excessive time building exhaustive tests for UI styling.

---

# Non-Goals

Do NOT implement these unless they are already trivial:

* IAM management
* AWS authentication UI
* bucket policies editor
* bucket lifecycle editor
* bucket replication
* bucket encryption configuration UI
* CloudFront
* object version browser
* S3 Select UI
* multipart upload dashboard
* production AWS account management

The initial goal is simply:

> A fast and convenient local S3 file browser for developers using Floci.

---

# Implementation Approach

Before writing code:

1. Inspect the existing repository.
2. Identify the current frontend/backend stack.
3. Reuse existing conventions whenever reasonable.
4. Check whether AWS SDK v3 is already installed.
5. Locate existing environment configuration.
6. Produce a short implementation plan.

Then implement the application incrementally.

Prioritize this order:

```text
1. Connect to Floci
2. List buckets
3. Browse objects
4. Upload
5. Download
6. Delete
7. Folder navigation
8. Rename / move
9. Preview
10. UI polish
```

Do not overengineer the solution.

After implementation:

1. run type checking
2. run tests
3. run linting if configured
4. fix discovered errors
5. verify the application works against a local Floci instance

Finally provide a summary containing:

* files created/modified
* architecture
* available features
* commands to run the application
* known limitations
