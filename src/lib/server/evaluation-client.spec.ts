// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import { EvaluationClient, type UpstreamPositionEvalResponse } from './evaluation-client.js';
import type { ServerConfig } from './config.js';

describe('EvaluationClient', () => {
	const testConfig: ServerConfig = {
		evaluatorOrigin: 'http://evaluator.internal:8080',
		evaluatorBearerToken: 'secret-eval-bearer-token',
		cfAccessTeamDomain: 'https://test-team.cloudflareaccess.com',
		cfAccessAud: 'test-aud',
		allowDevAuthBypass: false,
		maxRequestBodyBytes: 65536,
		evaluatorTimeoutMs: 1000,
		maxConcurrentEvaluations: 2,
		nodeEnv: 'test',
	};

	const sampleSuccessResponse: UpstreamPositionEvalResponse = {
		fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
		sideToMove: 'w',
		winProbability: 0.53,
		provenance: {
			engineVersion: '0.1.0',
			rulesetVersion: 'standard-dicechess-v1',
			modelId: 'standard-kcp',
			modelSha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
			featureSchema: 'standard-kcp-v1',
			evaluationProfile: 'standard-kcp',
			algorithm: 'kcp-onnx',
			searchParameters: {},
		},
	};

	it('evaluates position successfully and sends Authorization header and payload', async () => {
		const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
			expect(url.toString()).toBe('http://evaluator.internal:8080/api/v1/evaluate/position');
			expect(init?.method).toBe('POST');
			expect(init?.headers).toEqual({
				Authorization: 'Bearer secret-eval-bearer-token',
				'Content-Type': 'application/json',
				Accept: 'application/json',
			});
			expect(init?.body).toBe(
				JSON.stringify({
					fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
					profile: 'standard-kcp',
				}),
			);

			return new Response(JSON.stringify(sampleSuccessResponse), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		});

		const client = new EvaluationClient(testConfig, {
			fetchFn: mockFetch as unknown as typeof fetch,
		});
		const result = await client.evaluatePosition({
			fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
			profile: 'standard-kcp',
		});

		expect(result).toEqual(sampleSuccessResponse);
		expect(client.activeEvaluations).toBe(0);
	});

	it('uses default fetch if fetchFn option is not supplied', () => {
		const client = new EvaluationClient(testConfig);
		expect(client.activeEvaluations).toBe(0);
	});

	it('rejects with ANALYSIS_BUSY when in-process concurrency limit is exceeded', async () => {
		let resolveCall1: () => void;
		const call1Promise = new Promise<void>((resolve) => {
			resolveCall1 = resolve;
		});

		const mockFetch = vi.fn(async () => {
			await call1Promise;
			return new Response(JSON.stringify(sampleSuccessResponse), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		});

		const client = new EvaluationClient(testConfig, {
			fetchFn: mockFetch as unknown as typeof fetch,
		});

		// Start two concurrent evaluations (max is 2)
		const p1 = client.evaluatePosition({ fen: sampleSuccessResponse.fen });
		const p2 = client.evaluatePosition({ fen: sampleSuccessResponse.fen });

		// Third concurrent evaluation must fail with 429 ANALYSIS_BUSY immediately
		await expect(client.evaluatePosition({ fen: 'fen3' })).rejects.toThrowError(
			expect.objectContaining({
				status: 429,
				code: 'ANALYSIS_BUSY',
			}),
		);

		resolveCall1!();
		await Promise.all([p1, p2]);
		expect(client.activeEvaluations).toBe(0);
	});

	it('validates 200 success response payload structure and rejects malformed payloads', async () => {
		const clientWithMock = (body: unknown, status = 200, throwsJson = false) => {
			const mockFetch = vi.fn(async () => {
				if (throwsJson) {
					return {
						ok: true,
						status,
						json: async () => {
							throw new Error('Malformed JSON text');
						},
					} as unknown as Response;
				}
				return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
					status,
					headers: { 'Content-Type': 'application/json' },
				});
			});
			return new EvaluationClient(testConfig, { fetchFn: mockFetch as unknown as typeof fetch });
		};

		// 1. Non-JSON text on 200
		await expect(
			clientWithMock(null, 200, true).evaluatePosition({ fen: 'fen' }),
		).rejects.toThrowError(expect.objectContaining({ status: 500, code: 'INTERNAL_FAILURE' }));

		// 2. Non-object payload (array, primitive, null)
		await expect(
			clientWithMock(['not-object']).evaluatePosition({ fen: 'fen' }),
		).rejects.toThrowError(expect.objectContaining({ status: 500, code: 'INTERNAL_FAILURE' }));
		await expect(clientWithMock(null).evaluatePosition({ fen: 'fen' })).rejects.toThrowError(
			expect.objectContaining({ status: 500, code: 'INTERNAL_FAILURE' }),
		);

		// 3. Missing or invalid fen
		await expect(
			clientWithMock({ ...sampleSuccessResponse, fen: 123 }).evaluatePosition({ fen: 'fen' }),
		).rejects.toThrowError(expect.objectContaining({ status: 500, code: 'INTERNAL_FAILURE' }));
		await expect(
			clientWithMock({ ...sampleSuccessResponse, fen: '   ' }).evaluatePosition({ fen: 'fen' }),
		).rejects.toThrowError(expect.objectContaining({ status: 500, code: 'INTERNAL_FAILURE' }));

		// 4. Invalid sideToMove
		await expect(
			clientWithMock({ ...sampleSuccessResponse, sideToMove: 'x' }).evaluatePosition({
				fen: 'fen',
			}),
		).rejects.toThrowError(expect.objectContaining({ status: 500, code: 'INTERNAL_FAILURE' }));

		// 5. Invalid winProbability (out of bounds, string, NaN)
		await expect(
			clientWithMock({ ...sampleSuccessResponse, winProbability: 1.5 }).evaluatePosition({
				fen: 'fen',
			}),
		).rejects.toThrowError(expect.objectContaining({ status: 500, code: 'INTERNAL_FAILURE' }));
		await expect(
			clientWithMock({ ...sampleSuccessResponse, winProbability: -0.1 }).evaluatePosition({
				fen: 'fen',
			}),
		).rejects.toThrowError(expect.objectContaining({ status: 500, code: 'INTERNAL_FAILURE' }));
		await expect(
			clientWithMock({ ...sampleSuccessResponse, winProbability: '0.5' }).evaluatePosition({
				fen: 'fen',
			}),
		).rejects.toThrowError(expect.objectContaining({ status: 500, code: 'INTERNAL_FAILURE' }));

		// 6. Missing provenance or non-object provenance
		await expect(
			clientWithMock({ ...sampleSuccessResponse, provenance: null }).evaluatePosition({
				fen: 'fen',
			}),
		).rejects.toThrowError(expect.objectContaining({ status: 500, code: 'INTERNAL_FAILURE' }));

		// 7. Malformed provenance string fields
		await expect(
			clientWithMock({
				...sampleSuccessResponse,
				provenance: { ...sampleSuccessResponse.provenance, engineVersion: 123 },
			}).evaluatePosition({ fen: 'fen' }),
		).rejects.toThrowError(expect.objectContaining({ status: 500, code: 'INTERNAL_FAILURE' }));

		// 8. Invalid modelSha256
		await expect(
			clientWithMock({
				...sampleSuccessResponse,
				provenance: { ...sampleSuccessResponse.provenance, modelSha256: 'short-sha' },
			}).evaluatePosition({ fen: 'fen' }),
		).rejects.toThrowError(expect.objectContaining({ status: 500, code: 'INTERNAL_FAILURE' }));

		// 9. A structurally valid response must still belong to the requested position.
		await expect(
			clientWithMock({ ...sampleSuccessResponse, fen: '8/8/8/8/8/8/8/K6k w - -' }).evaluatePosition(
				{ fen: sampleSuccessResponse.fen },
			),
		).rejects.toThrowError(expect.objectContaining({ status: 500, code: 'INTERNAL_FAILURE' }));
		await expect(
			clientWithMock({ ...sampleSuccessResponse, sideToMove: 'b' }).evaluatePosition({
				fen: sampleSuccessResponse.fen,
			}),
		).rejects.toThrowError(expect.objectContaining({ status: 500, code: 'INTERNAL_FAILURE' }));
	});

	it('maps upstream 422 errors to INVALID_FEN or INVALID_PROFILE with custom or default messages', async () => {
		const mockFetchFenError = vi.fn(async () => {
			return new Response(
				JSON.stringify({ code: 'INVALID_FEN', error: 'Invalid FEN: malformed rank' }),
				{
					status: 422,
				},
			);
		});

		const clientFen = new EvaluationClient(testConfig, {
			fetchFn: mockFetchFenError as unknown as typeof fetch,
		});
		await expect(clientFen.evaluatePosition({ fen: 'bad-fen' })).rejects.toThrowError(
			expect.objectContaining({
				status: 422,
				code: 'INVALID_FEN',
				message: 'Invalid FEN',
			}),
		);

		const mockFetchDefaultFenMsg = vi.fn(async () => {
			return new Response(JSON.stringify({ code: 'INVALID_FEN' }), {
				status: 422,
			});
		});
		const clientDefaultFen = new EvaluationClient(testConfig, {
			fetchFn: mockFetchDefaultFenMsg as unknown as typeof fetch,
		});
		await expect(clientDefaultFen.evaluatePosition({ fen: 'bad-fen' })).rejects.toThrowError(
			expect.objectContaining({
				status: 422,
				code: 'INVALID_FEN',
				message: 'Invalid FEN',
			}),
		);

		const mockFetchProfileError = vi.fn(async () => {
			return new Response(
				JSON.stringify({ code: 'INVALID_PROFILE', error: 'Unknown profile: test-profile' }),
				{ status: 422 },
			);
		});

		const clientProfile = new EvaluationClient(testConfig, {
			fetchFn: mockFetchProfileError as unknown as typeof fetch,
		});
		await expect(
			clientProfile.evaluatePosition({ fen: 'good-fen', profile: 'test-profile' }),
		).rejects.toThrowError(
			expect.objectContaining({
				status: 422,
				code: 'INVALID_PROFILE',
				message: 'Invalid evaluation profile',
			}),
		);

		const mockFetchDefaultProfileMsg = vi.fn(async () => {
			return new Response(JSON.stringify({ code: 'INVALID_PROFILE' }), { status: 422 });
		});
		const clientDefaultProfile = new EvaluationClient(testConfig, {
			fetchFn: mockFetchDefaultProfileMsg as unknown as typeof fetch,
		});
		await expect(
			clientDefaultProfile.evaluatePosition({ fen: 'good-fen', profile: 'test-profile' }),
		).rejects.toThrowError(
			expect.objectContaining({
				status: 422,
				code: 'INVALID_PROFILE',
				message: 'Invalid evaluation profile',
			}),
		);
	});

	it('maps upstream 429 and 503 errors accurately with custom and default messages', async () => {
		const mockFetch429 = vi.fn(async () => {
			return new Response(JSON.stringify({ code: 'ANALYSIS_BUSY', error: 'Over capacity' }), {
				status: 429,
			});
		});
		const client429 = new EvaluationClient(testConfig, {
			fetchFn: mockFetch429 as unknown as typeof fetch,
		});
		await expect(client429.evaluatePosition({ fen: 'fen' })).rejects.toThrowError(
			expect.objectContaining({
				status: 429,
				code: 'ANALYSIS_BUSY',
				message: 'Too many evaluation analyses are currently in progress',
			}),
		);

		const mockFetch429Default = vi.fn(async () => {
			return new Response(JSON.stringify({}), {
				status: 429,
			});
		});
		const client429Default = new EvaluationClient(testConfig, {
			fetchFn: mockFetch429Default as unknown as typeof fetch,
		});
		await expect(client429Default.evaluatePosition({ fen: 'fen' })).rejects.toThrowError(
			expect.objectContaining({
				status: 429,
				code: 'ANALYSIS_BUSY',
				message: 'Too many evaluation analyses are currently in progress',
			}),
		);

		const mockFetch503 = vi.fn(async () => {
			return new Response(
				JSON.stringify({ code: 'MODEL_UNAVAILABLE', error: 'Model not loaded' }),
				{
					status: 503,
				},
			);
		});
		const client503 = new EvaluationClient(testConfig, {
			fetchFn: mockFetch503 as unknown as typeof fetch,
		});
		await expect(client503.evaluatePosition({ fen: 'fen' })).rejects.toThrowError(
			expect.objectContaining({
				status: 503,
				code: 'MODEL_UNAVAILABLE',
				message: 'Evaluation model is currently unavailable',
			}),
		);

		const mockFetch503Default = vi.fn(async () => {
			return new Response(JSON.stringify({ code: 'MODEL_NOT_READY' }), {
				status: 500,
			});
		});
		const client503Default = new EvaluationClient(testConfig, {
			fetchFn: mockFetch503Default as unknown as typeof fetch,
		});
		await expect(client503Default.evaluatePosition({ fen: 'fen' })).rejects.toThrowError(
			expect.objectContaining({
				status: 503,
				code: 'MODEL_UNAVAILABLE',
				message: 'Evaluation model is currently unavailable',
			}),
		);
	});

	it('maps upstream 504 and 413 errors accurately with custom and default messages', async () => {
		const mockFetch504 = vi.fn(async () => {
			return new Response(
				JSON.stringify({ code: 'DEADLINE_EXCEEDED', error: 'Evaluation timeout' }),
				{
					status: 504,
				},
			);
		});
		const client504 = new EvaluationClient(testConfig, {
			fetchFn: mockFetch504 as unknown as typeof fetch,
		});
		await expect(client504.evaluatePosition({ fen: 'fen' })).rejects.toThrowError(
			expect.objectContaining({
				status: 504,
				code: 'DEADLINE_EXCEEDED',
				message: 'Evaluation deadline exceeded',
			}),
		);

		const mockFetch504Default = vi.fn(async () => {
			return new Response(JSON.stringify({}), {
				status: 504,
			});
		});
		const client504Default = new EvaluationClient(testConfig, {
			fetchFn: mockFetch504Default as unknown as typeof fetch,
		});
		await expect(client504Default.evaluatePosition({ fen: 'fen' })).rejects.toThrowError(
			expect.objectContaining({
				status: 504,
				code: 'DEADLINE_EXCEEDED',
				message: 'Evaluation deadline exceeded',
			}),
		);

		const mockFetch413 = vi.fn(async () => {
			return new Response(
				JSON.stringify({ code: 'PAYLOAD_TOO_LARGE', error: 'Body exceeds limit' }),
				{
					status: 413,
				},
			);
		});
		const client413 = new EvaluationClient(testConfig, {
			fetchFn: mockFetch413 as unknown as typeof fetch,
		});
		await expect(client413.evaluatePosition({ fen: 'fen' })).rejects.toThrowError(
			expect.objectContaining({
				status: 413,
				code: 'PAYLOAD_TOO_LARGE',
				message: 'Request payload too large',
			}),
		);

		const mockFetch413Default = vi.fn(async () => {
			return new Response(JSON.stringify({}), {
				status: 413,
			});
		});
		const client413Default = new EvaluationClient(testConfig, {
			fetchFn: mockFetch413Default as unknown as typeof fetch,
		});
		await expect(client413Default.evaluatePosition({ fen: 'fen' })).rejects.toThrowError(
			expect.objectContaining({
				status: 413,
				code: 'PAYLOAD_TOO_LARGE',
				message: 'Request payload too large',
			}),
		);
	});

	it('masks upstream 401 authentication failures as internal 500 without leaking credentials', async () => {
		const mockFetch401 = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					code: 'AUTHENTICATION_FAILURE',
					error: 'Invalid or missing bearer token',
				}),
				{ status: 401 },
			);
		});

		const client = new EvaluationClient(testConfig, {
			fetchFn: mockFetch401 as unknown as typeof fetch,
		});
		await expect(client.evaluatePosition({ fen: 'fen' })).rejects.toThrowError(
			expect.objectContaining({
				status: 500,
				code: 'INTERNAL_FAILURE',
			}),
		);
	});

	it('handles non-JSON error bodies from upstream', async () => {
		const mockFetchBadGateway = vi.fn(async () => {
			return new Response('<html>502 Bad Gateway</html>', { status: 502 });
		});

		const client = new EvaluationClient(testConfig, {
			fetchFn: mockFetchBadGateway as unknown as typeof fetch,
		});
		await expect(client.evaluatePosition({ fen: 'fen' })).rejects.toThrowError(
			expect.objectContaining({
				status: 500,
				code: 'INTERNAL_FAILURE',
			}),
		);
	});

	it('maps fetch timeout / abort errors to 504 DEADLINE_EXCEEDED', async () => {
		const mockFetchTimeout = vi.fn(async () => {
			const error = new Error('The operation was aborted due to timeout');
			error.name = 'TimeoutError';
			throw error;
		});

		const client = new EvaluationClient(testConfig, {
			fetchFn: mockFetchTimeout as unknown as typeof fetch,
		});
		await expect(client.evaluatePosition({ fen: 'fen' })).rejects.toThrowError(
			expect.objectContaining({
				status: 504,
				code: 'DEADLINE_EXCEEDED',
			}),
		);
	});

	it('maps network errors or connection refused to 503 MODEL_UNAVAILABLE', async () => {
		const mockFetchNetworkError = vi.fn(async () => {
			throw new TypeError('fetch failed: ECONNREFUSED 127.0.0.1:8080');
		});

		const client = new EvaluationClient(testConfig, {
			fetchFn: mockFetchNetworkError as unknown as typeof fetch,
		});
		await expect(client.evaluatePosition({ fen: 'fen' })).rejects.toThrowError(
			expect.objectContaining({
				status: 503,
				code: 'MODEL_UNAVAILABLE',
			}),
		);
	});
});
