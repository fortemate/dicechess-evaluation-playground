// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { loadServerConfig, parseByteSize } from './config.js';

describe('parseByteSize', () => {
	it('returns default value when input is undefined or blank', () => {
		expect(parseByteSize(undefined, 65536, 'SIZE')).toBe(65536);
		expect(parseByteSize('   ', 65536, 'SIZE')).toBe(65536);
	});

	it('parses raw numbers and numbers with B suffix', () => {
		expect(parseByteSize('1024', 65536, 'SIZE')).toBe(1024);
		expect(parseByteSize('2048b', 65536, 'SIZE')).toBe(2048);
		expect(parseByteSize('4096B', 65536, 'SIZE')).toBe(4096);
	});

	it('parses kilobytes (K, KB)', () => {
		expect(parseByteSize('64K', 65536, 'SIZE')).toBe(65536);
		expect(parseByteSize('32kb', 65536, 'SIZE')).toBe(32768);
		expect(parseByteSize('  16 KB  ', 65536, 'SIZE')).toBe(16384);
	});

	it('parses megabytes (M, MB)', () => {
		expect(parseByteSize('1M', 65536, 'SIZE')).toBe(1048576);
		expect(parseByteSize('2mb', 65536, 'SIZE')).toBe(2097152);
		expect(parseByteSize('  4 MB ', 65536, 'SIZE')).toBe(4194304);
	});

	it('throws on non-positive or malformed values', () => {
		expect(() => parseByteSize('0', 65536, 'SIZE')).toThrow('Invalid SIZE');
		expect(() => parseByteSize('-10K', 65536, 'SIZE')).toThrow('Invalid SIZE');
		expect(() => parseByteSize('abc', 65536, 'SIZE')).toThrow('Invalid SIZE');
		expect(() => parseByteSize('64GB', 65536, 'SIZE')).toThrow('Invalid SIZE');
	});
});

