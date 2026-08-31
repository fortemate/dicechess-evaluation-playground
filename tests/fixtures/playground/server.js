// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

const EVALUATOR_PORT = process.env.FIXTURE_EVALUATOR_PORT
	? Number.parseInt(process.env.FIXTURE_EVALUATOR_PORT, 10)
	: 8088;

const JWKS_PORT = process.env.FIXTURE_JWKS_PORT
	? Number.parseInt(process.env.FIXTURE_JWKS_PORT, 10)
	: 8443;

const EXPECTED_TOKEN = process.env.EVALUATOR_BEARER_TOKEN || 'e2e-evaluator-token';
const MODEL_ID = process.env.EXPECTED_MODEL_ID || 'dicechess-v1-test';
const MODEL_SHA256 =
	process.env.EXPECTED_MODEL_SHA256 ||
	'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const CF_ACCESS_TEAM_DOMAIN = process.env.CF_ACCESS_TEAM_DOMAIN || `https://127.0.0.1:${JWKS_PORT}`;
const CF_ACCESS_AUD = process.env.CF_ACCESS_AUD || 'e2e-aud-tag';
const OPENSSL_PATH = '/usr/bin/openssl';
let evaluationRequestCount = 0;

// Verify openssl is available before attempting to generate ephemeral certificates
try {
	execFileSync(OPENSSL_PATH, ['version'], { stdio: 'ignore' });
} catch (error) {
	throw new Error(
		`The trusted OpenSSL executable is required at ${OPENSSL_PATH} to generate the ephemeral TLS certificate for local HTTPS JWKS fixtures.`,
		{ cause: error },
	);
}

// Generate ephemeral TLS certificate for local HTTPS JWKS server
const tempDir = mkdtempSync(join(tmpdir(), 'playground-e2e-tls-'));
const keyPath = join(tempDir, 'tls-key.pem');
const rawCertPath = join(tempDir, 'tls-cert.pem');
const caCertExportPath = process.env.PLAYGROUND_CA_CERT || join(tempDir, 'ca-cert.pem');

execFileSync(
	OPENSSL_PATH,
	[
		'req',
		'-x509',
		'-newkey',
		'rsa:2048',
		'-nodes',
		'-keyout',
		keyPath,
		'-out',
		rawCertPath,
		'-days',
		'1',
		'-subj',
		'/CN=127.0.0.1',
		'-addext',
		'subjectAltName=IP:127.0.0.1,DNS:localhost',
	],
	{ stdio: 'ignore' },
);

const tlsKey = readFileSync(keyPath);
const tlsCert = readFileSync(rawCertPath);
writeFileSync(caCertExportPath, tlsCert, { encoding: 'utf8' });

// Generate RSA keypair for Cloudflare Access JWT signing and verification
const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
const publicJwk = await exportJWK(publicKey);
publicJwk.kid = 'e2e-access-key-1';
publicJwk.alg = 'RS256';
publicJwk.use = 'sig';

/**
 * @param {object} [options]
 * @param {boolean} [options.expired]
 * @param {boolean} [options.badAudience]
 * @param {boolean} [options.badIssuer]
 * @param {string} [options.sub]
 * @param {string} [options.email]
 */
