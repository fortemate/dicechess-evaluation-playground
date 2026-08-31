// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { ServerConfig } from './config.js';

export const CF_ACCESS_HEADER = 'cf-access-jwt-assertion';

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

export interface AuthResult {
	authenticated: boolean;
	error?: string;
	subject?: string;
	email?: string;
}

export function isLoopbackAddress(address: string | undefined): boolean {
	if (!address) return false;
	const trimmed = address.trim().toLowerCase();
	return LOOPBACK_ADDRESSES.has(trimmed);
}

export type KeyResolver = JWTVerifyGetKey;

export interface AccessValidatorOptions {
	keyResolver?: KeyResolver;
}

export class CloudflareAccessValidator {
	private readonly config: ServerConfig;
	private readonly keyResolver: KeyResolver;

	constructor(config: ServerConfig, options?: AccessValidatorOptions) {
		this.config = config;
		if (options?.keyResolver) {
			this.keyResolver = options.keyResolver;
		} else if (config.cfAccessTeamDomain) {
			const jwksUrl = new URL(`${config.cfAccessTeamDomain}/cdn-cgi/access/certs`);
			this.keyResolver = createRemoteJWKSet(jwksUrl);
		} else {
			this.keyResolver = async () => {
				throw new Error('JWKS key resolver not configured');
			};
		}
	}

	async validateRequest(
		headers: Headers | Record<string, string | undefined>,
		clientAddress?: string,
	): Promise<AuthResult> {
		if (this.config.allowDevAuthBypass) {
			if (isLoopbackAddress(clientAddress)) {
				return { authenticated: true, subject: 'dev-loopback' };
			}
			return {
				authenticated: false,
				error: 'Development authentication bypass is only permitted from loopback addresses',
			};
		}

		let token: string | undefined;
		if (headers instanceof Headers) {
			token = headers.get(CF_ACCESS_HEADER) ?? undefined;
		} else {
			for (const [key, value] of Object.entries(headers)) {
				if (key.toLowerCase() === CF_ACCESS_HEADER) {
					token = value;
					break;
				}
			}
		}

		if (!token || token.trim() === '') {
			return {
				authenticated: false,
				error: 'Missing required Cf-Access-Jwt-Assertion header',
			};
		}

		try {
			const { payload } = await jwtVerify(token.trim(), this.keyResolver, {
				issuer: this.config.cfAccessTeamDomain,
				audience: this.config.cfAccessAud,
				algorithms: ['RS256'],
			});

			return {
				authenticated: true,
				subject: payload.sub,
				email: typeof payload.email === 'string' ? payload.email : undefined,
			};
		} catch {
			return {
				authenticated: false,
				error: 'Invalid or missing authentication credentials',
			};
		}
	}
}
