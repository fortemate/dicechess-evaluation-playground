<!-- SPDX-FileCopyrightText: 2026 Jegors Čemisovs -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<script lang="ts">
	import '@lichess-org/chessground/assets/chessground.base.css';
	import '@lichess-org/chessground/assets/chessground.brown.css';
	import '@lichess-org/chessground/assets/chessground.cburnett.css';

	import { onMount } from 'svelte';

	import {
		canonicalizeCastlingRights,
		canonicalizeEnPassantTarget,
		parseFen,
		serializeFen,
		validateEnPassantTarget,
		validateFen,
		validatePositionState,
	} from '$lib/position/fen.js';
	import {
		EMPTY_BOARD_FEN,
		INITIAL_FEN,
		type ActiveColor,
		type CastlingSymbol,
		type PieceSymbol,
		type PositionState,
		type Square,
	} from '$lib/position/model.js';

	import {
		EDITOR_PIECES,
		EDITOR_SQUARES,
		createChessgroundAdapter,
		type ChessgroundAdapter,
	} from './chessground-adapter.js';

	interface Props {
		onchange?: (state: PositionState) => void;
		onvaliditychange?: (valid: boolean) => void;
	}

	let { onchange, onvaliditychange }: Props = $props();

	const startingState = parseFen(INITIAL_FEN);
	let positionState = $state<PositionState>({ ...startingState });
	let fenDraft = $state(serializeFen(startingState));
	let enPassantDraft = $state(startingState.enPassant);
	let fenError = $state('');
	let enPassantError = $state('');
	let boardError = $state('');
	let statusMessage = $state('Editor ready. No evaluation request has been sent.');

	let selectedPiece = $state<PieceSymbol>('P');
	let selectedSquare = $state<Square>('e4');
	let fromSquare = $state<Square>('e2');
	let toSquare = $state<Square>('e4');

	let boardElement: HTMLDivElement;
	let fenInputElement: HTMLInputElement;
	let enPassantInputElement: HTMLInputElement;
	let fromSquareElement: HTMLSelectElement;
	let boardAdapter: ChessgroundAdapter | undefined;
	const castlingOptions: readonly { symbol: CastlingSymbol; label: string }[] = [
		{ symbol: 'K', label: 'White kingside' },
		{ symbol: 'Q', label: 'White queenside' },
		{ symbol: 'k', label: 'Black kingside' },
		{ symbol: 'q', label: 'Black queenside' },
	];

	onMount(() => {
		boardAdapter = createChessgroundAdapter(boardElement, {
			state: positionState,
			onPiecePlacementChange: handlePiecePlacementChange,
		});

		return () => boardAdapter?.destroy();
	});

	function commitState(
		nextState: PositionState,
		options: { syncBoard?: boolean; message?: string } = {},
	): boolean {
		const validation = validatePositionState(nextState);
		if (!validation.valid) {
			boardError = validation.error ?? 'The position is invalid.';
			onvaliditychange?.(false);
			return false;
		}

		positionState = { ...nextState };
		fenDraft = serializeFen(positionState);
		enPassantDraft = positionState.enPassant;
		fenError = '';
		enPassantError = '';
		boardError = '';

		if (options.syncBoard !== false) {
			boardAdapter?.sync(positionState);
		}

		onchange?.({ ...positionState });
		onvaliditychange?.(true);
		if (options.message) {
			statusMessage = options.message;
		}
		return true;
	}

	function handlePiecePlacementChange(piecePlacement: string): void {
		commitState(
			{ ...positionState, piecePlacement },
			{ syncBoard: false, message: 'Board position updated.' },
		);
	}

	function importFen(event: SubmitEvent): void {
		event.preventDefault();
		const validation = validateFen(fenDraft);
		if (!validation.valid) {
			fenError = validation.error ?? 'The FEN is invalid.';
			onvaliditychange?.(false);
			fenInputElement.focus();
			return;
		}

		fenError = '';
		commitState(parseFen(fenDraft), { message: 'FEN imported.' });
		boardElement.focus();
	}

	function handleFenDraftInput(event: Event): void {
		const draft = (event.currentTarget as HTMLInputElement).value;
		fenError = '';
		onvaliditychange?.(draft === serializeFen(positionState));
	}

	function setActiveColor(activeColor: ActiveColor): void {
		commitState({ ...positionState, activeColor }, { message: 'Side to move updated.' });
	}

	function hasCastlingRight(symbol: CastlingSymbol): boolean {
		return positionState.castlingRights.includes(symbol);
	}

	function setCastlingRight(symbol: CastlingSymbol, enabled: boolean): void {
		const currentRights =
			positionState.castlingRights === '-' ? [] : positionState.castlingRights.split('');
		const rights = enabled
			? [...currentRights.filter((right) => right !== symbol), symbol]
			: currentRights.filter((right) => right !== symbol);

		const nextRights = canonicalizeCastlingRights(rights.length === 0 ? '-' : rights.join(''));
		commitState(
			{ ...positionState, castlingRights: nextRights },
			{ message: 'Castling rights updated.' },
		);
	}

	function applyEnPassant(event: SubmitEvent): void {
		event.preventDefault();
		const validation = validateEnPassantTarget(enPassantDraft);
		if (!validation.valid) {
			enPassantError = validation.error ?? 'The en-passant field is invalid.';
			onvaliditychange?.(false);
			enPassantInputElement.focus();
			return;
		}

		enPassantError = '';
		commitState(
			{ ...positionState, enPassant: canonicalizeEnPassantTarget(enPassantDraft) },
			{ message: 'En-passant state updated.' },
		);
	}

	function handleEnPassantDraftInput(event: Event): void {
		const draft = (event.currentTarget as HTMLInputElement).value;
		enPassantError = '';
		onvaliditychange?.(draft === positionState.enPassant);
	}

	function placePiece(event: SubmitEvent): void {
		event.preventDefault();
		if (!boardAdapter) {
			boardError = 'The board is not ready yet.';
			return;
		}

		boardAdapter.place(selectedSquare, selectedPiece);
		statusMessage = `Placed a piece on ${selectedSquare}.`;
	}

	function removePiece(): void {
		if (!boardAdapter) {
			boardError = 'The board is not ready yet.';
			return;
		}

		boardAdapter.remove(selectedSquare);
		statusMessage = `Cleared ${selectedSquare}.`;
	}

	function movePiece(event: SubmitEvent): void {
		event.preventDefault();
		if (!boardAdapter) {
			boardError = 'The board is not ready yet.';
			return;
		}

		if (!boardAdapter.move(fromSquare, toSquare)) {
			boardError =
				fromSquare === toSquare
					? 'Choose two different squares.'
					: `There is no piece on ${fromSquare}.`;
			fromSquareElement.focus();
			return;
		}

		boardError = '';
		statusMessage = `Moved the piece from ${fromSquare} to ${toSquare}.`;
	}

	function clearBoard(): void {
		commitState(parseFen(EMPTY_BOARD_FEN), { message: 'Board cleared.' });
		boardElement.focus();
	}

	function resetPosition(): void {
		commitState(parseFen(INITIAL_FEN), { message: 'Initial position restored.' });
		boardElement.focus();
	}
