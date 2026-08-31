// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';

const PORT = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 8088;
const EXPECTED_TOKEN = process.env.EVALUATOR_BEARER_TOKEN || 'test-evaluator-token';
const MODEL_ID = process.env.EXPECTED_MODEL_ID || 'dicechess-v1-test';
const MODEL_SHA256 =
	process.env.EXPECTED_MODEL_SHA256 ||
	'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const server = createServer((req, res) => {
	const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
	const authHeader = req.headers['authorization'];

	/**
	 * @param {number} status
	 * @param {unknown} payload
	 */
	const sendJson = (status, payload) => {
		res.writeHead(status, {
			'content-type': 'application/json',
			'cache-control': 'no-store',
		});
		res.end(JSON.stringify(payload));
	};

	// Public liveness endpoint
	if (req.method === 'GET' && url.pathname === '/health') {
		return sendJson(200, { status: 'ok' });
	}

	// Public readiness endpoint
	if (req.method === 'GET' && url.pathname === '/ready') {
		return sendJson(200, { status: 'ready' });
	}

	// Protected endpoints require valid Bearer token
	if (!authHeader || authHeader !== `Bearer ${EXPECTED_TOKEN}`) {
		return sendJson(401, {
			code: 'AUTHENTICATION_FAILURE',
			error: 'Invalid or missing authentication credentials',
		});
	}

	// Protected version endpoint
	if (req.method === 'GET' && url.pathname === '/version') {
		return sendJson(200, {
			version: '0.1.0',
			engineVersion: '0.1.0',
		});
	}

	// Protected manifest endpoint
	if (req.method === 'GET' && url.pathname === '/manifest') {
		return sendJson(200, {
			modelId: MODEL_ID,
			modelSha256: MODEL_SHA256,
		});
	}

	// Protected position evaluation endpoint
	if (req.method === 'POST' && url.pathname === '/api/v1/evaluate/position') {
		let body = '';
		/** @param {Buffer | string} chunk */
		req.on('data', (chunk) => {
			body += chunk;
		});
		req.on('end', () => {
			/** @type {any} */
			let parsed;
			try {
				parsed = JSON.parse(body);
			} catch {
				return sendJson(400, {
					code: 'INVALID_REQUEST',
					error: 'Invalid JSON request body',
				});
			}

			if (!parsed || typeof parsed.fen !== 'string' || parsed.fen === 'invalid_fen_string') {
				return sendJson(422, {
					code: 'INVALID_FEN',
					error: 'Invalid FEN',
				});
			}

			const fenParts = parsed.fen.trim().split(/\s+/);
			if (fenParts.length < 2) {
				return sendJson(422, {
					code: 'INVALID_FEN',
					error: 'Invalid FEN format',
				});
			}

			const sideToMove = fenParts[1];
			if (sideToMove !== 'w' && sideToMove !== 'b') {
				return sendJson(422, {
					code: 'INVALID_FEN',
					error: 'Invalid side to move in FEN',
				});
			}

			return sendJson(200, {
				fen: parsed.fen,
				sideToMove,
				winProbability: 0.52,
				provenance: {
					engineVersion: '0.1.0',
					rulesetVersion: '1.0.0',
					modelId: MODEL_ID,
					modelSha256: MODEL_SHA256,
					featureSchema: 'v1',
					evaluationProfile: parsed.profile || 'standard',
					algorithm: 'nnue',
					searchParameters: {},
				},
			});
		});
		return;
	}

	return sendJson(404, {
		code: 'INVALID_REQUEST',
		error: 'Not found',
	});
});

server.listen(PORT, '127.0.0.1', () => {
	if (process.env.FIXTURE_READY_FILE) {
		writeFileSync(process.env.FIXTURE_READY_FILE, 'ready', { encoding: 'utf8' });
	}
});
