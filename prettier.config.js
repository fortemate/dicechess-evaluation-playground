/** @type {import('prettier').Config} */
const config = {
	useTabs: true,
	semi: true,
	singleQuote: true,
	trailingComma: 'all',
	printWidth: 100,
	proseWrap: 'preserve',
	plugins: ['prettier-plugin-svelte', 'prettier-plugin-tailwindcss'],
	overrides: [{ files: '*.svelte', options: { parser: 'svelte' } }],
	tailwindStylesheet: './src/routes/layout.css',
};

export default config;
