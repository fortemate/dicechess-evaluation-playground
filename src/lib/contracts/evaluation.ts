// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

import type { ActiveColor } from '$lib/position/model.js';

/**
 * Stable machine-readable error codes for the evaluation BFF and evaluator API.
 * These codes are part of the public wire contract and must never be renamed or removed.
 */
export const EVALUATION_ERROR_CODES = [
	'INVALID_FEN',
	'INVALID_DICE',
	'INVALID_PROFILE',
	'ILLEGAL_PLAYED_TURN',
	'MODEL_UNAVAILABLE',
	'ANALYSIS_BUSY',
	'DEADLINE_EXCEEDED',
	'INTERNAL_FAILURE',
	'INVALID_REQUEST',
	'AUTHENTICATION_FAILURE',
	'PAYLOAD_TOO_LARGE',
	'MODEL_NOT_READY',
	'MANIFEST_NOT_FOUND',
] as const;

export type EvaluationErrorCode = (typeof EVALUATION_ERROR_CODES)[number];

/**
 * Standard error response envelope.
 */
export interface EvaluationApiError {
	code: EvaluationErrorCode;
	error: string;
	correlationId?: string;
}

/**
 * Request payload for single-position evaluation.
 */
export interface PositionEvaluationRequest {
	/** FEN string of the board position to evaluate */
	fen: string;
	/** Optional evaluation profile identifier (e.g. 'standard-kcp') */
	profile?: string;
}

/**
 * Successful response payload for single-position evaluation with immutable provenance.
 */
export interface PositionEvaluationResponse {
	/** Evaluated board position FEN (canonical 4-field representation) */
	fen: string;
	/** Side to move ('w' or 'b') */
	perspective: ActiveColor;
	/** Winning probability for the side to move [0.0, 1.0] */
	probability: number;
	/** BFF measured roundtrip latency in milliseconds */
	latencyMs: number;
	/** Server-generated request correlation ID */
	correlationId: string;
	/** Evaluator engine version */
	evaluatorVersion: string;
	/** Model identifier */
	modelId: string;
	/** Full immutable model SHA-256 digest */
	modelSha256: string;
}
