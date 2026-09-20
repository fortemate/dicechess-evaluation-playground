// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Page } from '@playwright/test';

const sourceRevision = '0123456789abcdef0123456789abcdef01234567';
const repositoryUrl = 'https://github.com/fortemate/dicechess-evaluation-playground';

/**
 * Chessground caches the board rectangle and refreshes it from a scroll listener
 * one frame after the browser scrolls (which focus() and Playwright clicks may do).
 * Wait two frames so pointer coordinates map to the squares actually on screen.
 */
async function settleBoard(page: Page): Promise<void> {
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);
}

async function centerOf(page: Page, name: string): Promise<{ x: number; y: number }> {
	const box = await page.getByRole('gridcell', { name }).boundingBox();
	if (!box) throw new Error(`Square "${name}" has no bounding box`);
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('serves the adapter-node application and health endpoint', async ({ page, request }) => {
	const evaluationRequests: string[] = [];
	page.on('request', (browserRequest) => {
		const url = new URL(browserRequest.url());
		if (url.pathname.includes('evaluat')) evaluationRequests.push(url.pathname);
	});

	await page.goto('/');

	await expect(page.getByRole('heading', { name: 'Evaluation Playground' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Build a test position' })).toBeAttached();
	const board = page.getByRole('grid', { name: 'Editable Dice Chess board' });
	await expect(board).toBeVisible();
	await expect(page.getByRole('gridcell')).toHaveCount(64);
	await expect(page.getByText('© 2026 Jegors Čemisovs')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Source code' })).toHaveAttribute(
		'href',
		`${repositoryUrl}/tree/${sourceRevision}`,
	);
	await expect(page.getByRole('link', { name: 'AGPL-3.0-only' })).toHaveAttribute(
		'href',
		`${repositoryUrl}/blob/${sourceRevision}/LICENSE`,
	);

	const fenInput = page.getByLabel('FEN', { exact: true });
	await fenInput.fill('8/8/8/8/8/8/8/K6k b qK e3a3 0 1');
	await fenInput.press('Enter');
	await expect(fenInput).toHaveValue('8/8/8/8/8/8/8/K6k b Kq a3e3');

	// Stamp a black knight on b4 from the spare-piece palette.
	const blackKnight = page.getByRole('button', { name: 'Black knight' });
	await blackKnight.click();
	await expect(blackKnight).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('gridcell', { name: 'b4, empty' }).click();
	await expect(fenInput).toHaveValue('8/8/8/8/1n6/8/8/K6k b Kq a3e3');
	await expect(page.locator('cg-board piece.black.knight')).toHaveCount(1);

	// Move it to c6 with the keyboard board: Enter picks up, arrows navigate, Enter drops.
	const moveTool = page.getByRole('button', { name: 'Move', exact: true });
	await moveTool.click();
	await expect(moveTool).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('gridcell', { name: 'b4, black knight' }).focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('gridcell', { name: 'b4, black knight, picked up' })).toBeFocused();
	await page.keyboard.press('ArrowUp');
	await page.keyboard.press('ArrowUp');
	await page.keyboard.press('ArrowRight');
	await expect(page.getByRole('gridcell', { name: 'c6, empty' })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(fenInput).toHaveValue('8/8/2n5/8/8/8/8/K6k b Kq a3e3');

	// Drag the knight off the board to remove it.
	await settleBoard(page);
	const knightCenter = await centerOf(page, 'c6, black knight');
	const boardBox = await board.boundingBox();
	if (!boardBox) throw new Error('The board has no bounding box');
	await page.mouse.move(knightCenter.x, knightCenter.y);
	await page.mouse.down();
	await page.mouse.move(boardBox.x + boardBox.width / 2, boardBox.y - 120, { steps: 12 });
	await page.mouse.up();
	await expect(fenInput).toHaveValue('8/8/8/8/8/8/8/K6k b Kq a3e3');
	await expect(page.locator('cg-board piece.black.knight')).toHaveCount(0);

	// The Erase tool removes pieces by click; Escape returns to the Move tool.
	const eraseTool = page.getByRole('button', { name: 'Erase' });
	await eraseTool.click();
	await expect(eraseTool).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('gridcell', { name: 'a1, white king' }).click();
	await expect(fenInput).toHaveValue('8/8/8/8/8/8/8/7k b Kq a3e3');
	await page.keyboard.press('Escape');
	await expect(moveTool).toHaveAttribute('aria-pressed', 'true');

	await fenInput.fill('invalid position');
	await page.getByRole('button', { name: 'Import' }).click();
	await expect(page.getByRole('alert')).toContainText('expected 4 or 6 fields');
	await expect(fenInput).toBeFocused();
	// The draft keeps the rejected text for correction; the committed position is untouched and
	// evaluation stays blocked until the draft is fixed or re-imported.
	await expect(fenInput).toHaveValue('invalid position');
	await expect(page.locator('cg-board piece')).toHaveCount(1);
	await expect(page.locator('cg-board piece.black.king')).toHaveCount(1);
	await expect(page.getByRole('button', { name: 'Evaluate position' })).toBeDisabled();
	await expect.poll(() => evaluationRequests).toEqual([]);

	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.getByTestId('editor-layout')).toBeVisible();
	// Chessground resizes its container from a ResizeObserver callback, which runs in the
	// rendering pipeline after this synchronous measurement would otherwise happen.
	await expect
		.poll(() =>
			page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			),
		)
		.toBe(false);

	const healthResponse = await request.get('/health');
	expect(healthResponse.ok()).toBe(true);
	await expect(healthResponse.json()).resolves.toEqual({
		status: 'ok',
		service: 'dicechess-evaluation-playground',
	});

	const unauthenticatedEvaluateResponse = await request.post('/api/evaluate', {
		data: { fen: '8/8/8/8/8/8/8/K6k w - -' },
	});
	expect(unauthenticatedEvaluateResponse.status()).toBe(401);
	await expect(unauthenticatedEvaluateResponse.json()).resolves.toMatchObject({
		code: 'AUTHENTICATION_FAILURE',
	});
});
