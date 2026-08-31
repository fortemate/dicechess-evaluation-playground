// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

import { Buffer } from 'node:buffer';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { expect, test } from '@playwright/test';

const EVALUATOR_ORIGIN = 'http://127.0.0.1:8088';
const EVALUATOR_BEARER_TOKEN = 'e2e-evaluator-token';
const MODEL_ID = 'dicechess-v1-test';
const MODEL_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

interface TestTokenOptions {
	expired?: boolean;
	badAudience?: boolean;
	badIssuer?: boolean;
	sub?: string;
	email?: string;
}

async function fetchTestJwt(options?: TestTokenOptions): Promise<string> {
	const url = new URL(`${EVALUATOR_ORIGIN}/test/token`);
	if (options?.expired) url.searchParams.set('expired', 'true');
	if (options?.badAudience) url.searchParams.set('badAudience', 'true');
	if (options?.badIssuer) url.searchParams.set('badIssuer', 'true');
	if (options?.sub) url.searchParams.set('sub', options.sub);
	if (options?.email) url.searchParams.set('email', options.email);

	const res = await fetch(url.toString());
	if (!res.ok) {
		throw new Error(`Failed to fetch test JWT from fixture: ${res.status} ${res.statusText}`);
	}
	const json = (await res.json()) as { token: string };
	return json.token;
}

async function resetFixtureStats(): Promise<void> {
	const response = await fetch(`${EVALUATOR_ORIGIN}/test/reset`, { method: 'POST' });
	if (!response.ok) {
		throw new Error(`Failed to reset evaluator fixture stats: ${response.status}`);
	}
}

async function getEvaluationRequestCount(): Promise<number> {
	const response = await fetch(`${EVALUATOR_ORIGIN}/test/stats`);
	if (!response.ok) {
		throw new Error(`Failed to read evaluator fixture stats: ${response.status}`);
	}
	const payload = (await response.json()) as { evaluationRequestCount?: unknown };
	if (
		typeof payload.evaluationRequestCount !== 'number' ||
		!Number.isInteger(payload.evaluationRequestCount)
	) {
		throw new Error('Evaluator fixture returned invalid stats');
	}
	return payload.evaluationRequestCount;
}

function getAllFiles(dir: string): string[] {
	let results: string[] = [];
	try {
		const list = readdirSync(dir);
		for (const file of list) {
			const filePath = join(dir, file);
			const stat = statSync(filePath);
			if (stat && stat.isDirectory()) {
				results = results.concat(getAllFiles(filePath));
			} else {
				results.push(filePath);
			}
		}
	} catch {
		// Directory may not exist if build hasn't run
	}
	return results;
}

