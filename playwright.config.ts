// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

const caCertPath = process.env.PLAYGROUND_CA_CERT || join(tmpdir(), 'dicechess-playground-ca.pem');

export default defineConfig({
	testDir: 'e2e',
	fullyParallel: false,
	workers: process.env.CI ? 1 : undefined,
	reporter: [['list'], ['html', { open: 'never' }]],
	use: {
		baseURL: 'http://127.0.0.1:3000',
		trace: 'retain-on-failure',
	},
	webServer: [
		{
			command: 'node tests/fixtures/playground/server.js',
			url: 'http://127.0.0.1:8088/health',
			reuseExistingServer: !process.env.CI,
			timeout: 30_000,
			env: {
				...process.env,
				FIXTURE_EVALUATOR_PORT: '8088',
				FIXTURE_JWKS_PORT: '8443',
				EVALUATOR_BEARER_TOKEN: 'e2e-evaluator-token',
				CF_ACCESS_TEAM_DOMAIN: 'https://127.0.0.1:8443',
				CF_ACCESS_AUD: 'e2e-aud-tag',
				PLAYGROUND_CA_CERT: caCertPath,
			},
		},
		{
			command: 'npm run build && npm run start',
			url: 'http://127.0.0.1:3000/health',
			reuseExistingServer: !process.env.CI,
			timeout: 120_000,
			env: {
				...process.env,
				NODE_ENV: 'production',
				NODE_EXTRA_CA_CERTS: caCertPath,
				HOST: '127.0.0.1',
				PORT: '3000',
				BODY_SIZE_LIMIT: '64K',
				APP_VERSION: 'e2e',
				PUBLIC_SOURCE_REVISION: '0123456789abcdef0123456789abcdef01234567',
				EVALUATOR_ORIGIN: 'http://127.0.0.1:8088',
				EVALUATOR_BEARER_TOKEN: 'e2e-evaluator-token',
				CF_ACCESS_TEAM_DOMAIN: 'https://127.0.0.1:8443',
				CF_ACCESS_AUD: 'e2e-aud-tag',
				ALLOW_DEV_AUTH_BYPASS: 'false',
			},
		},
	],
});
