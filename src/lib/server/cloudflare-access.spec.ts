// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import {
	CloudflareAccessValidator,
	CF_ACCESS_HEADER,
	isLoopbackAddress,
} from './cloudflare-access.js';
import type { ServerConfig } from './config.js';

describe('isLoopbackAddress', () => {
	it('identifies loopback IP formats', () => {
		expect(isLoopbackAddress('127.0.0.1')).toBe(true);
		expect(isLoopbackAddress('::1')).toBe(true);
		expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
		expect(isLoopbackAddress('localhost')).toBe(true);
		expect(isLoopbackAddress('  127.0.0.1  ')).toBe(true);
	});

	it('rejects non-loopback IP formats and empty addresses', () => {
		expect(isLoopbackAddress('192.168.1.1')).toBe(false);
		expect(isLoopbackAddress('10.0.0.1')).toBe(false);
		expect(isLoopbackAddress('8.8.8.8')).toBe(false);
		expect(isLoopbackAddress('')).toBe(false);
		expect(isLoopbackAddress(undefined)).toBe(false);
	});
});

describe('CloudflareAccessValidator', () => {
	const testConfig: ServerConfig = {
		evaluatorOrigin: 'http://127.0.0.1:8080',
		evaluatorBearerToken: 'test-token',
		cfAccessTeamDomain: 'https://test-team.cloudflareaccess.com',
		cfAccessAud: 'test-aud-tag',
		allowDevAuthBypass: false,
		maxRequestBodyBytes: 65536,
		evaluatorTimeoutMs: 5000,
		maxConcurrentEvaluations: 4,
		nodeEnv: 'test',
	};

	it('handles development bypass for loopback requests', async () => {
		const bypassValidator = new CloudflareAccessValidator({
			...testConfig,
			allowDevAuthBypass: true,
		});

		const resultLoopback = await bypassValidator.validateRequest(new Headers(), '127.0.0.1');
		expect(resultLoopback).toEqual({ authenticated: true, subject: 'dev-loopback' });

		const resultNonLoopback = await bypassValidator.validateRequest(new Headers(), '10.0.0.5');
		expect(resultNonLoopback).toEqual({
			authenticated: false,
			error: 'Development authentication bypass is only permitted from loopback addresses',
		});
	});

	it('rejects requests when Cf-Access-Jwt-Assertion header is missing or empty', async () => {
		const validator = new CloudflareAccessValidator(testConfig);

		const missingHeaders = await validator.validateRequest(new Headers());
		expect(missingHeaders).toEqual({
			authenticated: false,
			error: 'Missing required Cf-Access-Jwt-Assertion header',
		});

		const otherHeadersRecord = await validator.validateRequest({
			'content-type': 'application/json',
			accept: 'application/json',
		});
		expect(otherHeadersRecord).toEqual({
			authenticated: false,
			error: 'Missing required Cf-Access-Jwt-Assertion header',
		});

		const emptyHeaderRecord = await validator.validateRequest({
			[CF_ACCESS_HEADER]: '   ',
		});
		expect(emptyHeaderRecord).toEqual({
			authenticated: false,
			error: 'Missing required Cf-Access-Jwt-Assertion header',
		});
	});

	it('validates a properly signed RS256 JWT with matching issuer and audience', async () => {
		const { publicKey, privateKey } = await generateKeyPair('RS256');
		const publicJwk = await exportJWK(publicKey);
		publicJwk.kid = 'test-key-id';
		publicJwk.alg = 'RS256';

		const localJwks = createLocalJWKSet({ keys: [publicJwk] });
		const validator = new CloudflareAccessValidator(testConfig, { keyResolver: localJwks });

		const jwtWithEmail = await new SignJWT({ email: 'user@example.com', sub: 'user-sub-123' })
			.setProtectedHeader({ alg: 'RS256', kid: 'test-key-id' })
			.setIssuer(testConfig.cfAccessTeamDomain)
			.setAudience(testConfig.cfAccessAud)
			.setIssuedAt()
			.setExpirationTime('10m')
			.sign(privateKey);

		const headers = new Headers();
		headers.set(CF_ACCESS_HEADER, jwtWithEmail);

		const result = await validator.validateRequest(headers, '127.0.0.1');
		expect(result).toEqual({
			authenticated: true,
			subject: 'user-sub-123',
			email: 'user@example.com',
		});

		// Test with Record<string, string> containing multiple keys and token without email
		const jwtWithoutEmail = await new SignJWT({ sub: 'service-account' })
			.setProtectedHeader({ alg: 'RS256', kid: 'test-key-id' })
			.setIssuer(testConfig.cfAccessTeamDomain)
			.setAudience(testConfig.cfAccessAud)
			.setIssuedAt()
			.setExpirationTime('10m')
			.sign(privateKey);

		const recordResult = await validator.validateRequest({
			'content-type': 'application/json',
			'Cf-Access-Jwt-Assertion': jwtWithoutEmail,
		});
		expect(recordResult).toEqual({
			authenticated: true,
			subject: 'service-account',
			email: undefined,
		});
	});

	it('rejects expired JWTs', async () => {
		const { publicKey, privateKey } = await generateKeyPair('RS256');
		const publicJwk = await exportJWK(publicKey);
		publicJwk.kid = 'test-key-id';
		publicJwk.alg = 'RS256';

		const localJwks = createLocalJWKSet({ keys: [publicJwk] });
		const validator = new CloudflareAccessValidator(testConfig, { keyResolver: localJwks });

		const expiredJwt = await new SignJWT({ sub: 'user-123' })
			.setProtectedHeader({ alg: 'RS256', kid: 'test-key-id' })
			.setIssuer(testConfig.cfAccessTeamDomain)
			.setAudience(testConfig.cfAccessAud)
			.setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
			.setExpirationTime(Math.floor(Date.now() / 1000) - 1800)
			.sign(privateKey);

		const result = await validator.validateRequest({ [CF_ACCESS_HEADER]: expiredJwt });
		expect(result.authenticated).toBe(false);
		expect(result.error).toBe('Invalid or missing authentication credentials');
	});

	it('rejects JWTs without an expiration claim', async () => {
		const { publicKey, privateKey } = await generateKeyPair('RS256');
		const publicJwk = await exportJWK(publicKey);
		publicJwk.kid = 'test-key-id';
		publicJwk.alg = 'RS256';

		const localJwks = createLocalJWKSet({ keys: [publicJwk] });
		const validator = new CloudflareAccessValidator(testConfig, { keyResolver: localJwks });
		const jwtWithoutExpiration = await new SignJWT({ sub: 'user-123' })
			.setProtectedHeader({ alg: 'RS256', kid: 'test-key-id' })
			.setIssuer(testConfig.cfAccessTeamDomain)
			.setAudience(testConfig.cfAccessAud)
			.setIssuedAt()
			.sign(privateKey);

		const result = await validator.validateRequest({
			[CF_ACCESS_HEADER]: jwtWithoutExpiration,
		});
		expect(result.authenticated).toBe(false);
		expect(result.error).toBe('Invalid or missing authentication credentials');
	});

	it('rejects JWTs with invalid audience or issuer', async () => {
		const { publicKey, privateKey } = await generateKeyPair('RS256');
		const publicJwk = await exportJWK(publicKey);
		publicJwk.kid = 'test-key-id';
		publicJwk.alg = 'RS256';

		const localJwks = createLocalJWKSet({ keys: [publicJwk] });
		const validator = new CloudflareAccessValidator(testConfig, { keyResolver: localJwks });

		const badAudJwt = await new SignJWT({ sub: 'user-123' })
			.setProtectedHeader({ alg: 'RS256', kid: 'test-key-id' })
			.setIssuer(testConfig.cfAccessTeamDomain)
			.setAudience('wrong-aud')
			.setIssuedAt()
			.setExpirationTime('10m')
			.sign(privateKey);

		const resultBadAud = await validator.validateRequest({ [CF_ACCESS_HEADER]: badAudJwt });
		expect(resultBadAud.authenticated).toBe(false);
		expect(resultBadAud.error).toBe('Invalid or missing authentication credentials');

		const badIssJwt = await new SignJWT({ sub: 'user-123' })
			.setProtectedHeader({ alg: 'RS256', kid: 'test-key-id' })
			.setIssuer('https://wrong-team.cloudflareaccess.com')
			.setAudience(testConfig.cfAccessAud)
			.setIssuedAt()
			.setExpirationTime('10m')
			.sign(privateKey);

		const resultBadIss = await validator.validateRequest({ [CF_ACCESS_HEADER]: badIssJwt });
		expect(resultBadIss.authenticated).toBe(false);
		expect(resultBadIss.error).toBe('Invalid or missing authentication credentials');
	});

	it('rejects malformed JWT strings', async () => {
		const validator = new CloudflareAccessValidator(testConfig);
		const result = await validator.validateRequest({ [CF_ACCESS_HEADER]: 'malformed.token.here' });
		expect(result.authenticated).toBe(false);
		expect(result.error).toBe('Invalid or missing authentication credentials');
	});

	it('fails gracefully when key resolver throws Error or non-Error value', async () => {
		const { privateKey } = await generateKeyPair('RS256');
		const validStructureJwt = await new SignJWT({ sub: 'user-123' })
			.setProtectedHeader({ alg: 'RS256', kid: 'test-key-id' })
			.setIssuer('https://test-team.cloudflareaccess.com')
			.setAudience('test-aud-tag')
			.setIssuedAt()
			.setExpirationTime('10m')
			.sign(privateKey);

		const validatorWithoutDomain = new CloudflareAccessValidator({
			...testConfig,
			cfAccessTeamDomain: '',
		});
		const result = await validatorWithoutDomain.validateRequest({
			[CF_ACCESS_HEADER]: validStructureJwt,
		});
		expect(result.authenticated).toBe(false);
		expect(result.error).toBe('Invalid or missing authentication credentials');

		const nonErrorThrowingValidator = new CloudflareAccessValidator(testConfig, {
			keyResolver: () => {
				throw 'raw string thrown';
			},
		});
		const nonErrorResult = await nonErrorThrowingValidator.validateRequest({
			[CF_ACCESS_HEADER]: validStructureJwt,
		});
		expect(nonErrorResult.authenticated).toBe(false);
		expect(nonErrorResult.error).toBe('Invalid or missing authentication credentials');
	});
});
