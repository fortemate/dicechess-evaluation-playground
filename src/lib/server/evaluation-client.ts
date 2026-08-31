// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

import type { EvaluationErrorCode } from '$lib/contracts/evaluation.js';
import type { ServerConfig } from './config.js';

export interface UpstreamEvaluationProvenance {
	engineVersion: string;
	rulesetVersion: string;
	modelId: string;
	modelSha256: string;
	featureSchema: string;
	evaluationProfile: string;
	algorithm: string;
	searchParameters: Record<string, string>;
	seed?: number;
}

export interface UpstreamPositionEvalResponse {
	fen: string;
	sideToMove: 'w' | 'b';
	winProbability: number;
	provenance: UpstreamEvaluationProvenance;
}

export interface EvaluatePositionOptions {
	fen: string;
	profile?: string;
}

export class EvaluationClientError extends Error {
	readonly status: number;
	readonly code: EvaluationErrorCode;
	readonly correlationId?: string;

	constructor(status: number, code: EvaluationErrorCode, message: string, correlationId?: string) {
		super(message);
		this.name = 'EvaluationClientError';
		this.status = status;
		this.code = code;
		this.correlationId = correlationId;
	}
}

export interface EvaluationClientOptions {
	fetchFn?: typeof fetch;
}

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;

function validateUpstreamSuccessResponse(data: unknown): UpstreamPositionEvalResponse {
	if (typeof data !== 'object' || data === null || Array.isArray(data)) {
		throw new EvaluationClientError(
			500,
			'INTERNAL_FAILURE',
			'Invalid response format from evaluation service',
		);
	}

	const record = data as Record<string, unknown>;
	if (typeof record.fen !== 'string' || record.fen.trim() === '') {
		throw new EvaluationClientError(
			500,
			'INTERNAL_FAILURE',
			'Invalid response: missing or invalid fen',
		);
	}

	if (record.sideToMove !== 'w' && record.sideToMove !== 'b') {
		throw new EvaluationClientError(
			500,
			'INTERNAL_FAILURE',
			'Invalid response: sideToMove must be "w" or "b"',
		);
	}

	if (
		typeof record.winProbability !== 'number' ||
		Number.isNaN(record.winProbability) ||
		record.winProbability < 0 ||
		record.winProbability > 1
	) {
		throw new EvaluationClientError(
			500,
			'INTERNAL_FAILURE',
			'Invalid response: winProbability must be a number between 0 and 1',
		);
	}

	const provenance = record.provenance;
	if (typeof provenance !== 'object' || provenance === null || Array.isArray(provenance)) {
		throw new EvaluationClientError(
			500,
			'INTERNAL_FAILURE',
			'Invalid response: missing provenance',
		);
	}

	const prov = provenance as Record<string, unknown>;
	if (
		typeof prov.engineVersion !== 'string' ||
		typeof prov.rulesetVersion !== 'string' ||
		typeof prov.modelId !== 'string' ||
		typeof prov.featureSchema !== 'string' ||
		typeof prov.evaluationProfile !== 'string' ||
		typeof prov.algorithm !== 'string' ||
		typeof prov.modelSha256 !== 'string' ||
		!SHA256_HEX_PATTERN.test(prov.modelSha256)
	) {
		throw new EvaluationClientError(
			500,
			'INTERNAL_FAILURE',
			'Invalid response: malformed provenance or model SHA-256',
		);
	}

	return data as UpstreamPositionEvalResponse;
}

export class EvaluationClient {
	private readonly config: ServerConfig;
	private readonly fetchFn: typeof fetch;
	private activeCount = 0;

	constructor(config: ServerConfig, options?: EvaluationClientOptions) {
		this.config = config;
		this.fetchFn = options?.fetchFn ?? globalThis.fetch.bind(globalThis);
	}

	get activeEvaluations(): number {
		return this.activeCount;
	}

	async evaluatePosition(options: EvaluatePositionOptions): Promise<UpstreamPositionEvalResponse> {
		if (this.activeCount >= this.config.maxConcurrentEvaluations) {
			throw new EvaluationClientError(
				429,
				'ANALYSIS_BUSY',
				'Too many evaluation analyses are currently in progress',
			);
		}

		this.activeCount++;
		try {
			const endpoint = `${this.config.evaluatorOrigin}/api/v1/evaluate/position`;
			const payload: { fen: string; profile?: string } = {
				fen: options.fen,
			};
			if (options.profile) {
				payload.profile = options.profile;
			}

			const response = await this.fetchFn(endpoint, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${this.config.evaluatorBearerToken}`,
					'Content-Type': 'application/json',
					Accept: 'application/json',
				},
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(this.config.evaluatorTimeoutMs),
			});

			if (response.ok) {
				let rawJson: unknown;
				try {
					rawJson = await response.json();
				} catch {
					throw new EvaluationClientError(
						500,
						'INTERNAL_FAILURE',
						'Invalid non-JSON response from evaluation service',
					);
				}
				return validateUpstreamSuccessResponse(rawJson);
			}

			let errorBody: { code?: string; error?: string; correlationId?: string } = {};
			try {
				errorBody = (await response.json()) as {
					code?: string;
					error?: string;
					correlationId?: string;
				};
			} catch {
				// Non-JSON response body
			}

			const codeStr = errorBody.code ?? '';
			const message = errorBody.error;

			if (response.status === 422) {
				if (codeStr === 'INVALID_PROFILE') {
					throw new EvaluationClientError(
						422,
						'INVALID_PROFILE',
						message || 'Invalid evaluation profile',
					);
				}
				throw new EvaluationClientError(422, 'INVALID_FEN', message || 'Invalid FEN');
			}

			if (response.status === 429 || codeStr === 'ANALYSIS_BUSY') {
				throw new EvaluationClientError(
					429,
					'ANALYSIS_BUSY',
					message || 'Too many evaluation analyses are currently in progress',
				);
			}

			if (
				response.status === 503 ||
				codeStr === 'MODEL_UNAVAILABLE' ||
				codeStr === 'MODEL_NOT_READY'
			) {
				throw new EvaluationClientError(
					503,
					'MODEL_UNAVAILABLE',
					message || 'Evaluation model is currently unavailable',
				);
			}

			if (response.status === 504 || codeStr === 'DEADLINE_EXCEEDED') {
				throw new EvaluationClientError(
					504,
					'DEADLINE_EXCEEDED',
					message || 'Evaluation deadline exceeded',
				);
			}

			if (response.status === 413 || codeStr === 'PAYLOAD_TOO_LARGE') {
				throw new EvaluationClientError(
					413,
					'PAYLOAD_TOO_LARGE',
					message || 'Request payload too large',
				);
			}

			// Map upstream 401/403 or other unexpected status codes to 500 INTERNAL_FAILURE without leaking credentials
			throw new EvaluationClientError(
				500,
				'INTERNAL_FAILURE',
				'An internal error occurred.',
				errorBody.correlationId,
			);
		} catch (error) {
			if (error instanceof EvaluationClientError) {
				throw error;
			}

			if (
				error instanceof Error &&
				(error.name === 'TimeoutError' || error.name === 'AbortError')
			) {
				throw new EvaluationClientError(504, 'DEADLINE_EXCEEDED', 'Evaluation deadline exceeded');
			}

			throw new EvaluationClientError(
				503,
				'MODEL_UNAVAILABLE',
				'Evaluation service is unavailable or unreachable',
			);
		} finally {
			this.activeCount--;
		}
	}
}
