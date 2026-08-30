<!-- SPDX-FileCopyrightText: 2026 Jegors Čemisovs -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<script lang="ts">
	import PositionEditor from '$lib/components/PositionEditor.svelte';
	import { serializeFen } from '$lib/position/fen.js';
	import { INITIAL_FEN, type PositionState } from '$lib/position/model.js';

	let currentFen = $state(INITIAL_FEN);

	function handlePositionChange(state: PositionState): void {
		currentFen = serializeFen(state);
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
	<header class="page-header" aria-labelledby="page-title">
		<p class="eyebrow">Fortemate internal tooling</p>
		<h1 id="page-title">Evaluation Playground</h1>
		<p class="lede">
			Construct a Dice Chess position with every semantic field explicit. Nothing is evaluated until
			a later, deliberate request.
		</p>
	</header>

	<PositionEditor onchange={handlePositionChange} />

	<section class="state-preview" aria-labelledby="state-preview-title">
		<div>
			<p class="eyebrow">Current explicit state</p>
			<h2 id="state-preview-title">Canonical evaluation FEN</h2>
		</div>
		<output aria-live="polite">{currentFen}</output>
	</section>
</main>
