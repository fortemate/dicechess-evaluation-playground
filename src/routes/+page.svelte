<!-- SPDX-FileCopyrightText: 2026 Jegors Čemisovs -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>Dice Chess Evaluation Playground</title>
	<meta
		name="description"
		content="Protected playground for interactively testing Dice Chess evaluation models."
	/>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main>
	<section class="baseline-card" aria-labelledby="page-title">
		<p class="eyebrow">Fortemate internal tooling</p>
		<h1 id="page-title">Evaluation Playground</h1>
		<p class="lede">
			The protected position editor and evaluator BFF will be implemented in the next Epic
			sub-issues.
		</p>

		<div class="status" aria-label="Repository baseline status">
			<span aria-hidden="true"></span>
			Engineering baseline ready
		</div>

		<a href={resolve('/health')}>View health endpoint</a>
	</section>
</main>
