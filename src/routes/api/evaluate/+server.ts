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
import {
	EvaluationClient,
	EvaluationClientError,
	getPublicEvaluationErrorMessage,
} from '$lib/server/evaluation-client.js';

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

export interface EvaluateHandlerDependencies {
	config?: ServerConfig;
	validator?: CloudflareAccessValidator;
	client?: EvaluationClient;
}

interface ParsedEvaluationRequest {
	fen: string;
	profile?: string;
}

function oversizedContentLengthResponse(request: Request, maxBytes: number): Response | undefined {
	const contentLengthHeader = request.headers.get('content-length');
	if (!contentLengthHeader) return undefined;
	const parsedLength = Number.parseInt(contentLengthHeader, 10);
	if (Number.isNaN(parsedLength) || parsedLength <= maxBytes) return undefined;
	return errorResponse(413, {
		code: 'PAYLOAD_TOO_LARGE',
		error: `Request body exceeds ${maxBytes} byte limit`,
	});
}

function getClientAddress(event: RequestEvent): string | undefined {
	try {
		return event.getClientAddress();
	} catch {
		return undefined;
	}
}

async function authenticationFailureResponse(
	event: RequestEvent,
	validator: CloudflareAccessValidator,
): Promise<Response | undefined> {
	const authResult = await validator.validateRequest(
		event.request.headers,
		getClientAddress(event),
	);
	if (authResult.authenticated) return undefined;
	return errorResponse(401, {
		code: 'AUTHENTICATION_FAILURE',
		error: getPublicEvaluationErrorMessage('AUTHENTICATION_FAILURE'),
	});
}

async function parseEvaluationRequest(
	request: Request,
	maxBytes: number,
): Promise<ParsedEvaluationRequest | Response> {
	const readResult = await readBoundedRequestBody(request, maxBytes);
	if (!readResult.ok) {
		return readResult.error === 'PAYLOAD_TOO_LARGE'
			? errorResponse(413, {
					code: 'PAYLOAD_TOO_LARGE',
					error: `Request body exceeds ${maxBytes} byte limit`,
				})
			: errorResponse(400, {
					code: 'INVALID_REQUEST',
					error: 'Failed to read request body',
				});
	}

	let rawBody: unknown;
	try {
		rawBody = JSON.parse(readResult.text);
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
			error: 'Field "profile" must be a non-empty string if provided',
		});
	}
	const profile = requestBody.profile?.trim();
	if (profile === '') {
		return errorResponse(422, {
			code: 'INVALID_REQUEST',
			error: 'Field "profile" must be a non-empty string if provided',
		});
	}

	const fenValidation = validateFen(requestBody.fen);
	if (!fenValidation.valid) {
		return errorResponse(422, {
			code: 'INVALID_FEN',
			error: fenValidation.error!,
		});
	}

	return { fen: canonicalizeFen(requestBody.fen), profile };
}

async function evaluateRequest(
	client: EvaluationClient,
	request: ParsedEvaluationRequest,
	correlationId: string,
): Promise<Response> {
	const startTime = performance.now();
	try {
		const upstreamResponse = await client.evaluatePosition(request);
		const responsePayload: PositionEvaluationResponse = {
			fen: request.fen,
			perspective: upstreamResponse.sideToMove,
			probability: upstreamResponse.winProbability,
			latencyMs: Math.max(0, Math.round(performance.now() - startTime)),
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
				error: getPublicEvaluationErrorMessage(error.code),
				correlationId: error.status >= 500 ? correlationId : undefined,
			});
		}
		return errorResponse(500, {
			code: 'INTERNAL_FAILURE',
			error: getPublicEvaluationErrorMessage('INTERNAL_FAILURE'),
			correlationId,
		});
	}
}

export function _createEvaluateHandler(deps: EvaluateHandlerDependencies = {}): RequestHandler {
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

		const sizeError = oversizedContentLengthResponse(event.request, config.maxRequestBodyBytes);
		if (sizeError) return sizeError;

		const authError = await authenticationFailureResponse(event, validator);
		if (authError) return authError;

		const request = await parseEvaluationRequest(event.request, config.maxRequestBodyBytes);
		if (request instanceof Response) return request;
		return evaluateRequest(client, request, correlationId);
	};
}

export const POST: RequestHandler = _createEvaluateHandler();
