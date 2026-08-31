// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { EVALUATION_ERROR_CODES } from './evaluation.js';

describe('evaluation contracts', () => {
	it('defines the 13 stable machine-readable error codes', () => {
		expect(EVALUATION_ERROR_CODES).toEqual([
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
		]);
	});
});
