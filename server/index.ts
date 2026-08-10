import "dotenv/config";
import express, { type ErrorRequestHandler } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { s3Client, s3Endpoint } from "./config/s3";
import { createApiRouter } from "./routes/api";
import { S3Service } from "./services/s3.service";

const app = express();
const port = Number(process.env.PORT ?? 3001);
const service = new S3Service(s3Client);

app.use(express.json({ limit: "1mb" }));
app.use("/api", createApiRouter(service, s3Endpoint));

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const status = error.status ?? error.$metadata?.httpStatusCode ?? 500;
  const code = error.code ?? error.name ?? "InternalError";
  const message = error.message ?? "An unexpected error occurred";
  if (status >= 500) console.error(`[${code}] ${message}`);
  res.status(status).json({ error: { code, message, conflicts: error.conflicts } });
};
app.use(errorHandler);

if (process.env.NODE_ENV === "production") {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
  app.use(express.static(root));
  app.use((_req, res) => res.sendFile(path.join(root, "index.html")));
}

app.listen(port, () => console.log(`Local S3 API listening at http://localhost:${port}`));
