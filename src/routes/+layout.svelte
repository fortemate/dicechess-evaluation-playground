<!-- SPDX-FileCopyrightText: 2026 Jegors Čemisovs -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<script lang="ts">
	import './layout.css';
	import { env } from '$env/dynamic/public';

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

<svelte:head>
	<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
	<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
	<link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png" />
	<link rel="apple-touch-icon" href="/apple-touch-icon-180.png" sizes="180x180" />
</svelte:head>

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
