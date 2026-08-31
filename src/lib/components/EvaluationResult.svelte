<!-- SPDX-FileCopyrightText: 2026 Jegors Čemisovs -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<script lang="ts">
	import type {
		EvaluationApiError,
		EvaluationErrorCode,
		PositionEvaluationResponse,
	} from '$lib/contracts/evaluation.js';

	interface Props {
		status: 'idle' | 'pending' | 'success' | 'error';
		currentFen: string;
		submittedFen?: string;
		result?: PositionEvaluationResponse;
		error?: EvaluationApiError;
	}

	let { status, currentFen, submittedFen, result, error }: Props = $props();

	const isStale = $derived(
		(status === 'success' || status === 'error') &&
			submittedFen !== undefined &&
			currentFen !== submittedFen,
	);

	function perspectiveLabel(perspective: 'w' | 'b'): string {
		return perspective === 'w' ? 'White to move' : 'Black to move';
	}

	function errorTitle(code: EvaluationErrorCode): string {
		switch (code) {
			case 'ANALYSIS_BUSY':
				return 'Evaluator busy';
			case 'DEADLINE_EXCEEDED':
				return 'Evaluation timed out';
			case 'MODEL_UNAVAILABLE':
			case 'MODEL_NOT_READY':
			case 'MANIFEST_NOT_FOUND':
			case 'INTERNAL_FAILURE':
				return 'Evaluator unavailable';
			default:
				return 'Evaluation rejected';
		}
	}
</script>

<div class="evaluation-result" data-state={status} aria-live="polite" aria-atomic="true">
	{#if status === 'idle'}
		<p class="empty-state">No evaluation has been requested for this position.</p>
	{:else if status === 'pending' && submittedFen}
		<div class="result-heading">
			<div>
				<p class="result-kicker">Request in progress</p>
				<h3>Evaluating position…</h3>
			</div>
			<span class="pending-indicator" aria-hidden="true"></span>
		</div>
		<p class="result-copy">
			One evaluation request is running. It will not be retried automatically.
		</p>
		<div class="submitted-position">
			<span>Submitted FEN</span>
			<code>{submittedFen}</code>
		</div>
	{:else if status === 'success' && result && submittedFen}
		<div class="result-heading">
			<div>
				<p class="result-kicker">Single-model result</p>
				<h3>Evaluation complete</h3>
			</div>
			<strong class="probability">{(result.probability * 100).toFixed(1)}%</strong>
		</div>

		{#if isStale}
			<p class="stale-notice">
				The editor changed after this request. This result belongs to the submitted FEN below.
			</p>
		{/if}

		<dl class="result-grid">
			<div>
				<dt>Perspective</dt>
				<dd>{perspectiveLabel(result.perspective)}</dd>
			</div>
			<div>
				<dt>Latency</dt>
				<dd>{result.latencyMs} ms</dd>
			</div>
			<div>
				<dt>Correlation ID</dt>
				<dd><code>{result.correlationId}</code></dd>
			</div>
			<div>
				<dt>Evaluator version</dt>
				<dd>{result.evaluatorVersion}</dd>
			</div>
			<div>
				<dt>Model</dt>
				<dd>{result.modelId}</dd>
			</div>
			<div class="digest-row">
				<dt>Model SHA-256</dt>
				<dd><code>{result.modelSha256}</code></dd>
			</div>
			<div class="fen-row">
				<dt>Evaluated FEN</dt>
				<dd><code>{submittedFen}</code></dd>
			</div>
		</dl>
	{:else if status === 'error' && error && submittedFen}
		<div class="error-state" role="alert">
			<p class="result-kicker">Request failed</p>
			<h3>{errorTitle(error.code)}</h3>
			<p>{error.error}</p>
			{#if error.correlationId}
				<p class="correlation">Correlation ID: <code>{error.correlationId}</code></p>
			{/if}
			{#if isStale}
				<p class="stale-notice">
					The editor changed after this request. The failure belongs to the submitted FEN below.
				</p>
			{/if}
			<div class="submitted-position">
				<span>Submitted FEN</span>
				<code>{submittedFen}</code>
			</div>
		</div>
	{/if}
</div>

<style>
	.evaluation-result {
		min-height: 5.5rem;
		padding: 1rem;
		border: 1px solid rgb(148 163 184 / 16%);
		border-radius: 1rem;
		background: rgb(8 12 22 / 54%);
	}

	.empty-state,
	.result-copy,
	.error-state > p {
		margin: 0;
		color: #aab5c5;
		line-height: 1.55;
	}

	.result-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	h3 {
		margin: 0;
		font-size: 1.35rem;
	}

	.result-kicker {
		margin: 0 0 0.25rem;
		color: #60a5fa;
		font-size: 0.7rem;
		font-weight: 750;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.probability {
		color: #bfdbfe;
		font-size: clamp(1.8rem, 5vw, 2.8rem);
		letter-spacing: -0.04em;
	}

	.pending-indicator {
		width: 1rem;
		height: 1rem;
		border: 0.2rem solid rgb(96 165 250 / 30%);
		border-top-color: #60a5fa;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.result-copy {
		margin-top: 0.85rem;
	}

	.result-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
		margin: 1rem 0 0;
	}

	.result-grid > div,
	.submitted-position {
		min-width: 0;
		padding: 0.75rem;
		border-radius: 0.75rem;
		background: rgb(15 23 42 / 78%);
	}

	.result-grid .digest-row,
	.result-grid .fen-row {
		grid-column: 1 / -1;
	}

	dt,
	.submitted-position span {
		display: block;
		margin-bottom: 0.25rem;
		color: #94a3b8;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	dd {
		margin: 0;
		color: #e5e7eb;
	}

	code {
		overflow-wrap: anywhere;
		color: #bfdbfe;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.8rem;
	}

	.submitted-position {
		margin-top: 1rem;
	}

	.stale-notice {
		margin: 0.85rem 0 0;
		padding: 0.75rem;
		border: 1px solid rgb(251 191 36 / 32%);
		border-radius: 0.75rem;
		color: #fde68a;
		background: rgb(120 53 15 / 24%);
		line-height: 1.5;
	}

	.error-state h3 {
		margin-bottom: 0.5rem;
		color: #fecdd3;
	}

	.error-state .correlation {
		margin-top: 0.65rem;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.pending-indicator {
			animation: none;
		}
	}

	@media (max-width: 42rem) {
		.result-grid {
			grid-template-columns: minmax(0, 1fr);
		}

		.result-grid .digest-row,
		.result-grid .fen-row {
			grid-column: auto;
		}
	}
</style>