</script>

<section class="position-editor" aria-labelledby="position-editor-title">
	<header class="editor-heading">
		<div>
			<p class="section-kicker">Position editor</p>
			<h2 id="position-editor-title">Build a test position</h2>
		</div>
		<p>Editing stays local. Evaluation only happens from a later explicit action.</p>
	</header>

	<form class="fen-import" onsubmit={importFen} novalidate>
		<label for="position-fen">Import FEN</label>
		<div class="field-row">
			<input
				id="position-fen"
				bind:this={fenInputElement}
				bind:value={fenDraft}
				oninput={handleFenDraftInput}
				aria-describedby={fenError ? 'fen-error' : 'fen-help'}
				aria-invalid={fenError ? 'true' : 'false'}
				autocomplete="off"
				spellcheck="false"
			/>
			<button type="submit">Import</button>
		</div>
		<p id="fen-help" class="field-help">
			Four- or six-field FEN; move counters are validated then omitted.
		</p>
		{#if fenError}
			<p id="fen-error" class="field-error" role="alert">{fenError}</p>
		{/if}
	</form>

	<div class="editor-layout" data-testid="editor-layout">
		<div class="board-column">
			<div class="board-frame">
				<div
					bind:this={boardElement}
					class="chessground-host"
					tabindex="-1"
					role="img"
					aria-label="Editable Dice Chess board"
					aria-describedby="board-help"
				></div>
			</div>
			<p id="board-help" class="board-help">
				Drag pieces with a pointer, or use the labelled keyboard controls alongside the board.
			</p>

			<div class="board-actions" aria-label="Board presets">
				<button type="button" class="secondary" onclick={clearBoard}>Clear board</button>
				<button type="button" class="secondary" onclick={resetPosition}>Initial position</button>
			</div>
		</div>

		<div class="controls-column">
			<fieldset>
				<legend>Side to move</legend>
				<div class="segmented-control">
					<label>
						<input
							type="radio"
							name="active-color"
							value="w"
							checked={positionState.activeColor === 'w'}
							onchange={() => setActiveColor('w')}
						/>
						White
					</label>
					<label>
						<input
							type="radio"
							name="active-color"
							value="b"
							checked={positionState.activeColor === 'b'}
							onchange={() => setActiveColor('b')}
						/>
						Black
					</label>
				</div>
			</fieldset>

			<fieldset>
				<legend>Castling rights</legend>
				<div class="castling-grid">
					{#each castlingOptions as option (option.symbol)}
						<label>
							<input
								type="checkbox"
								aria-label={option.label}
								checked={hasCastlingRight(option.symbol)}
								onchange={(event) => setCastlingRight(option.symbol, event.currentTarget.checked)}
							/>
							<span>{option.symbol}</span>
						</label>
					{/each}
				</div>
			</fieldset>

			<form class="control-card" onsubmit={applyEnPassant} novalidate>
				<label for="en-passant">En-passant target(s)</label>
				<div class="field-row compact">
					<input
						id="en-passant"
						bind:this={enPassantInputElement}
						bind:value={enPassantDraft}
						oninput={handleEnPassantDraftInput}
						aria-describedby={enPassantError ? 'en-passant-error' : 'en-passant-help'}
						aria-invalid={enPassantError ? 'true' : 'false'}
						autocomplete="off"
						spellcheck="false"
					/>
					<button type="submit" class="secondary">Apply</button>
				</div>
				<p id="en-passant-help" class="field-help">
					Use “-” or concatenated targets such as a3c3e3.
				</p>
				{#if enPassantError}
					<p id="en-passant-error" class="field-error" role="alert">{enPassantError}</p>
				{/if}
			</form>

			<form class="control-card" onsubmit={placePiece}>
				<h3>Place or remove a piece</h3>
				<div class="control-grid">
					<label for="piece-to-place">
						Piece
						<select id="piece-to-place" bind:value={selectedPiece}>
							{#each EDITOR_PIECES as piece (piece.symbol)}
								<option value={piece.symbol}>{piece.glyph} {piece.label}</option>
							{/each}
						</select>
					</label>
					<label for="square-to-edit">
						Square
						<select id="square-to-edit" bind:value={selectedSquare}>
							{#each EDITOR_SQUARES as square (square)}
								<option value={square}>{square}</option>
							{/each}
						</select>
					</label>
				</div>
				<div class="button-row">
					<button type="submit">Place piece</button>
					<button type="button" class="secondary" onclick={removePiece}>Remove piece</button>
				</div>
			</form>

			<form class="control-card" onsubmit={movePiece}>
				<h3>Move a piece by keyboard</h3>
				<div class="control-grid">
					<label for="move-from-square">
						From square
						<select id="move-from-square" bind:this={fromSquareElement} bind:value={fromSquare}>
							{#each EDITOR_SQUARES as square (square)}
								<option value={square}>{square}</option>
							{/each}
						</select>
					</label>
					<label for="move-to-square">
						To square
						<select id="move-to-square" bind:value={toSquare}>
							{#each EDITOR_SQUARES as square (square)}
								<option value={square}>{square}</option>
							{/each}
						</select>
					</label>
				</div>
				<button type="submit">Move piece</button>
			</form>

			{#if boardError}
				<p class="field-error" role="alert">{boardError}</p>
			{/if}
			<p class="status-message" aria-live="polite">{statusMessage}</p>
		</div>
	</div>
</section>

<style>
	.position-editor {
		width: min(100%, 76rem);
		padding: clamp(1rem, 3vw, 2rem);
		border: 1px solid rgb(148 163 184 / 18%);
		border-radius: 1.5rem;
		background: rgb(15 23 42 / 78%);
		box-shadow: 0 2rem 6rem rgb(0 0 0 / 28%);
		backdrop-filter: blur(1rem);
	}

	.editor-heading {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 1.5rem;
		margin-bottom: 1.5rem;
	}

	.editor-heading h2,
	.control-card h3 {
		margin: 0;
	}

	.editor-heading h2 {
		font-size: clamp(1.65rem, 4vw, 2.4rem);
		letter-spacing: -0.035em;
	}

	.editor-heading > p {
		max-width: 31rem;
		margin: 0;
		color: #aab5c5;
		line-height: 1.55;
	}

	.section-kicker {
		margin: 0 0 0.35rem;
		color: #60a5fa;
		font-size: 0.72rem;
		font-weight: 750;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.fen-import,
	.control-card,
	fieldset {
		padding: 1rem;
		border: 1px solid rgb(148 163 184 / 16%);
		border-radius: 1rem;
		background: rgb(8 12 22 / 54%);
	}

	.fen-import {
		margin-bottom: 1.5rem;
	}

	.editor-layout {
		display: grid;
		grid-template-columns: minmax(18rem, 1.05fr) minmax(18rem, 0.95fr);
		gap: clamp(1.25rem, 3vw, 2rem);
		align-items: start;
	}

	.board-column,
	.controls-column {
		min-width: 0;
	}

	.board-frame {
		width: 100%;
		aspect-ratio: 1;
		overflow: hidden;
		border: 0.4rem solid #1e293b;
		border-radius: 1rem;
		background: #d8b170;
		box-shadow: 0 1.5rem 3rem rgb(0 0 0 / 28%);
	}

	.chessground-host {
		width: 100%;
		height: 100%;
	}

	.chessground-host:focus-visible {
		outline: 0.25rem solid #60a5fa;
		outline-offset: -0.25rem;
	}

	.board-help,
	.field-help {
		margin: 0.6rem 0 0;
		color: #94a3b8;
		font-size: 0.78rem;
		line-height: 1.45;
	}

	.board-actions,
	.button-row,
	.field-row {
		display: flex;
		gap: 0.65rem;
	}

	.board-actions {
		margin-top: 1rem;
	}

	.controls-column {
		display: grid;
		gap: 1rem;
	}

	fieldset {
		margin: 0;
	}

	legend,
	label,
	.control-card h3 {
		font-size: 0.86rem;
		font-weight: 700;
	}

	legend {
		padding: 0 0.35rem;
	}

	.segmented-control,
	.castling-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.6rem;
	}

	.segmented-control label,
	.castling-grid label {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.7rem;
		border-radius: 0.7rem;
		background: rgb(30 41 59 / 72%);
	}

	.castling-grid {
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}

	.castling-grid label {
		justify-content: center;
	}

	.castling-grid span {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	.field-row {
		align-items: stretch;
	}

	.field-row input {
		flex: 1;
		min-width: 0;
	}

	.field-row.compact input {
		width: 8rem;
	}

	.control-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
		margin: 0.8rem 0;
	}

	.control-grid label {
		display: grid;
		gap: 0.35rem;
	}

	input,
	select,
	button {
		min-height: 2.75rem;
		border-radius: 0.7rem;
		font: inherit;
	}

	input,
	select {
		box-sizing: border-box;
		width: 100%;
		border: 1px solid #475569;
		padding: 0.65rem 0.75rem;
		color: #e5e7eb;
		background: #0f172a;
	}

	input[type='radio'],
	input[type='checkbox'] {
		width: 1.05rem;
		min-height: auto;
		accent-color: #60a5fa;
	}

	input[aria-invalid='true'] {
		border-color: #fb7185;
	}

	button {
		border: 1px solid #3b82f6;
		padding: 0.65rem 1rem;
		color: #eff6ff;
		background: #2563eb;
		font-weight: 750;
		cursor: pointer;
	}

	button.secondary {
		border-color: #475569;
		background: #1e293b;
	}

	button:hover {
		background: #1d4ed8;
	}

	button.secondary:hover {
		background: #334155;
	}

	button:focus-visible,
	input:focus-visible,
	select:focus-visible {
		outline: 0.2rem solid #60a5fa;
		outline-offset: 0.15rem;
	}

	.field-error {
		margin: 0.65rem 0 0;
		color: #fda4af;
		font-size: 0.82rem;
		font-weight: 650;
		line-height: 1.45;
	}

	.status-message {
		min-height: 1.25rem;
		margin: 0;
		color: #a7f3d0;
		font-size: 0.82rem;
	}

	@media (max-width: 56rem) {
		.editor-heading {
			display: grid;
		}

		.editor-layout {
			grid-template-columns: minmax(0, 1fr);
		}

		.board-column {
			width: min(100%, 38rem);
			margin-inline: auto;
		}
	}

	@media (max-width: 32rem) {
		.position-editor {
			padding: 0.8rem;
			border-radius: 1rem;
		}

		.field-row,
		.board-actions,
		.button-row,
		.control-grid {
			grid-template-columns: minmax(0, 1fr);
			flex-direction: column;
		}

		.castling-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