test.describe('E2E Playground Evaluation Acceptance Flow', () => {
	test.beforeEach(async () => {
		await resetFixtureStats();
	});

	test('completes single-model position-to-evaluation flow with provenance, edits without requests, and stale tracking', async ({
		page,
	}) => {
		const validToken = await fetchTestJwt({
			sub: 'acceptance-tester',
			email: 'tester@fortemate.com',
		});

		await page.setExtraHTTPHeaders({
			'cf-access-jwt-assertion': validToken,
		});

		const evaluateRequests: string[] = [];
		const recordedBrowserRequests: {
			url: string;
			headers: Record<string, string>;
			postData: string | null;
		}[] = [];

		page.on('request', (browserRequest) => {
			const url = browserRequest.url();
			recordedBrowserRequests.push({
				url,
				headers: browserRequest.headers(),
				postData: browserRequest.postData(),
			});
			if (url.includes('/api/evaluate') || url.includes('/api/v1/evaluate')) {
				evaluateRequests.push(url);
			}
		});

		await page.goto('/');

		// Verify initial page load and idle evaluation panel state
		await expect(page.getByRole('heading', { name: 'Evaluation Playground' })).toBeVisible();
		const canonicalFen = page.getByRole('status');
		await expect(canonicalFen).toHaveText('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
		await expect(
			page.getByText('No evaluation has been requested for this position.'),
		).toBeVisible();

		// Step 1: Import a custom FEN with mixed castling and multiple en-passant squares
		const fenInput = page.getByLabel('Import FEN');
		await fenInput.fill('8/8/8/8/8/8/8/K6k b qK e3a3 0 1');
		await page.getByRole('button', { name: 'Import' }).click();
		await expect(canonicalFen).toHaveText('8/8/8/8/8/8/8/K6k b Kq a3e3');

		// Step 2: Place a black knight on b4
		await page.getByLabel('Piece').selectOption('n');
		await page.locator('#square-to-edit').selectOption('b4');
		await page.getByRole('button', { name: 'Place piece' }).click();
		await expect(canonicalFen).toHaveText('8/8/8/8/1n6/8/8/K6k b Kq a3e3');

		// Step 3: Move piece from b4 to c6 using keyboard controls
		await page.getByLabel('From square').selectOption('b4');
		await page.getByLabel('To square').selectOption('c6');
		await page.getByRole('button', { name: 'Move piece', exact: true }).click();
		await expect(canonicalFen).toHaveText('8/8/2n5/8/8/8/8/K6k b Kq a3e3');

		// Step 4: Change explicit side to move to White
		await page.getByRole('radio', { name: 'White' }).check();
		await expect(canonicalFen).toHaveText('8/8/2n5/8/8/8/8/K6k w Kq a3e3');

		// Step 5: Toggle off Black queenside castling right
		await page.getByRole('checkbox', { name: 'Black queenside' }).uncheck();
		await expect(canonicalFen).toHaveText('8/8/2n5/8/8/8/8/K6k w K a3e3');

		// Step 6: Update explicit en-passant target to c3
		const enPassantInput = page.getByLabel('En-passant target(s)');
		await enPassantInput.fill('c3');
		await page.getByRole('button', { name: 'Apply' }).click();
		const expectedFen = '8/8/2n5/8/8/8/8/K6k w K c3';
		await expect(canonicalFen).toHaveText(expectedFen);

		// Verify that all board and position editor interactions produced zero evaluation requests
		expect(evaluateRequests).toHaveLength(0);

		// Step 7: Explicitly submit evaluation once
		const evaluateButton = page.getByRole('button', { name: 'Evaluate position' });
		await evaluateButton.click();

		// Step 8: Verify evaluation result heading, probability, perspective, latency, and full provenance
		await expect(page.getByRole('heading', { name: 'Evaluation complete' })).toBeVisible();
		await expect(page.locator('.probability')).toHaveText('52.0%');

		const perspectiveValue = page.locator('dt:text-is("Perspective") + dd');
		await expect(perspectiveValue).toHaveText('White to move');

		const latencyValue = page.locator('dt:text-is("Latency") + dd');
		await expect(latencyValue).toContainText('ms');

		const correlationIdCode = page.locator('dt:text-is("Correlation ID") + dd code');
		await expect(correlationIdCode).toHaveText(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		);

		const evaluatorVersionValue = page.locator('dt:text-is("Evaluator version") + dd');
		await expect(evaluatorVersionValue).toHaveText('0.1.0');

		const modelIdValue = page.locator('dt:text-is("Model") + dd');
		await expect(modelIdValue).toHaveText(MODEL_ID);

		const modelSha256Code = page.locator('dt:text-is("Model SHA-256") + dd code');
		await expect(modelSha256Code).toHaveText(MODEL_SHA256);

		const evaluatedFenCode = page.locator('dt:text-is("Evaluated FEN") + dd code');
		await expect(evaluatedFenCode).toHaveText(expectedFen);

		// Verify exactly ONE evaluation request occurred for this scenario
		expect(evaluateRequests).toHaveLength(1);

		// Step 9: Modify editor state post-evaluation and verify the stale result notice appears
		await page.getByRole('radio', { name: 'Black' }).check();
		await expect(canonicalFen).toHaveText('8/8/2n5/8/8/8/8/K6k b K c3');
		await expect(page.locator('.stale-notice')).toHaveText(
			'The editor changed after this request. This result belongs to the submitted FEN below.',
		);
		await expect(evaluatedFenCode).toHaveText(expectedFen);

		// Step 10: Verify security boundaries (no evaluator credentials or private origin in browser requests, storage, or DOM)
		for (const req of recordedBrowserRequests) {
			expect(req.url).not.toContain(EVALUATOR_ORIGIN);
			expect(req.url).not.toContain('8088');
			expect(req.postData || '').not.toContain(EVALUATOR_BEARER_TOKEN);
			expect(req.postData || '').not.toContain(EVALUATOR_ORIGIN);
			for (const [key, value] of Object.entries(req.headers)) {
				expect(key.toLowerCase()).not.toContain('evaluator');
				expect(value).not.toContain(EVALUATOR_BEARER_TOKEN);
				expect(value).not.toContain(EVALUATOR_ORIGIN);
				expect(value).not.toContain('8088');
			}
		}

		const storageState = await page.evaluate(() => ({
			localStorage: JSON.stringify(localStorage),
			sessionStorage: JSON.stringify(sessionStorage),
			cookie: document.cookie,
		}));
		const storageJson = JSON.stringify(storageState);
		expect(storageJson).not.toContain(EVALUATOR_ORIGIN);
		expect(storageJson).not.toContain(EVALUATOR_BEARER_TOKEN);
		expect(storageJson).not.toContain('8088');

		const renderedHtml = await page.content();
		expect(renderedHtml).not.toContain(EVALUATOR_ORIGIN);
		expect(renderedHtml).not.toContain(EVALUATOR_BEARER_TOKEN);
		expect(renderedHtml).not.toContain('8088');

		// Verify client build assets contain no evaluator origin or bearer token
		const clientFiles = getAllFiles(resolve('build/client'));
		expect(clientFiles.length).toBeGreaterThan(0);
		for (const filePath of clientFiles) {
			const content = readFileSync(filePath);
			expect(content).not.toContain(Buffer.from(EVALUATOR_ORIGIN));
			expect(content).not.toContain(Buffer.from(EVALUATOR_BEARER_TOKEN));
		}

		expect(await getEvaluationRequestCount()).toBe(1);
	});

	test('renders stable typed-error path when authentication is rejected without contacting evaluator', async ({
		page,
	}) => {
		const expiredToken = await fetchTestJwt({
			expired: true,
			sub: 'expired-tester',
		});

		await page.setExtraHTTPHeaders({
			'cf-access-jwt-assertion': expiredToken,
		});

		const evaluateRequests: string[] = [];
		page.on('request', (browserRequest) => {
			const url = browserRequest.url();
			if (url.includes('/api/evaluate')) {
				evaluateRequests.push(url);
			}
		});

		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'Evaluation Playground' })).toBeVisible();

		// Submit unauthenticated evaluation request
		await page.getByRole('button', { name: 'Evaluate position' }).click();

		// Verify typed error state in UI
		const errorCard = page.locator('.error-state[role="alert"]');
		await expect(errorCard).toBeVisible();
		await expect(errorCard.getByRole('heading', { level: 3 })).toHaveText('Evaluation rejected');
		await expect(
			errorCard.getByText('Invalid or missing authentication credentials'),
		).toBeVisible();
		await expect(errorCard.locator('.submitted-position code')).toHaveText(
			'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
		);

		// Verify exactly one browser request was made to /api/evaluate and failed
		expect(evaluateRequests).toHaveLength(1);
		expect(await getEvaluationRequestCount()).toBe(0);
	});
});
