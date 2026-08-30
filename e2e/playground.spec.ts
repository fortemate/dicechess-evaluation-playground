// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from '@playwright/test';

const sourceRevision = '0123456789abcdef0123456789abcdef01234567';
const repositoryUrl = 'https://github.com/fortemate/dicechess-evaluation-playground';

test('serves the adapter-node application and health endpoint', async ({ page, request }) => {
	await page.goto('/');

	await expect(page.getByRole('heading', { name: 'Evaluation Playground' })).toBeVisible();
	await expect(page.getByText('Engineering baseline ready')).toBeVisible();
	await expect(page.getByText('© 2026 Jegors Čemisovs')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Source code' })).toHaveAttribute(
		'href',
		`${repositoryUrl}/tree/${sourceRevision}`,
	);
	await expect(page.getByRole('link', { name: 'AGPL-3.0-only' })).toHaveAttribute(
		'href',
		`${repositoryUrl}/blob/${sourceRevision}/LICENSE`,
	);

	const healthResponse = await request.get('/health');
	expect(healthResponse.ok()).toBe(true);
	await expect(healthResponse.json()).resolves.toEqual({
		status: 'ok',
		service: 'dicechess-evaluation-playground',
	});
});
