<!-- SPDX-FileCopyrightText: 2026 Jegors Čemisovs -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<script lang="ts">
	import './layout.css';
	import { env } from '$env/dynamic/public';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

	const repositoryUrl = 'https://github.com/fortemate/dicechess-evaluation-playground';
	const configuredRevision = env.PUBLIC_SOURCE_REVISION;
	const hasExactRevision = Boolean(
		configuredRevision && /^[0-9a-f]{40}$/i.test(configuredRevision),
	);
	const sourceUrl = hasExactRevision
		? `${repositoryUrl}/tree/${configuredRevision}`
		: repositoryUrl;
	const licenseUrl = hasExactRevision
		? `${repositoryUrl}/blob/${configuredRevision}/LICENSE`
		: `${repositoryUrl}/blob/main/LICENSE`;
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="app-shell">
	{@render children()}

	<footer class="source-notice" aria-label="Source and license">
		<span>© 2026 Jegors Čemisovs</span>
		<span aria-hidden="true">·</span>
		<a href={sourceUrl} rel="external">Source code</a>
		<span aria-hidden="true">·</span>
		<a href={licenseUrl} rel="license external">AGPL-3.0-only</a>
		<span aria-hidden="true">·</span>
		<span>No warranty</span>
	</footer>
</div>
