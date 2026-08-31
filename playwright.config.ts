// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

import { defineConfig } from '@playwright/test';

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
		},
		{
			command: 'npm run build && npm run start',
			url: 'http://127.0.0.1:3000/health',
			reuseExistingServer: !process.env.CI,
			timeout: 120_000,
			env: {
				...process.env,
				NODE_ENV: 'production',
				NODE_TLS_REJECT_UNAUTHORIZED: '0',
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
