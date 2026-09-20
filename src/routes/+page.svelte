<!-- SPDX-FileCopyrightText: 2026 Jegors Čemisovs -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<script lang="ts">
	import EvaluationPanel from '$lib/components/EvaluationPanel.svelte';
	import PositionEditor from '$lib/components/PositionEditor.svelte';
	import { serializeFen } from '$lib/position/fen.js';
	import { INITIAL_FEN, type PositionState } from '$lib/position/model.js';

	let currentFen = $state(INITIAL_FEN);
	let positionReady = $state(true);

	function handlePositionChange(state: PositionState): void {
		currentFen = serializeFen(state);
	}

	function handlePositionValidityChange(valid: boolean): void {
		positionReady = valid;
	}
</script>

<svelte:head>
	<title>Dice Chess Evaluation Playground</title>
	<meta
		name="description"
		content="Protected playground for interactively testing Dice Chess evaluation models."
	/>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="playground-page">
	<div class="playground-shell">
		<header class="page-header" aria-labelledby="page-title">
			<div>
				<p class="eyebrow">Fortemate internal tooling</p>
				<h1 id="page-title">Evaluation Playground</h1>
			</div>
			<details class="page-about">
				<summary>About this tool</summary>
				<p>
					Construct a Dice Chess position with every semantic field explicit: side to move, castling
					rights and en-passant targets are never inferred from the board. Editing stays in the
					browser; nothing is evaluated until you deliberately press Evaluate position, and one
					press sends exactly one request through the protected same-origin gateway.
				</p>
			</details>
		</header>

		<PositionEditor onchange={handlePositionChange} onvaliditychange={handlePositionValidityChange}>
			{#snippet aside()}
				<EvaluationPanel fen={currentFen} valid={positionReady} />
			{/snippet}
		</PositionEditor>
	</div>
</main>
