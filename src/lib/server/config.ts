// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

export interface ServerConfig {
	evaluatorOrigin: string;
	evaluatorBearerToken: string;
	cfAccessTeamDomain: string;
	cfAccessAud: string;
	allowDevAuthBypass: boolean;
	maxRequestBodyBytes: number;
	evaluatorTimeoutMs: number;
	maxConcurrentEvaluations: number;
	nodeEnv: string;
}

const DEFAULT_MAX_REQUEST_BODY_BYTES = 64 * 1024; // 64 KB
const DEFAULT_EVALUATOR_TIMEOUT_MS = 5000; // 5 seconds
const DEFAULT_MAX_CONCURRENT_EVALUATIONS = 4;

function parsePositiveInteger(
	value: string | undefined,
	defaultValue: number,
	name: string,
): number {
	if (value === undefined || value.trim() === '') {
		return defaultValue;
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`Invalid ${name}: expected a positive integer, got '${value}'`);
	}
	return parsed;
}

export function parseByteSize(
	value: string | undefined,
	defaultValue: number,
	name: string,
): number {
	if (value === undefined || value.trim() === '') {
		return defaultValue;
	}
	const trimmed = value.trim();
	const match = /^(\d+)\s*(k|kb|m|mb|b)?$/i.exec(trimmed);
	if (!match) {
		throw new Error(
			`Invalid ${name}: expected a positive integer or byte size string, got '${value}'`,
		);
	}
	const num = Number(match[1]);
	if (!Number.isInteger(num) || num <= 0) {
		throw new Error(
			`Invalid ${name}: expected a positive integer or byte size string, got '${value}'`,
		);
	}
	const unit = match[2]?.toLowerCase();
	if (unit === 'k' || unit === 'kb') {
		return num * 1024;
	}
	if (unit === 'm' || unit === 'mb') {
		return num * 1024 * 1024;
	}
	return num;
}

function parseBoolean(value: string | undefined): boolean {
	if (!value) return false;
	const normalized = value.trim().toLowerCase();
	return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function normalizeOrigin(origin: string, name: string): string {
	const trimmed = origin.trim();
	if (!trimmed) {
		throw new Error(`${name} cannot be empty`);
	}
	try {
		const url = new URL(trimmed);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			throw new Error(`${name} must use http or https protocol`);
		}
		// Strip trailing slashes
		return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
	} catch (error) {
		if (error instanceof Error && error.message.includes('protocol')) {
			throw error;
		}
		throw new Error(`Invalid URL for ${name}: '${trimmed}'`, { cause: error });
	}
}

function normalizeTeamDomain(teamDomain: string): string {
	const trimmed = teamDomain.trim();
	if (!trimmed) {
		throw new Error('CF_ACCESS_TEAM_DOMAIN cannot be empty');
	}
	const withProtocol =
		trimmed.startsWith('http://') || trimmed.startsWith('https://')
			? trimmed
			: `https://${trimmed}`;
	try {
		const url = new URL(withProtocol);
		return `${url.protocol}//${url.host}`;
	} catch (error) {
		throw new Error(`Invalid CF_ACCESS_TEAM_DOMAIN: '${trimmed}'`, { cause: error });
	}
}

/**
 * Loads and validates server configuration from runtime environment variables.
 */
export function loadServerConfig(
	env: Record<string, string | undefined> = process.env,
): ServerConfig {
	const nodeEnv = env.NODE_ENV ?? 'development';
	const allowDevAuthBypass = parseBoolean(env.ALLOW_DEV_AUTH_BYPASS);

	if (nodeEnv === 'production' && allowDevAuthBypass) {
		throw new Error('ALLOW_DEV_AUTH_BYPASS cannot be enabled in production');
	}

	const evaluatorOriginRaw =
		env.EVALUATOR_ORIGIN ?? (nodeEnv === 'test' ? 'http://127.0.0.1:8080' : '');
	if (!evaluatorOriginRaw) {
		throw new Error('EVALUATOR_ORIGIN environment variable is required');
	}
	const evaluatorOrigin = normalizeOrigin(evaluatorOriginRaw, 'EVALUATOR_ORIGIN');

	const evaluatorBearerToken =
		env.EVALUATOR_BEARER_TOKEN ?? (nodeEnv === 'test' ? 'test-token' : '');
	if (!evaluatorBearerToken || evaluatorBearerToken.trim() === '') {
		throw new Error('EVALUATOR_BEARER_TOKEN environment variable is required');
	}

	let cfAccessTeamDomain = '';
	let cfAccessAud = '';

	const teamDomainRaw = env.CF_ACCESS_TEAM_DOMAIN ?? env.CLOUDFLARE_ACCESS_TEAM_DOMAIN;
	const audRaw = env.CF_ACCESS_AUD ?? env.CLOUDFLARE_ACCESS_AUD;

	if (teamDomainRaw) {
		cfAccessTeamDomain = normalizeTeamDomain(teamDomainRaw);
	} else if (!allowDevAuthBypass) {
		throw new Error(
			'CF_ACCESS_TEAM_DOMAIN environment variable is required when auth bypass is disabled',
		);
	}

	if (audRaw && audRaw.trim() !== '') {
		cfAccessAud = audRaw.trim();
	} else if (!allowDevAuthBypass) {
		throw new Error('CF_ACCESS_AUD environment variable is required when auth bypass is disabled');
	}

	const maxRequestBodyBytes = parseByteSize(
		env.MAX_REQUEST_BODY_BYTES ?? env.BODY_SIZE_LIMIT,
		DEFAULT_MAX_REQUEST_BODY_BYTES,
		'MAX_REQUEST_BODY_BYTES',
	);

	const evaluatorTimeoutMs = parsePositiveInteger(
		env.EVALUATOR_TIMEOUT_MS,
		DEFAULT_EVALUATOR_TIMEOUT_MS,
		'EVALUATOR_TIMEOUT_MS',
	);

	const maxConcurrentEvaluations = parsePositiveInteger(
		env.MAX_CONCURRENT_EVALUATIONS,
		DEFAULT_MAX_CONCURRENT_EVALUATIONS,
		'MAX_CONCURRENT_EVALUATIONS',
	);

	return {
		evaluatorOrigin,
		evaluatorBearerToken: evaluatorBearerToken.trim(),
		cfAccessTeamDomain,
		cfAccessAud,
		allowDevAuthBypass,
		maxRequestBodyBytes,
		evaluatorTimeoutMs,
		maxConcurrentEvaluations,
		nodeEnv,
	};
}
