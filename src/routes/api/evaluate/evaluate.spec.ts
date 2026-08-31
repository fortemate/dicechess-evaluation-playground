// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { _createEvaluateHandler, POST } from './+server.js';
import type { ServerConfig } from '$lib/server/config.js';
import { EvaluationClient, EvaluationClientError } from '$lib/server/evaluation-client.js';

describe('POST /api/evaluate', () => {
	const testConfig: ServerConfig = {
		evaluatorOrigin: 'http://evaluator.internal:8080',
		evaluatorBearerToken: 'secret-token',
		cfAccessTeamDomain: 'https://test.cloudflareaccess.com',
		cfAccessAud: 'test-aud',
		allowDevAuthBypass: true,
		maxRequestBodyBytes: 1024,
		evaluatorTimeoutMs: 1000,
		maxConcurrentEvaluations: 4,
		nodeEnv: 'test',
	};

	const sampleUpstreamResponse = {
		fen: '8/8/8/8/8/8/8/K6k b - -',
		sideToMove: 'b' as const,
		winProbability: 0.48,
		provenance: {
			engineVersion: '0.2.0',
			rulesetVersion: 'standard-dicechess-v1',
			modelId: 'kcp-v1',
			modelSha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
			featureSchema: 'schema-v1',
			evaluationProfile: 'standard-kcp',
			algorithm: 'onnx',
			searchParameters: {},
		},
	};

	function createMockEvent(options: {
		body?: string;
		headers?: Record<string, string>;
		clientAddress?: string;
		throwClientAddress?: boolean;
		throwBodyRead?: boolean;
		nullBody?: boolean;
		throwText?: boolean;
	}): RequestEvent {
		const headers = new Headers(options.headers ?? {});

		let request: Request;
		if (options.nullBody) {
			request = new Request('http://127.0.0.1:3000/api/evaluate', {
				method: 'POST',
				headers,
			});
			if (options.throwText) {
				vi.spyOn(request, 'text').mockRejectedValue(new Error('Stream closed'));
			}
		} else if (options.throwBodyRead) {
			const stream = new ReadableStream({
				pull() {
					throw new Error('Stream read error');
				},
			});
			request = new Request('http://127.0.0.1:3000/api/evaluate', {
				method: 'POST',
				headers,
				body: stream,
				// @ts-expect-error duplex is required in Node fetch when body is a stream
				duplex: 'half',
			});
		} else {
			request = new Request('http://127.0.0.1:3000/api/evaluate', {
				method: 'POST',
				headers,
				body: options.body,
			});
		}

		return {
			request,
			getClientAddress: () => {
				if (options.throwClientAddress) {
					throw new Error('Not available');
				}
				return options.clientAddress ?? '127.0.0.1';
			},
		} as unknown as RequestEvent;
	}

	it('successfully evaluates a valid position with full provenance and latency', async () => {
		const mockClient = {
			evaluatePosition: vi.fn().mockResolvedValue(sampleUpstreamResponse),
		} as unknown as EvaluationClient;

		const handler = _createEvaluateHandler({
			config: testConfig,
			client: mockClient,
		});

		const event = createMockEvent({
			body: JSON.stringify({
				fen: '8/8/8/8/8/8/8/K6k b - - 0 1',
				profile: 'standard-kcp',
			}),
		});

		const response = await handler(event);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/json');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('x-correlation-Id')).toBeDefined();

		const json = await response.json();
		expect(json).toMatchObject({
			fen: '8/8/8/8/8/8/8/K6k b - -',
			perspective: 'b',
			probability: 0.48,
			evaluatorVersion: '0.2.0',
			modelId: 'kcp-v1',
			modelSha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
		});
		expect(typeof json.latencyMs).toBe('number');
		expect(typeof json.correlationId).toBe('string');
	});

	it('rejects oversized requests based on Content-Length header or ignores NaN content-length', async () => {
		const handler = _createEvaluateHandler({ config: testConfig });
		const event = createMockEvent({
			headers: { 'content-length': '2048' },
			body: JSON.stringify({ fen: '8/8/8/8/8/8/8/K6k w - -' }),
		});

		const response = await handler(event);
		expect(response.status).toBe(413);
		await expect(response.json()).resolves.toEqual({
			code: 'PAYLOAD_TOO_LARGE',
			error: 'Request body exceeds 1024 byte limit',
		});

		const eventNaN = createMockEvent({
			headers: { 'content-length': 'not-a-number' },
			body: JSON.stringify({ fen: '8/8/8/8/8/8/8/K6k w - -' }),
		});
		const mockClient = {
			evaluatePosition: vi.fn().mockResolvedValue(sampleUpstreamResponse),
		} as unknown as EvaluationClient;
		const handlerNaN = _createEvaluateHandler({ config: testConfig, client: mockClient });
		const responseNaN = await handlerNaN(eventNaN);
		expect(responseNaN.status).toBe(200);
	});

	it('rejects oversized requests based on streaming body byte length', async () => {
		const handler = _createEvaluateHandler({ config: testConfig });
		const largePayload = JSON.stringify({
			fen: '8/8/8/8/8/8/8/K6k w - -',
			padding: 'x'.repeat(2000),
		});
		const event = createMockEvent({
			body: largePayload,
		});

		const response = await handler(event);
		expect(response.status).toBe(413);
		await expect(response.json()).resolves.toEqual({
			code: 'PAYLOAD_TOO_LARGE',
			error: 'Request body exceeds 1024 byte limit',
		});
	});

	it('handles non-stream request body fallback and large payload check', async () => {
		const mockClient = {
			evaluatePosition: vi.fn().mockResolvedValue(sampleUpstreamResponse),
		} as unknown as EvaluationClient;
		const handler = _createEvaluateHandler({ config: testConfig, client: mockClient });

		const nullBodyEvent = createMockEvent({ nullBody: true });
		const nullBodyResponse = await handler(nullBodyEvent);
		expect(nullBodyResponse.status).toBe(422);

		const largeTextEvent = createMockEvent({ nullBody: true });
		vi.spyOn(largeTextEvent.request, 'text').mockResolvedValue('x'.repeat(2000));
		const largeTextResponse = await handler(largeTextEvent);
		expect(largeTextResponse.status).toBe(413);

		const throwTextEvent = createMockEvent({ nullBody: true, throwText: true });
		const throwTextResponse = await handler(throwTextEvent);
		expect(throwTextResponse.status).toBe(400);
	});

	it('fails closed when authentication fails', async () => {
		const strictConfig: ServerConfig = {
			...testConfig,
			allowDevAuthBypass: false,
		};
		const handler = _createEvaluateHandler({ config: strictConfig });
		const event = createMockEvent({
			body: JSON.stringify({ fen: '8/8/8/8/8/8/8/K6k w - -' }),
		});

		const response = await handler(event);
		expect(response.status).toBe(401);
		const json = await response.json();
		expect(json).toEqual({
			code: 'AUTHENTICATION_FAILURE',
			error: 'Invalid or missing authentication credentials',
		});
	});

	it('handles read request body stream failure', async () => {
		const handler = _createEvaluateHandler({ config: testConfig });
		const event = createMockEvent({ throwBodyRead: true });

		const response = await handler(event);
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			code: 'INVALID_REQUEST',
			error: 'Failed to read request body',
		});
	});

	it('handles malformed JSON body', async () => {
		const handler = _createEvaluateHandler({ config: testConfig });
		const event = createMockEvent({ body: 'not-json-content' });

		const response = await handler(event);
		expect(response.status).toBe(422);
		await expect(response.json()).resolves.toEqual({
			code: 'INVALID_REQUEST',
			error: 'Invalid JSON request body',
		});
	});

	it('rejects non-object JSON body payloads (arrays, primitives, null)', async () => {
		const handler = _createEvaluateHandler({ config: testConfig });

		const eventArray = createMockEvent({ body: JSON.stringify(['fen-item']) });
		const responseArray = await handler(eventArray);
		expect(responseArray.status).toBe(422);
		await expect(responseArray.json()).resolves.toEqual({
			code: 'INVALID_REQUEST',
			error: 'Request body must be a JSON object',
		});

		const eventNull = createMockEvent({ body: 'null' });
		const responseNull = await handler(eventNull);
		expect(responseNull.status).toBe(422);
		await expect(responseNull.json()).resolves.toEqual({
			code: 'INVALID_REQUEST',
			error: 'Request body must be a JSON object',
		});

		const eventNumber = createMockEvent({ body: '12345' });
		const responseNumber = await handler(eventNumber);
		expect(responseNumber.status).toBe(422);
		await expect(responseNumber.json()).resolves.toEqual({
			code: 'INVALID_REQUEST',
			error: 'Request body must be a JSON object',
		});
	});

	it('rejects missing or empty fen field', async () => {
		const handler = _createEvaluateHandler({ config: testConfig });
		const eventMissingFen = createMockEvent({ body: JSON.stringify({}) });

		const response = await handler(eventMissingFen);
		expect(response.status).toBe(422);
		await expect(response.json()).resolves.toEqual({
			code: 'INVALID_REQUEST',
			error: 'Field "fen" is required and must be a non-empty string',
		});

		const eventBlankFen = createMockEvent({ body: JSON.stringify({ fen: '   ' }) });
		const responseBlank = await handler(eventBlankFen);
		expect(responseBlank.status).toBe(422);
		await expect(responseBlank.json()).resolves.toEqual({
			code: 'INVALID_REQUEST',
			error: 'Field "fen" is required and must be a non-empty string',
		});
	});

	it('rejects invalid non-string profile field', async () => {
		const handler = _createEvaluateHandler({ config: testConfig });
		const event = createMockEvent({
			body: JSON.stringify({
				fen: '8/8/8/8/8/8/8/K6k w - -',
				profile: 12345,
			}),
		});

		const response = await handler(event);
		expect(response.status).toBe(422);
		await expect(response.json()).resolves.toEqual({
			code: 'INVALID_REQUEST',
			error: 'Field "profile" must be a string if provided',
		});
	});

	it('rejects invalid FEN syntax with INVALID_FEN error code', async () => {
		const handler = _createEvaluateHandler({ config: testConfig });
		const event = createMockEvent({
			body: JSON.stringify({
				fen: 'invalid-fen-string',
			}),
		});

		const response = await handler(event);
		expect(response.status).toBe(422);
		const json = await response.json();
		expect(json.code).toBe('INVALID_FEN');
		expect(json.error).toContain('Invalid FEN');
	});

	it('maps upstream EvaluationClientError status codes and bodies', async () => {
		const mockClientBusy = {
			evaluatePosition: vi
				.fn()
				.mockRejectedValue(new EvaluationClientError(429, 'ANALYSIS_BUSY', 'Too many analyses')),
		} as unknown as EvaluationClient;

		const handlerBusy = _createEvaluateHandler({
			config: testConfig,
			client: mockClientBusy,
		});

		const responseBusy = await handlerBusy(
			createMockEvent({
				body: JSON.stringify({ fen: '8/8/8/8/8/8/8/K6k w - -' }),
			}),
		);
		expect(responseBusy.status).toBe(429);
		await expect(responseBusy.json()).resolves.toEqual({
			code: 'ANALYSIS_BUSY',
			error: 'Too many analyses',
		});

		const mockClientInternalWithId = {
			evaluatePosition: vi
				.fn()
				.mockRejectedValue(
					new EvaluationClientError(
						500,
						'INTERNAL_FAILURE',
						'An internal error occurred.',
						'custom-corr-id',
					),
				),
		} as unknown as EvaluationClient;

		const handlerInternalWithId = _createEvaluateHandler({
			config: testConfig,
			client: mockClientInternalWithId,
		});

		const responseInternalWithId = await handlerInternalWithId(
			createMockEvent({
				body: JSON.stringify({ fen: '8/8/8/8/8/8/8/K6k w - -' }),
			}),
		);
		expect(responseInternalWithId.status).toBe(500);
		await expect(responseInternalWithId.json()).resolves.toEqual({
			code: 'INTERNAL_FAILURE',
			error: 'An internal error occurred.',
			correlationId: 'custom-corr-id',
		});

		const mockClientInternalWithoutId = {
			evaluatePosition: vi
				.fn()
				.mockRejectedValue(
					new EvaluationClientError(500, 'INTERNAL_FAILURE', 'An internal error occurred.'),
				),
		} as unknown as EvaluationClient;

		const handlerInternalWithoutId = _createEvaluateHandler({
			config: testConfig,
			client: mockClientInternalWithoutId,
		});

		const responseInternalWithoutId = await handlerInternalWithoutId(
			createMockEvent({
				body: JSON.stringify({ fen: '8/8/8/8/8/8/8/K6k w - -' }),
			}),
		);
		expect(responseInternalWithoutId.status).toBe(500);
		const json = await responseInternalWithoutId.json();
		expect(json.code).toBe('INTERNAL_FAILURE');
		expect(json.correlationId).toBeDefined();
	});

	it('handles unexpected thrown non-EvaluationClientError exceptions as 500 INTERNAL_FAILURE', async () => {
		const mockClientUnexpected = {
			evaluatePosition: vi.fn().mockRejectedValue(new Error('Unexpected crash')),
		} as unknown as EvaluationClient;

		const handler = _createEvaluateHandler({
			config: testConfig,
			client: mockClientUnexpected,
		});

		const response = await handler(
			createMockEvent({
				body: JSON.stringify({ fen: '8/8/8/8/8/8/8/K6k w - -' }),
			}),
		);
		expect(response.status).toBe(500);
		const json = await response.json();
		expect(json.code).toBe('INTERNAL_FAILURE');
		expect(json.error).toBe('An internal error occurred.');
		expect(json.correlationId).toBeDefined();
	});

	it('rejects dev bypass when getClientAddress throws and client address is undefined', async () => {
		const handler = _createEvaluateHandler({
			config: testConfig,
		});

		const event = createMockEvent({
			throwClientAddress: true,
			headers: {
				'x-forwarded-for': '127.0.0.1',
			},
			body: JSON.stringify({ fen: '8/8/8/8/8/8/8/K6k w - -' }),
		});

		const response = await handler(event);
		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toEqual({
			code: 'AUTHENTICATION_FAILURE',
			error: 'Invalid or missing authentication credentials',
		});
	});

	it('handles configuration load failures gracefully as 500 INTERNAL_FAILURE', async () => {
		const originalOrigin = process.env.EVALUATOR_ORIGIN;
		const originalNodeEnv = process.env.NODE_ENV;
		try {
			delete process.env.EVALUATOR_ORIGIN;
			process.env.NODE_ENV = 'production';

			const handler = _createEvaluateHandler();
			const event = createMockEvent({
				body: JSON.stringify({ fen: '8/8/8/8/8/8/8/K6k w - -' }),
			});

			const response = await handler(event);
			expect(response.status).toBe(500);
			const json = await response.json();
			expect(json.code).toBe('INTERNAL_FAILURE');
			expect(json.correlationId).toBeDefined();
		} finally {
			if (originalOrigin !== undefined) process.env.EVALUATOR_ORIGIN = originalOrigin;
			if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
		}
	});

	it('invokes exported POST handler with default dependencies', async () => {
		process.env.ALLOW_DEV_AUTH_BYPASS = 'true';
		process.env.EVALUATOR_ORIGIN = 'http://127.0.0.1:8080';
		process.env.EVALUATOR_BEARER_TOKEN = 'test-token';

		const event = createMockEvent({
			body: JSON.stringify({ fen: 'invalid-fen' }),
		});

		const response = await POST(event);
		expect(response.status).toBe(422);
	});
});
