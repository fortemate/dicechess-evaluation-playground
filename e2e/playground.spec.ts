// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from '@playwright/test';

const sourceRevision = '0123456789abcdef0123456789abcdef01234567';
const repositoryUrl = 'https://github.com/fortemate/dicechess-evaluation-playground';

test('serves the adapter-node application and health endpoint', async ({ page, request }) => {
	const evaluationRequests: string[] = [];
	page.on('request', (browserRequest) => {
		const url = new URL(browserRequest.url());
		if (url.pathname.includes('evaluat')) evaluationRequests.push(url.pathname);
	});

	await page.goto('/');

	await expect(page.getByRole('heading', { name: 'Evaluation Playground' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Build a test position' })).toBeVisible();
	await expect(page.getByRole('img', { name: 'Editable Dice Chess board' })).toBeVisible();
	await expect(page.getByText('© 2026 Jegors Čemisovs')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Source code' })).toHaveAttribute(
		'href',
		`${repositoryUrl}/tree/${sourceRevision}`,
	);
	await expect(page.getByRole('link', { name: 'AGPL-3.0-only' })).toHaveAttribute(
		'href',
		`${repositoryUrl}/blob/${sourceRevision}/LICENSE`,
	);

	const fenInput = page.getByLabel('Import FEN');
	const canonicalFen = page.getByRole('status');
	await fenInput.fill('8/8/8/8/8/8/8/K6k b qK e3a3 0 1');
	await fenInput.press('Enter');
	await expect(canonicalFen).toHaveText('8/8/8/8/8/8/8/K6k b Kq a3e3');

	await page.getByLabel('Piece').selectOption('n');
	await page.locator('#square-to-edit').selectOption('b4');
	await page.getByRole('button', { name: 'Place piece' }).click();
	await expect(canonicalFen).toHaveText('8/8/8/8/1n6/8/8/K6k b Kq a3e3');
	await expect(page.locator('piece.black.knight')).toHaveCount(1);

	await page.getByLabel('From square').selectOption('b4');
	await page.getByLabel('To square').selectOption('c6');
	await page.getByRole('button', { name: 'Move piece', exact: true }).press('Enter');
	await expect(canonicalFen).toHaveText('8/8/2n5/8/8/8/8/K6k b Kq a3e3');

	await fenInput.fill('invalid position');
	await page.getByRole('button', { name: 'Import' }).click();
	await expect(page.getByRole('alert')).toContainText('expected 4 or 6 fields');
	await expect(fenInput).toBeFocused();
	await expect(canonicalFen).toHaveText('8/8/2n5/8/8/8/8/K6k b Kq a3e3');
	await expect.poll(() => evaluationRequests).toEqual([]);

	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.getByTestId('editor-layout')).toBeVisible();
	const hasHorizontalOverflow = await page.evaluate(
		() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
	);
	expect(hasHorizontalOverflow).toBe(false);

	const healthResponse = await request.get('/health');
	expect(healthResponse.ok()).toBe(true);
	await expect(healthResponse.json()).resolves.toEqual({
		status: 'ok',
		service: 'dicechess-evaluation-playground',
	});
});
