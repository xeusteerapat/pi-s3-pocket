import pino from 'pino';
import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';

export const logger = pino({
	level: process.env.LOG_LEVEL ?? 'info',
	timestamp: pino.stdTimeFunctions.isoTime,
	redact: {
		paths: [
			'req.headers.authorization',
			'req.headers.cookie',
			"res.headers['set-cookie']",
		],
		censor: '[REDACTED]',
	},
});

export const httpLogger = pinoHttp({
	logger,
	genReqId(req, res) {
		const requestId = req.headers['x-request-id']?.toString() || randomUUID();
		res.setHeader('X-Request-Id', requestId);
		return requestId;
	},
	customLogLevel(_req, res, error) {
		if (error || res.statusCode >= 500) return 'error';
		if (res.statusCode >= 400) return 'warn';
		return 'info';
	},
	customSuccessMessage(req, res) {
		return `${req.method} ${req.url} completed with ${res.statusCode}`;
	},
	customErrorMessage(req, res) {
		return `${req.method} ${req.url} failed with ${res.statusCode}`;
	},
});
