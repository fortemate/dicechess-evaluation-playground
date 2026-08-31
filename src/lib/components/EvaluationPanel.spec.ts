// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import EvaluationPanel from './EvaluationPanel.svelte';

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
const CHANGED_FEN = '8/8/8/8/8/8/8/K6k b - -';
const MODEL_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function successResponse(fen = INITIAL_FEN): Response {
	return new Response(
		JSON.stringify({
			fen,
			perspective: 'w',
			probability: 0.523,
			latencyMs: 41,
			correlationId: 'request-123',
			evaluatorVersion: '1.4.0',
			modelId: 'dicechess-v1',
			modelSha256: MODEL_SHA256,
		}),
		{ status: 200, headers: { 'content-type': 'application/json' } },
	);
}

describe('EvaluationPanel', () => {
	it('does not evaluate on render or when the position changes', async () => {
		const fetcher = vi.fn();
		const { rerender } = render(EvaluationPanel, { fen: INITIAL_FEN, fetcher });

		expect(screen.getByText('No evaluation has been requested for this position.')).toBeTruthy();
		expect(fetcher).not.toHaveBeenCalled();

		await rerender({ fen: CHANGED_FEN, fetcher });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('submits once, blocks duplicate clicks, and renders full provenance', async () => {
		const user = userEvent.setup();
		let resolveRequest!: (response: Response) => void;
		const fetcher = vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					resolveRequest = resolve;
				}),
		);
		render(EvaluationPanel, { fen: INITIAL_FEN, fetcher });

		const evaluateButton = screen.getByRole<HTMLButtonElement>('button', {
			name: 'Evaluate position',
		});
		await user.click(evaluateButton);
		expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Evaluating…' }).disabled).toBe(
			true,
		);
		expect(
			screen.getByText('One evaluation request is running. It will not be retried automatically.'),
		).toBeTruthy();

		await user.click(screen.getByRole('button', { name: 'Evaluating…' }));
		expect(fetcher).toHaveBeenCalledOnce();
		expect(fetcher).toHaveBeenCalledWith('/api/evaluate', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fen: INITIAL_FEN }),
		});

		resolveRequest(successResponse());
		await screen.findByRole('heading', { name: 'Evaluation complete' });
		expect(screen.getByText('52.3%')).toBeTruthy();
		expect(screen.getByText('White to move')).toBeTruthy();
		expect(screen.getByText('41 ms')).toBeTruthy();
		expect(screen.getByText('request-123')).toBeTruthy();
		expect(screen.getByText('1.4.0')).toBeTruthy();
		expect(screen.getByText('dicechess-v1')).toBeTruthy();
		expect(screen.getByText(MODEL_SHA256)).toBeTruthy();
	});

	it('keeps a completed result tied to the submitted FEN after later edits', async () => {
		const user = userEvent.setup();
		const fetcher = vi.fn().mockResolvedValue(successResponse());
		const { rerender } = render(EvaluationPanel, { fen: INITIAL_FEN, fetcher });

		await user.click(screen.getByRole('button', { name: 'Evaluate position' }));
		await screen.findByRole('heading', { name: 'Evaluation complete' });
		await rerender({ fen: CHANGED_FEN, fetcher });

		expect(
			screen.getByText(
				'The editor changed after this request. This result belongs to the submitted FEN below.',
			),
		).toBeTruthy();
		expect(screen.getAllByText(INITIAL_FEN).length).toBeGreaterThan(0);
		expect(fetcher).toHaveBeenCalledOnce();
	});

	it('marks a completed result stale while the editor has an uncommitted draft', async () => {
		const user = userEvent.setup();
		const fetcher = vi.fn().mockResolvedValue(successResponse());
		const { rerender } = render(EvaluationPanel, { fen: INITIAL_FEN, valid: true, fetcher });

		await user.click(screen.getByRole('button', { name: 'Evaluate position' }));
		await screen.findByRole('heading', { name: 'Evaluation complete' });
		await rerender({ fen: INITIAL_FEN, valid: false, fetcher });

		expect(
			screen.getByText(
				'The editor changed after this request. This result belongs to the submitted FEN below.',
			),
		).toBeTruthy();
		expect(fetcher).toHaveBeenCalledOnce();
	});

	it('disables submission while the editor has an uncommitted or invalid change', async () => {
		const user = userEvent.setup();
		const fetcher = vi.fn();
		render(EvaluationPanel, { fen: INITIAL_FEN, valid: false, fetcher });

		const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Evaluate position' });
		expect(button.disabled).toBe(true);
		expect(
			screen.getByText(
				'Finish or correct the pending editor change before requesting an evaluation.',
			),
		).toBeTruthy();
		await user.click(button);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it.each([
		['DEADLINE_EXCEEDED', 'Evaluation timed out'],
		['AUTHENTICATION_FAILURE', 'Evaluation rejected'],
		['MODEL_UNAVAILABLE', 'Evaluator unavailable'],
		['ANALYSIS_BUSY', 'Evaluator busy'],
	] as const)('renders the %s typed error state', async (code, heading) => {
		const user = userEvent.setup();
		const fetcher = vi
			.fn()
			.mockResolvedValue(
				new Response(
					JSON.stringify({ code, error: `Safe ${code} message`, correlationId: 'error-123' }),
					{ status: code === 'ANALYSIS_BUSY' ? 429 : 503 },
				),
			);
		render(EvaluationPanel, { fen: INITIAL_FEN, fetcher });

		await user.click(screen.getByRole('button', { name: 'Evaluate position' }));
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain(heading);
		expect(alert.textContent).toContain(`Safe ${code} message`);
		expect(alert.textContent).toContain('error-123');
	});

	it('maps network and malformed responses to an unavailable state without retrying', async () => {
		const user = userEvent.setup();
		const fetcher = vi
			.fn()
			.mockRejectedValueOnce(new TypeError('private network detail'))
			.mockResolvedValueOnce(
				new Response('not-json', {
					status: 502,
					headers: { 'x-correlation-id': 'gateway-123' },
				}),
			);
		render(EvaluationPanel, { fen: INITIAL_FEN, fetcher });

		await user.click(screen.getByRole('button', { name: 'Evaluate position' }));
		let alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain('Evaluator unavailable');
		expect(alert.textContent).not.toContain('private network detail');

		await user.click(screen.getByRole('button', { name: 'Evaluate position' }));
		await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
		alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain('gateway-123');
	});

	it('rejects a successful payload that belongs to a different FEN', async () => {
		const user = userEvent.setup();
		const fetcher = vi.fn().mockResolvedValue(successResponse(CHANGED_FEN));
		render(EvaluationPanel, { fen: INITIAL_FEN, fetcher });

		await user.click(screen.getByRole('button', { name: 'Evaluate position' }));
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain('Evaluator unavailable');
		expect(screen.queryByRole('heading', { name: 'Evaluation complete' })).toBeNull();
	});

	it('uses the response header correlation ID when a typed error body omits it', async () => {
		const user = userEvent.setup();
		const fetcher = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ code: 'MODEL_UNAVAILABLE', error: 'Model unavailable' }), {
				status: 503,
				headers: { 'x-correlation-id': 'header-request-123' },
			}),
		);
		render(EvaluationPanel, { fen: INITIAL_FEN, fetcher });

		await user.click(screen.getByRole('button', { name: 'Evaluate position' }));
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain('header-request-123');
	});
});