describe('loadServerConfig', () => {
	const validEnv = {
		NODE_ENV: 'test',
		EVALUATOR_ORIGIN: 'http://127.0.0.1:8080',
		EVALUATOR_BEARER_TOKEN: 'secret-token',
		CF_ACCESS_TEAM_DOMAIN: 'https://test-team.cloudflareaccess.com',
		CF_ACCESS_AUD: 'test-aud-tag',
		ALLOW_DEV_AUTH_BYPASS: 'false',
		MAX_REQUEST_BODY_BYTES: '32768',
		EVALUATOR_TIMEOUT_MS: '4000',
		MAX_CONCURRENT_EVALUATIONS: '2',
	};

	it('loads valid configuration successfully', () => {
		const config = loadServerConfig(validEnv);
		expect(config).toEqual({
			evaluatorOrigin: 'http://127.0.0.1:8080',
			evaluatorBearerToken: 'secret-token',
			cfAccessTeamDomain: 'https://test-team.cloudflareaccess.com',
			cfAccessAud: 'test-aud-tag',
			allowDevAuthBypass: false,
			maxRequestBodyBytes: 32768,
			evaluatorTimeoutMs: 4000,
			maxConcurrentEvaluations: 2,
			nodeEnv: 'test',
		});
	});

	it('defaults nodeEnv to development when undefined', () => {
		const config = loadServerConfig({
			NODE_ENV: undefined,
			EVALUATOR_ORIGIN: 'http://localhost:8080',
			EVALUATOR_BEARER_TOKEN: 'token',
			CF_ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
			CF_ACCESS_AUD: 'aud',
		});
		expect(config.nodeEnv).toBe('development');
	});

	it('uses test environment defaults for origin and bearer token when nodeEnv is test', () => {
		const config = loadServerConfig({
			NODE_ENV: 'test',
			CF_ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
			CF_ACCESS_AUD: 'aud',
		});
		expect(config.evaluatorOrigin).toBe('http://127.0.0.1:8080');
		expect(config.evaluatorBearerToken).toBe('test-token');
	});

	it('supports legacy / alternative environment variable names for team domain, aud, and body limit', () => {
		const config = loadServerConfig({
			NODE_ENV: 'development',
			EVALUATOR_ORIGIN: 'https://evaluator.internal:9000/',
			EVALUATOR_BEARER_TOKEN: 'token-xyz',
			CLOUDFLARE_ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
			CLOUDFLARE_ACCESS_AUD: 'aud-xyz',
			BODY_SIZE_LIMIT: '16384',
		});

		expect(config.evaluatorOrigin).toBe('https://evaluator.internal:9000');
		expect(config.cfAccessTeamDomain).toBe('https://example.cloudflareaccess.com');
		expect(config.cfAccessAud).toBe('aud-xyz');
		expect(config.maxRequestBodyBytes).toBe(16384);
		expect(config.evaluatorTimeoutMs).toBe(5000);
		expect(config.maxConcurrentEvaluations).toBe(4);
		expect(config.allowDevAuthBypass).toBe(false);
	});

	it('applies default limits when optional numeric variables are omitted', () => {
		const config = loadServerConfig({
			NODE_ENV: 'development',
			EVALUATOR_ORIGIN: 'https://evaluator.internal:9000/',
			EVALUATOR_BEARER_TOKEN: 'token-xyz',
			CF_ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
			CF_ACCESS_AUD: 'aud-xyz',
		});

		expect(config.maxRequestBodyBytes).toBe(65536);
		expect(config.evaluatorTimeoutMs).toBe(5000);
		expect(config.maxConcurrentEvaluations).toBe(4);
	});

	it('supports boolean bypass parsing for "true", "1", and "yes"', () => {
		expect(
			loadServerConfig({
				...validEnv,
				ALLOW_DEV_AUTH_BYPASS: 'true',
			}).allowDevAuthBypass,
		).toBe(true);

		expect(
			loadServerConfig({
				...validEnv,
				ALLOW_DEV_AUTH_BYPASS: '1',
			}).allowDevAuthBypass,
		).toBe(true);

		expect(
			loadServerConfig({
				...validEnv,
				ALLOW_DEV_AUTH_BYPASS: 'yes',
			}).allowDevAuthBypass,
		).toBe(true);

		expect(
			loadServerConfig({
				...validEnv,
				ALLOW_DEV_AUTH_BYPASS: 'no',
			}).allowDevAuthBypass,
		).toBe(false);

		expect(
			loadServerConfig({
				...validEnv,
				ALLOW_DEV_AUTH_BYPASS: undefined,
			}).allowDevAuthBypass,
		).toBe(false);
	});

	it('throws an error if ALLOW_DEV_AUTH_BYPASS is enabled in production', () => {
		expect(() =>
			loadServerConfig({
				...validEnv,
				NODE_ENV: 'production',
				ALLOW_DEV_AUTH_BYPASS: 'true',
			}),
		).toThrow('ALLOW_DEV_AUTH_BYPASS cannot be enabled in production');
	});

	it('throws an error if EVALUATOR_ORIGIN is missing', () => {
		expect(() =>
			loadServerConfig({
				...validEnv,
				NODE_ENV: 'development',
				EVALUATOR_ORIGIN: undefined,
			}),
		).toThrow('EVALUATOR_ORIGIN environment variable is required');

		expect(() =>
			loadServerConfig({
				...validEnv,
				EVALUATOR_ORIGIN: '   ',
			}),
		).toThrow('EVALUATOR_ORIGIN cannot be empty');
	});

	it('throws an error if EVALUATOR_ORIGIN uses invalid protocol or invalid URL', () => {
		expect(() =>
			loadServerConfig({
				...validEnv,
				EVALUATOR_ORIGIN: 'ftp://localhost:8080',
			}),
		).toThrow('EVALUATOR_ORIGIN must use http or https protocol');

		expect(() =>
			loadServerConfig({
				...validEnv,
				EVALUATOR_ORIGIN: 'not-a-url',
			}),
		).toThrow('Invalid URL for EVALUATOR_ORIGIN');
	});

	it('throws an error if EVALUATOR_BEARER_TOKEN is missing or blank', () => {
		expect(() =>
			loadServerConfig({
				...validEnv,
				NODE_ENV: 'development',
				EVALUATOR_BEARER_TOKEN: undefined,
			}),
		).toThrow('EVALUATOR_BEARER_TOKEN environment variable is required');

		expect(() =>
			loadServerConfig({
				...validEnv,
				EVALUATOR_BEARER_TOKEN: '   ',
			}),
		).toThrow('EVALUATOR_BEARER_TOKEN environment variable is required');
	});

	it('throws an error if CF_ACCESS_TEAM_DOMAIN is missing when auth bypass is disabled', () => {
		expect(() =>
			loadServerConfig({
				...validEnv,
				CF_ACCESS_TEAM_DOMAIN: undefined,
				CLOUDFLARE_ACCESS_TEAM_DOMAIN: undefined,
			}),
		).toThrow(
			'CF_ACCESS_TEAM_DOMAIN environment variable is required when auth bypass is disabled',
		);

		expect(() =>
			loadServerConfig({
				...validEnv,
				CF_ACCESS_TEAM_DOMAIN: '   ',
				CLOUDFLARE_ACCESS_TEAM_DOMAIN: undefined,
			}),
		).toThrow('CF_ACCESS_TEAM_DOMAIN cannot be empty');

		expect(() =>
			loadServerConfig({
				...validEnv,
				CF_ACCESS_TEAM_DOMAIN: 'http://',
			}),
		).toThrow('Invalid CF_ACCESS_TEAM_DOMAIN');

		expect(() =>
			loadServerConfig({
				...validEnv,
				CF_ACCESS_TEAM_DOMAIN: 'http://insecure-team.cloudflareaccess.com',
			}),
		).toThrow('CF_ACCESS_TEAM_DOMAIN must use https protocol');
	});

	it('throws an error if CF_ACCESS_AUD is missing when auth bypass is disabled', () => {
		expect(() =>
			loadServerConfig({
				...validEnv,
				CF_ACCESS_AUD: undefined,
				CLOUDFLARE_ACCESS_AUD: undefined,
			}),
		).toThrow('CF_ACCESS_AUD environment variable is required when auth bypass is disabled');

		expect(() =>
			loadServerConfig({
				...validEnv,
				CF_ACCESS_AUD: '   ',
				CLOUDFLARE_ACCESS_AUD: undefined,
			}),
		).toThrow('CF_ACCESS_AUD environment variable is required when auth bypass is disabled');
	});

	it('allows omitting CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD when dev auth bypass is enabled', () => {
		const config = loadServerConfig({
			NODE_ENV: 'development',
			EVALUATOR_ORIGIN: 'http://localhost:8080',
			EVALUATOR_BEARER_TOKEN: 'token',
			ALLOW_DEV_AUTH_BYPASS: 'true',
		});
		expect(config.allowDevAuthBypass).toBe(true);
		expect(config.cfAccessTeamDomain).toBe('');
		expect(config.cfAccessAud).toBe('');
	});

	it('throws an error for invalid numeric configuration values', () => {
		expect(() =>
			loadServerConfig({
				...validEnv,
				EVALUATOR_TIMEOUT_MS: 'abc',
			}),
		).toThrow('Invalid EVALUATOR_TIMEOUT_MS: expected a positive integer');

		expect(() =>
			loadServerConfig({
				...validEnv,
				EVALUATOR_TIMEOUT_MS: '-5',
			}),
		).toThrow('Invalid EVALUATOR_TIMEOUT_MS: expected a positive integer');

		expect(() =>
			loadServerConfig({
				...validEnv,
				MAX_CONCURRENT_EVALUATIONS: '0',
			}),
		).toThrow('Invalid MAX_CONCURRENT_EVALUATIONS: expected a positive integer');
	});
});
