<!-- SPDX-FileCopyrightText: 2026 Jegors Čemisovs -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<script lang="ts">
	// The mark is a verbatim copy of the approved brand bundle
	// (fortemate/brand dist/identity/web/fortemate-mark.svg, commit 44f2b4a) kept as a
	// separate asset: the Fortemate name and mark are trademarks and are not covered by
	// this file's licence (see THIRD_PARTY_NOTICES.md). It is painted through a CSS mask
	// so it takes the surrounding text colour without embedding its markup here.
	import mark from '$lib/assets/fortemate-mark.svg';
</script>

<!-- Quoted: Vite may inline the asset as a data URI containing apostrophes. -->
<span class="brand-mark" style={`--brand-mark: url("${mark}")`} role="img" aria-label="Fortemate"
></span>

<style>
	.brand-mark {
		display: block;
		width: 1em;
		height: 1em;
		background-color: currentColor;
		mask-image: var(--brand-mark);
		mask-position: center;
		mask-size: contain;
		mask-repeat: no-repeat;
	}
</style>
