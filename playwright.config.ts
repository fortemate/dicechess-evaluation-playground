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
	webServer: {
		command: 'npm run build && npm run start',
		url: 'http://127.0.0.1:3000/health',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		env: {
			...process.env,
			HOST: '127.0.0.1',
			PORT: '3000',
			BODY_SIZE_LIMIT: '64K',
			APP_VERSION: 'e2e',
			PUBLIC_SOURCE_REVISION: '0123456789abcdef0123456789abcdef01234567',
		},
	},
});
