import { expect, test } from '@playwright/test';

test('serves the adapter-node application and health endpoint', async ({ page, request }) => {
	await page.goto('/');

	await expect(page.getByRole('heading', { name: 'Evaluation Playground' })).toBeVisible();
	await expect(page.getByText('Engineering baseline ready')).toBeVisible();

	const healthResponse = await request.get('/health');
	expect(healthResponse.ok()).toBe(true);
	await expect(healthResponse.json()).resolves.toEqual({
		status: 'ok',
		service: 'dicechess-evaluation-playground',
	});
});