async function createTestJwt(options = {}) {
	const sub = options.sub || 'user-e2e-test';
	const email = options.email || 'tester@fortemate.com';

	const jwtBuilder = new SignJWT({ sub, email })
		.setProtectedHeader({ alg: 'RS256', kid: 'e2e-access-key-1' })
		.setIssuer(
			options.badIssuer ? 'https://wrong-team.cloudflareaccess.com' : CF_ACCESS_TEAM_DOMAIN,
		)
		.setAudience(options.badAudience ? 'wrong-audience' : CF_ACCESS_AUD);

	if (options.expired) {
		jwtBuilder
			.setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
			.setExpirationTime(Math.floor(Date.now() / 1000) - 3600);
	} else {
		jwtBuilder.setIssuedAt().setExpirationTime('1h');
	}

	return await jwtBuilder.sign(privateKey);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(res, status, payload) {
	res.writeHead(status, {
		'content-type': 'application/json',
		'cache-control': 'no-store',
	});
	res.end(JSON.stringify(payload));
}

/**
 * @param {string} body
 * @param {import('node:http').ServerResponse} res
 */
function sendEvaluationResponse(body, res) {
	/** @type {any} */
	let parsed;
	try {
		parsed = JSON.parse(body);
	} catch {
		return sendJson(res, 400, {
			code: 'INVALID_REQUEST',
			error: 'Invalid JSON request body',
		});
	}

	if (!parsed || typeof parsed.fen !== 'string' || parsed.fen === 'invalid_fen_string') {
		return sendJson(res, 422, {
			code: 'INVALID_FEN',
			error: 'Invalid FEN',
		});
	}

	const fenParts = parsed.fen.trim().split(/\s+/);
	if (fenParts.length < 2) {
		return sendJson(res, 422, {
			code: 'INVALID_FEN',
			error: 'Invalid FEN format',
		});
	}

	const sideToMove = fenParts[1];
	if (sideToMove !== 'w' && sideToMove !== 'b') {
		return sendJson(res, 422, {
			code: 'INVALID_FEN',
			error: 'Invalid side to move in FEN',
		});
	}

	return sendJson(res, 200, {
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
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
function handleEvaluationRequest(req, res) {
	evaluationRequestCount += 1;
	if (req.headers['authorization'] !== `Bearer ${EXPECTED_TOKEN}`) {
		return sendJson(res, 401, {
			code: 'AUTHENTICATION_FAILURE',
			error: 'Invalid or missing authentication credentials',
		});
	}

	let body = '';
	req.on('data', (chunk) => {
		body += chunk;
	});
	req.on('end', () => sendEvaluationResponse(body, res));
}

/**
 * @param {URL} url
 * @param {import('node:http').ServerResponse} res
 */
async function sendTestToken(url, res) {
	const token = await createTestJwt({
		expired: url.searchParams.get('expired') === 'true',
		badAudience: url.searchParams.get('badAudience') === 'true',
		badIssuer: url.searchParams.get('badIssuer') === 'true',
		sub: url.searchParams.get('sub') || undefined,
		email: url.searchParams.get('email') || undefined,
	});
	return sendJson(res, 200, { token });
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
async function handleEvaluatorRequest(req, res) {
	const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
	switch (`${req.method} ${url.pathname}`) {
		case 'GET /health':
			return sendJson(res, 200, { status: 'ok' });
		case 'GET /ready':
			return sendJson(res, 200, { status: 'ready' });
		case 'GET /version':
			return sendJson(res, 200, { version: '0.1.0', engineVersion: '0.1.0' });
		case 'GET /manifest':
			return sendJson(res, 200, { modelId: MODEL_ID, modelSha256: MODEL_SHA256 });
		case 'GET /test/token':
			return sendTestToken(url, res);
		case 'GET /test/stats':
			return sendJson(res, 200, { evaluationRequestCount });
		case 'POST /test/reset':
			evaluationRequestCount = 0;
			return sendJson(res, 200, { evaluationRequestCount });
		case 'POST /api/v1/evaluate/position':
			return handleEvaluationRequest(req, res);
		default:
			return sendJson(res, 404, { code: 'INVALID_REQUEST', error: 'Not found' });
	}
}

// 1. Evaluator HTTP server
const evaluatorServer = createHttpServer(handleEvaluatorRequest);

// 2. Cloudflare Access HTTPS JWKS server
const jwksServer = createHttpsServer({ key: tlsKey, cert: tlsCert }, (req, res) => {
	const url = new URL(req.url || '/', `https://${req.headers.host || 'localhost'}`);

	if (req.method === 'GET' && url.pathname === '/health') {
		return sendJson(res, 200, { status: 'ok' });
	}

	if (req.method === 'GET' && url.pathname === '/cdn-cgi/access/certs') {
		return sendJson(res, 200, {
			keys: [publicJwk],
		});
	}

	return sendJson(res, 404, {
		error: 'Not found',
	});
});

function cleanup() {
	try {
		evaluatorServer.close();
	} catch {
		// Ignore
	}
	try {
		jwksServer.close();
	} catch {
		// Ignore
	}
	try {
		rmSync(tempDir, { recursive: true, force: true });
	} catch {
		// Ignore
	}
	try {
		rmSync(caCertExportPath, { force: true });
	} catch {
		// Ignore
	}
}

process.on('SIGINT', () => {
	cleanup();
	process.exit(0);
});

process.on('SIGTERM', () => {
	cleanup();
	process.exit(0);
});

process.on('exit', () => {
	cleanup();
});

evaluatorServer.listen(EVALUATOR_PORT, '127.0.0.1', () => {
	jwksServer.listen(JWKS_PORT, '127.0.0.1', () => {
		if (process.env.FIXTURE_READY_FILE) {
			writeFileSync(process.env.FIXTURE_READY_FILE, 'ready', { encoding: 'utf8' });
		}
	});
});
