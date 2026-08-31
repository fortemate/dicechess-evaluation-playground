<!-- SPDX-FileCopyrightText: 2026 Jegors Čemisovs -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<script lang="ts">
	import {
		EVALUATION_ERROR_CODES,
		type EvaluationApiError,
		type EvaluationErrorCode,
		type PositionEvaluationResponse,
	} from '$lib/contracts/evaluation.js';

	import EvaluationResult from './EvaluationResult.svelte';

	type EvaluationFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
	type EvaluationStatus = 'idle' | 'pending' | 'success' | 'error';

	interface Props {
		fen: string;
		valid?: boolean;
		fetcher?: EvaluationFetcher;
	}

	let { fen, valid = true, fetcher = globalThis.fetch }: Props = $props();
	let status = $state<EvaluationStatus>('idle');
	let submittedFen = $state<string>();
	let result = $state<PositionEvaluationResponse>();
	let evaluationError = $state<EvaluationApiError>();

	function isRecord(value: unknown): value is Record<string, unknown> {
		return typeof value === 'object' && value !== null && !Array.isArray(value);
	}

	function isErrorCode(value: unknown): value is EvaluationErrorCode {
		return (
			typeof value === 'string' && EVALUATION_ERROR_CODES.includes(value as EvaluationErrorCode)
		);
	}

	function isEvaluationError(value: unknown): value is EvaluationApiError {
		return (
			isRecord(value) &&
			isErrorCode(value.code) &&
			typeof value.error === 'string' &&
			(value.correlationId === undefined || typeof value.correlationId === 'string')
		);
	}

	function isEvaluationResult(value: unknown): value is PositionEvaluationResponse {
		return (
			isRecord(value) &&
			typeof value.fen === 'string' &&
			(value.perspective === 'w' || value.perspective === 'b') &&
			typeof value.probability === 'number' &&
			Number.isFinite(value.probability) &&
			value.probability >= 0 &&
			value.probability <= 1 &&
			typeof value.latencyMs === 'number' &&
			Number.isFinite(value.latencyMs) &&
			value.latencyMs >= 0 &&
			typeof value.correlationId === 'string' &&
			typeof value.evaluatorVersion === 'string' &&
			typeof value.modelId === 'string' &&
			typeof value.modelSha256 === 'string' &&
			/^[0-9a-fA-F]{64}$/.test(value.modelSha256)
		);
	}

	function fallbackError(correlationId?: string): EvaluationApiError {
		return {
			code: 'INTERNAL_FAILURE',
			error: 'The evaluator returned an invalid or unavailable response.',
			correlationId,
		};
	}

	async function parseResponse(response: Response): Promise<unknown> {
		try {
			return await response.json();
		} catch {
			return undefined;
		}
	}

	async function evaluate(): Promise<void> {
		if (!valid || status === 'pending') return;

		const requestFen = fen;
		submittedFen = requestFen;
		result = undefined;
		evaluationError = undefined;
		status = 'pending';

		try {
			const response = await fetcher('/api/evaluate', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ fen: requestFen }),
			});
			const payload = await parseResponse(response);

			if (response.ok && isEvaluationResult(payload) && payload.fen === requestFen) {
				result = payload;
				status = 'success';
				return;
			}

			evaluationError = isEvaluationError(payload)
				? payload
				: fallbackError(response.headers.get('x-correlation-id') ?? undefined);
			status = 'error';
		} catch {
			evaluationError = fallbackError();
			status = 'error';
		}
	}
</script>

<section class="evaluation-panel" aria-labelledby="evaluation-title">
	<header class="panel-heading">
		<div>
			<p class="section-kicker">Explicit evaluation</p>
			<h2 id="evaluation-title">Request one model evaluation</h2>
		</div>
		<p>One click sends the current canonical FEN through the same-origin protected BFF.</p>
	</header>

	<div class="evaluation-actions">
		<button
			type="button"
			onclick={evaluate}
			disabled={!valid || status === 'pending'}
			aria-describedby={!valid ? 'evaluation-validation' : undefined}
		>
			{status === 'pending' ? 'Evaluating…' : 'Evaluate position'}
		</button>
		<p>No automatic evaluation, retry, or prefetch.</p>
	</div>

	{#if !valid}
		<p id="evaluation-validation" class="validation-message" aria-live="polite">
			Finish or correct the pending editor change before requesting an evaluation.
		</p>
	{/if}

	<EvaluationResult {status} currentFen={fen} {submittedFen} {result} error={evaluationError} />
</section>

<style>
	.evaluation-panel {
		box-sizing: border-box;
		width: min(100%, 76rem);
		padding: clamp(1rem, 3vw, 2rem);
		border: 1px solid rgb(148 163 184 / 18%);
		border-radius: 1.5rem;
		background: rgb(15 23 42 / 78%);
		box-shadow: 0 2rem 6rem rgb(0 0 0 / 22%);
	}

	.panel-heading {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 1.5rem;
		margin-bottom: 1.25rem;
	}

	.panel-heading h2 {
		margin: 0;
		font-size: clamp(1.45rem, 4vw, 2rem);
		letter-spacing: -0.03em;
	}

	.panel-heading > p,
	.evaluation-actions p {
		max-width: 31rem;
		margin: 0;
		color: #aab5c5;
		line-height: 1.55;
	}

	.section-kicker {
		margin: 0 0 0.35rem;
		color: #60a5fa;
		font-size: 0.72rem;
		font-weight: 750;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.evaluation-actions {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	button {
		min-height: 2.9rem;
		border: 1px solid #3b82f6;
		border-radius: 0.7rem;
		padding: 0.7rem 1.15rem;
		color: #eff6ff;
		background: #2563eb;
		font: inherit;
		font-weight: 750;
		cursor: pointer;
	}

	button:hover:not(:disabled) {
		background: #1d4ed8;
	}

	button:focus-visible {
		outline: 0.2rem solid #93c5fd;
		outline-offset: 0.15rem;
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.validation-message {
		margin: 0 0 1rem;
		padding: 0.75rem;
		border: 1px solid rgb(251 113 133 / 35%);
		border-radius: 0.75rem;
		color: #fecdd3;
		background: rgb(136 19 55 / 20%);
	}

	@media (max-width: 42rem) {
		.panel-heading,
		.evaluation-actions {
			align-items: stretch;
			flex-direction: column;
		}
	}
</style>
