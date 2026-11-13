<script lang="ts">
import Icon from "@components/atoms/display/Icon.svelte";
import Key from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import { onMount, tick } from "svelte";

interface Entry {
	title: string;
	href: string;
	description: string;
	text: string;
	category: string;
}
let { entries }: { entries: Entry[] } = $props();
let dialog: HTMLDialogElement;
let input: HTMLInputElement;
let query = $state("");
let results = $derived.by(() => {
	const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
	return entries
		.filter((entry) =>
			terms.every((term) =>
				`${entry.title} ${entry.text} ${entry.category}`
					.toLocaleLowerCase()
					.includes(term),
			),
		)
		.slice(0, 10);
});
async function openSearch() {
	query = "";
	dialog.showModal();
	await tick();
	input.focus();
}
function closeSearch() {
	dialog.close();
}
onMount(() => {
	const shortcuts = (event: KeyboardEvent) => {
		// Search inputs consume Escape to clear their value before native dialog
		// cancellation. Close explicitly so one Escape always dismisses search.
		if (event.key === "Escape" && dialog.open) {
			event.preventDefault();
			closeSearch();
			return;
		}
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
			event.preventDefault();
			if (dialog.open) closeSearch();
			else void openSearch();
		}
	};
	const onNavigate = () => {
		if (dialog.open) closeSearch();
	};
	document.addEventListener("keydown", shortcuts);
	document.addEventListener("swup:visit:start", onNavigate);
	return () => {
		document.removeEventListener("keydown", shortcuts);
		document.removeEventListener("swup:visit:start", onNavigate);
	};
});
</script>

<button class="garden-search-trigger m3-state-layer" type="button" onclick={openSearch} aria-label={i18n(Key.search)} aria-haspopup="dialog">
	<Icon icon="material-symbols:search-rounded" width="18" height="18" /><span>{i18n(Key.search)}</span><kbd>Ctrl K</kbd>
</button>
<dialog bind:this={dialog} class="garden-search-dialog" aria-label={i18n(Key.search)}>
	<form method="dialog" class="garden-search-form" onsubmit={closeSearch}>
		<Icon icon="material-symbols:search-rounded" width="22" height="22" />
		<input bind:this={input} bind:value={query} type="search" placeholder={i18n(Key.gardenSearchHint)} aria-label={i18n(Key.search)} autocomplete="off" />
		<button type="button" onclick={closeSearch} class="garden-search-close m3-state-layer" aria-label={i18n(Key.close)}><Icon icon="material-symbols:close-rounded" width="20" height="20" /></button>
	</form>
	<div class="garden-search-results" aria-live="polite" aria-atomic="false">
		<p class="garden-search-caption">{query.trim() ? i18n(Key.gardenResults).replace("{count}", String(results.length)) : i18n(Key.gardenLatest)}</p>
		{#each results as entry (entry.href)}
			<a href={entry.href} class="garden-search-result m3-state-layer" onclick={closeSearch}>
				<span class="garden-search-result__category">{entry.category}</span>
				<strong>{entry.title}</strong>
				<p>{entry.description}</p>
				<Icon icon="material-symbols:arrow-outward-rounded" width="19" height="19" />
			</a>
		{:else}
			<p class="garden-search-empty">{i18n(Key.gardenSearchEmpty)}</p>
		{/each}
	</div>
	<div class="garden-search-footer"><Icon icon="material-symbols:eco-outline-rounded" width="15" height="15" /><span>{i18n(Key.gardenGrowing)}</span><span class="garden-search-escape">Esc</span></div>
</dialog>

<style lang="stylus">
@import "../../styles/breakpoints.styl"
.garden-search-trigger
	display: inline-flex
	align-items: center
	gap: var(--m3e-space-2)
	min-height: 40px
	padding: var(--m3e-space-2) var(--m3e-space-3)
	border: 1px solid var(--outline-variant)
	border-radius: var(--shape-corner-full)
	background: var(--surface-container)
	color: var(--on-surface-variant)
	font: var(--m3e-type-label-medium)
	cursor: pointer
	kbd
		font: var(--m3e-type-label-small)
		margin-left: var(--m3e-space-3)
		padding: 2px var(--m3e-space-1)
		border: 1px solid var(--outline-variant)
		border-radius: var(--shape-corner-xs)
.garden-search-dialog
	position: fixed
	margin: unquote("min(14vh, 120px)") auto auto
	padding: 0
	width: unquote("min(620px, calc(100% - 32px))")
	max-height: 76vh
	border: 1px solid var(--outline-variant)
	border-radius: var(--shape-corner-xl)
	background: var(--surface-container)
	color: var(--on-surface)
	box-shadow: var(--m3e-elevation-5)
	&::backdrop
		background: unquote("color-mix(in srgb, var(--on-surface) 35%, transparent)")
		backdrop-filter: blur(5px)
.garden-search-form
	display: flex
	align-items: center
	gap: var(--m3e-space-3)
	padding: var(--m3e-space-4) var(--m3e-space-5)
	border-bottom: 1px solid var(--outline-variant)
	color: var(--primary)
	input
		flex: 1
		min-width: 0
		font: var(--m3e-type-body-large)
		color: var(--on-surface)
		background: transparent
		border: 0
		outline: none
		padding: var(--m3e-space-2) 0
.garden-search-close
	display: grid
	place-items: center
	min-width: 40px
	min-height: 40px
	border-radius: var(--shape-corner-full)
	cursor: pointer
.garden-search-results
	padding: var(--m3e-space-4)
	max-height: 52vh
	overflow-y: auto
.garden-search-caption
	font: var(--m3e-type-label-medium)
	color: var(--on-surface-variant)
	margin: 0 var(--m3e-space-2) var(--m3e-space-2)
.garden-search-result
	display: block
	position: relative
	padding: var(--m3e-space-4)
	border-radius: var(--shape-corner-m)
	text-decoration: none
	color: var(--on-surface)
	strong
		display: block
		font: var(--m3e-type-title-medium)
		padding-right: var(--m3e-space-6)
	p
		font: var(--m3e-type-body-small)
		color: var(--on-surface-variant)
		line-height: 1.8
		margin: var(--m3e-space-2) 0 0
	:global(> svg)
		position: absolute
		top: var(--m3e-space-5)
		right: var(--m3e-space-4)
		color: var(--primary)
.garden-search-result__category
	display: block
	font: var(--m3e-type-label-small)
	color: var(--primary)
	margin-bottom: var(--m3e-space-1)
.garden-search-empty
	padding: var(--m3e-space-10) var(--m3e-space-4)
	color: var(--on-surface-variant)
	font: var(--m3e-type-body-medium)
	text-align: center
.garden-search-footer
	display: flex
	align-items: center
	gap: var(--m3e-space-2)
	padding: var(--m3e-space-3) var(--m3e-space-6)
	border-top: 1px solid var(--outline-variant)
	font: var(--m3e-type-label-small)
	color: var(--on-surface-variant)
.garden-search-escape
	margin-left: auto
	padding: 1px var(--m3e-space-1)
	border: 1px solid var(--outline-variant)
	border-radius: var(--shape-corner-xs)
@media (max-width: bp-lg - 1px)
	.garden-search-trigger
		width: 44px
		height: 44px
		justify-content: center
		border: 0
		background: transparent
		span, kbd
			display: none
</style>
