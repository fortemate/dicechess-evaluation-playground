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

const PUBLIC_ERROR_MESSAGES: Record<EvaluationErrorCode, string> = {
	INVALID_REQUEST: 'Invalid evaluation request',
	INVALID_FEN: 'Invalid FEN',
	INVALID_DICE: 'Invalid dice value',
	INVALID_PROFILE: 'Invalid evaluation profile',
	ILLEGAL_PLAYED_TURN: 'Illegal played turn',
	AUTHENTICATION_FAILURE: 'Invalid or missing authentication credentials',
	MODEL_UNAVAILABLE: 'Evaluation model is currently unavailable',
	MODEL_NOT_READY: 'Evaluation model is not ready',
	MANIFEST_NOT_FOUND: 'Evaluation model manifest is unavailable',
	ANALYSIS_BUSY: 'Too many evaluation analyses are currently in progress',
	DEADLINE_EXCEEDED: 'Evaluation deadline exceeded',
	INTERNAL_FAILURE: 'An internal error occurred.',
	PAYLOAD_TOO_LARGE: 'Request payload too large',
};

export function getPublicEvaluationErrorMessage(code: EvaluationErrorCode): string {
	return PUBLIC_ERROR_MESSAGES[code];
}

function clientError(
	status: number,
	code: EvaluationErrorCode,
	correlationId?: string,
): EvaluationClientError {
	return new EvaluationClientError(
		status,
		code,
		getPublicEvaluationErrorMessage(code),
		correlationId,
	);
}

function validateUpstreamSuccessResponse(
	data: unknown,
	expectedFen: string,
): UpstreamPositionEvalResponse {
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

	const expectedSideToMove = expectedFen.split(' ')[1];
	if (record.fen !== expectedFen || record.sideToMove !== expectedSideToMove) {
		throw clientError(500, 'INTERNAL_FAILURE');
	}

	return data as UpstreamPositionEvalResponse;
}

interface UpstreamErrorBody {
	code?: string;
}

async function readUpstreamErrorBody(response: Response): Promise<UpstreamErrorBody> {
	try {
		return (await response.json()) as UpstreamErrorBody;
	} catch {
		return {};
	}
}

function mapUpstreamError(response: Response, errorBody: UpstreamErrorBody): EvaluationClientError {
	const code = errorBody.code ?? '';
	if (response.status === 422) {
		return code === 'INVALID_PROFILE'
			? clientError(422, 'INVALID_PROFILE')
			: clientError(422, 'INVALID_FEN');
	}
	if (response.status === 429 || code === 'ANALYSIS_BUSY') {
		return clientError(429, 'ANALYSIS_BUSY');
	}
	if (response.status === 503 || code === 'MODEL_UNAVAILABLE' || code === 'MODEL_NOT_READY') {
		return clientError(503, 'MODEL_UNAVAILABLE');
	}
	if (response.status === 504 || code === 'DEADLINE_EXCEEDED') {
		return clientError(504, 'DEADLINE_EXCEEDED');
	}
	if (response.status === 413 || code === 'PAYLOAD_TOO_LARGE') {
		return clientError(413, 'PAYLOAD_TOO_LARGE');
	}
	return clientError(500, 'INTERNAL_FAILURE');
}

function mapTransportError(error: unknown): EvaluationClientError {
	if (error instanceof EvaluationClientError) return error;
	if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
		return clientError(504, 'DEADLINE_EXCEEDED');
	}
	return clientError(503, 'MODEL_UNAVAILABLE');
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

	private async requestPosition(
		options: EvaluatePositionOptions,
	): Promise<UpstreamPositionEvalResponse> {
		const endpoint = `${this.config.evaluatorOrigin}/api/v1/evaluate/position`;
		const payload: { fen: string; profile?: string } = { fen: options.fen };
		if (options.profile !== undefined) payload.profile = options.profile;

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

		if (!response.ok) {
			throw mapUpstreamError(response, await readUpstreamErrorBody(response));
		}

		let rawJson: unknown;
		try {
			rawJson = await response.json();
		} catch {
			throw clientError(500, 'INTERNAL_FAILURE');
		}
		return validateUpstreamSuccessResponse(rawJson, options.fen);
	}

	async evaluatePosition(options: EvaluatePositionOptions): Promise<UpstreamPositionEvalResponse> {
		if (this.activeCount >= this.config.maxConcurrentEvaluations) {
			throw clientError(429, 'ANALYSIS_BUSY');
		}

		this.activeCount++;
		try {
			return await this.requestPosition(options);
		} catch (error) {
			throw mapTransportError(error);
		} finally {
			this.activeCount--;
		}
	}
}
