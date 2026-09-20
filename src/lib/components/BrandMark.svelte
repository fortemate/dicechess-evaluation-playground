<!-- SPDX-FileCopyrightText: 2026 Jegors Čemisovs -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<script lang="ts">
	// The mark itself is a verbatim copy of the approved brand bundle
	// (fortemate/brand dist/identity/web/fortemate-mark.svg, commit 44f2b4a) kept as a
	// separate asset: the Fortemate name and mark are trademarks and are not covered by
	// this file's licence (see THIRD_PARTY_NOTICES.md). The SVG inherits the CSS color.
	import mark from '$lib/assets/fortemate-mark.svg?raw';
</script>

<span class="brand-mark" aria-hidden="true">{@html mark}</span>

<style>
	.brand-mark {
		display: block;
		width: 1em;
		height: 1em;
	}

	.brand-mark :global(svg) {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
