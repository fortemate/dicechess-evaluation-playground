// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

import type { RequestEvent, RequestHandler } from '@sveltejs/kit';
import { canonicalizeFen, validateFen } from '$lib/position/fen.js';
import type {
	EvaluationApiError,
	PositionEvaluationRequest,
	PositionEvaluationResponse,
} from '$lib/contracts/evaluation.js';
import { loadServerConfig, type ServerConfig } from '$lib/server/config.js';
import { CloudflareAccessValidator } from '$lib/server/cloudflare-access.js';
import { EvaluationClient, EvaluationClientError } from '$lib/server/evaluation-client.js';

function jsonResponse(data: unknown, status = 200, correlationId?: string): Response {
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		'cache-control': 'no-store',
	};
	if (correlationId) {
		headers['x-correlation-id'] = correlationId;
	}
	return new Response(JSON.stringify(data), {
		status,
		headers,
	});
}

function errorResponse(status: number, error: EvaluationApiError): Response {
	return jsonResponse(error, status, error.correlationId);
}

async function readBoundedRequestBody(
	request: Request,
	maxBytes: number,
): Promise<
	{ ok: true; text: string } | { ok: false; error: 'PAYLOAD_TOO_LARGE' | 'INVALID_REQUEST' }
> {
	if (!request.body) {
		try {
			const text = await request.text();
			const byteLength = new TextEncoder().encode(text).length;
			if (byteLength > maxBytes) {
				return { ok: false, error: 'PAYLOAD_TOO_LARGE' };
			}
			return { ok: true, text };
		} catch {
			return { ok: false, error: 'INVALID_REQUEST' };
		}
	}

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			totalBytes += value.byteLength;
			if (totalBytes > maxBytes) {
				await reader.cancel();
				return { ok: false, error: 'PAYLOAD_TOO_LARGE' };
			}
			chunks.push(value);
		}
	} catch {
		return { ok: false, error: 'INVALID_REQUEST' };
	}

	const combined = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		combined.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { ok: true, text: new TextDecoder().decode(combined) };
}

export interface _EvaluateHandlerDependencies {
	config?: ServerConfig;
	validator?: CloudflareAccessValidator;
	client?: EvaluationClient;
}

export function _createEvaluateHandler(deps: _EvaluateHandlerDependencies = {}): RequestHandler {
	let cachedConfig = deps.config;
	let cachedValidator = deps.validator;
	let cachedClient = deps.client;

	return async (event: RequestEvent): Promise<Response> => {
		const correlationId = crypto.randomUUID();

		try {
			if (!cachedConfig) {
				cachedConfig = loadServerConfig();
			}
			if (!cachedValidator) {
				cachedValidator = new CloudflareAccessValidator(cachedConfig);
			}
			if (!cachedClient) {
				cachedClient = new EvaluationClient(cachedConfig);
			}
		} catch {
			return errorResponse(500, {
				code: 'INTERNAL_FAILURE',
				error: 'An internal error occurred.',
				correlationId,
			});
		}

		const config = cachedConfig;
		const validator = cachedValidator;
		const client = cachedClient;

		// 1. Check Content-Length header size bound
		const contentLengthHeader = event.request.headers.get('content-length');
		if (contentLengthHeader) {
			const parsedLength = parseInt(contentLengthHeader, 10);
			if (!Number.isNaN(parsedLength) && parsedLength > config.maxRequestBodyBytes) {
				return errorResponse(413, {
					code: 'PAYLOAD_TOO_LARGE',
					error: `Request body exceeds ${config.maxRequestBodyBytes} byte limit`,
				});
			}
		}

		// 2. Validate Cloudflare Access authentication
		let clientAddress: string | undefined;
		try {
			clientAddress = event.getClientAddress();
		} catch {
			clientAddress = undefined;
		}

		const authResult = await validator.validateRequest(event.request.headers, clientAddress);
		if (!authResult.authenticated) {
			return errorResponse(401, {
				code: 'AUTHENTICATION_FAILURE',
				error: 'Invalid or missing authentication credentials',
			});
		}

		// 3. Read and stream-bound body payload
		const readResult = await readBoundedRequestBody(event.request, config.maxRequestBodyBytes);
		if (!readResult.ok) {
			if (readResult.error === 'PAYLOAD_TOO_LARGE') {
				return errorResponse(413, {
					code: 'PAYLOAD_TOO_LARGE',
					error: `Request body exceeds ${config.maxRequestBodyBytes} byte limit`,
				});
			}
			return errorResponse(400, {
				code: 'INVALID_REQUEST',
				error: 'Failed to read request body',
			});
		}

		const text = readResult.text;

		// 4. Parse JSON
		let rawBody: unknown;
		try {
			rawBody = JSON.parse(text);
		} catch {
			return errorResponse(422, {
				code: 'INVALID_REQUEST',
				error: 'Invalid JSON request body',
			});
		}

		if (typeof rawBody !== 'object' || rawBody === null || Array.isArray(rawBody)) {
			return errorResponse(422, {
				code: 'INVALID_REQUEST',
				error: 'Request body must be a JSON object',
			});
		}

		const requestBody = rawBody as Partial<PositionEvaluationRequest>;

		if (typeof requestBody.fen !== 'string' || requestBody.fen.trim() === '') {
			return errorResponse(422, {
				code: 'INVALID_REQUEST',
				error: 'Field "fen" is required and must be a non-empty string',
			});
		}

		if (requestBody.profile !== undefined && typeof requestBody.profile !== 'string') {
			return errorResponse(422, {
				code: 'INVALID_REQUEST',
				error: 'Field "profile" must be a string if provided',
			});
		}

		// 5. Validate and canonicalize FEN
		const fenValidation = validateFen(requestBody.fen);
		if (!fenValidation.valid) {
			return errorResponse(422, {
				code: 'INVALID_FEN',
				error: fenValidation.error!,
			});
		}

		const canonicalFen = canonicalizeFen(requestBody.fen);

		// 6. Forward to upstream evaluator and measure latency
		const startTime = performance.now();
		try {
			const upstreamResponse = await client.evaluatePosition({
				fen: canonicalFen,
				profile: requestBody.profile,
			});

			const latencyMs = Math.max(0, Math.round(performance.now() - startTime));

			const responsePayload: PositionEvaluationResponse = {
				fen: canonicalFen,
				perspective: upstreamResponse.sideToMove,
				probability: upstreamResponse.winProbability,
				latencyMs,
				correlationId,
				evaluatorVersion: upstreamResponse.provenance.engineVersion,
				modelId: upstreamResponse.provenance.modelId,
				modelSha256: upstreamResponse.provenance.modelSha256,
			};

			return jsonResponse(responsePayload, 200, correlationId);
		} catch (error) {
			if (error instanceof EvaluationClientError) {
				return errorResponse(error.status, {
					code: error.code,
					error: error.message,
					correlationId: error.correlationId ?? (error.status >= 500 ? correlationId : undefined),
				});
			}

			return errorResponse(500, {
				code: 'INTERNAL_FAILURE',
				error: 'An internal error occurred.',
				correlationId,
			});
		}
	};
}

export const POST: RequestHandler = _createEvaluateHandler();
