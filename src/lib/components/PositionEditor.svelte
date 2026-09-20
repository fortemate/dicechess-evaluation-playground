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
		piecePlacementToBoard,
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
		EDITOR_FILES,
		EDITOR_PIECES,
		EDITOR_RANKS,
		createChessgroundAdapter,
		type BoardOrientation,
		type ChessgroundAdapter,
	} from './chessground-adapter.js';

	/** What a click or Enter on a board square does: move pieces, erase them, or stamp a spare piece. */
	type EditorTool = 'move' | 'erase' | PieceSymbol;

	/** Pointer travel below this counts as a click on a spare piece rather than a drag. */
	const CLICK_TOLERANCE_PX = 4;

	interface Props {
		onchange?: (state: PositionState) => void;
		onvaliditychange?: (valid: boolean) => void;
	}

	let { onchange, onvaliditychange }: Props = $props();

	const PIECE_NAMES = Object.fromEntries(
		EDITOR_PIECES.map((piece) => [piece.symbol, piece.label.toLowerCase()]),
	) as Record<PieceSymbol, string>;
	const castlingOptions: readonly { symbol: CastlingSymbol; label: string }[] = [
		{ symbol: 'K', label: 'White kingside' },
		{ symbol: 'Q', label: 'White queenside' },
		{ symbol: 'k', label: 'Black kingside' },
		{ symbol: 'q', label: 'Black queenside' },
	];

	const startingState = parseFen(INITIAL_FEN);
	let positionState = $state<PositionState>({ ...startingState });
	let fenDraft = $state(serializeFen(startingState));
	let enPassantDraft = $state(startingState.enPassant);
	let fenError = $state('');
	let enPassantError = $state('');
	let boardError = $state('');
	let boardDraftValid = $state(true);
	let statusMessage = $state('Editor ready. No evaluation request has been sent.');

	let tool = $state<EditorTool>('move');
	let heldSquare = $state<Square>();
	let orientation = $state<BoardOrientation>('white');
	let focusedSquare = $state<Square>('e4');

	let boardElement: HTMLDivElement;
	let squareGridElement: HTMLDivElement;
	let fenInputElement: HTMLInputElement;
	let enPassantInputElement: HTMLInputElement;
	let boardAdapter: ChessgroundAdapter | undefined;

	const piecesBySquare = $derived.by(() => {
		const pieces: Partial<Record<Square, PieceSymbol>> = {};
		piecePlacementToBoard(positionState.piecePlacement).forEach((row, rankIndex) => {
			row.forEach((piece, fileIndex) => {
				if (piece) {
					pieces[`${EDITOR_FILES[fileIndex]}${EDITOR_RANKS[rankIndex]}`] = piece;
				}
			});
		});
		return pieces;
	});
	const displayFiles = $derived(
		orientation === 'white' ? [...EDITOR_FILES] : [...EDITOR_FILES].reverse(),
	);
	const displayRanks = $derived(
		orientation === 'white' ? [...EDITOR_RANKS] : [...EDITOR_RANKS].reverse(),
	);
	const topSpares = $derived(EDITOR_PIECES.filter((piece) => piece.color !== orientation));
	const bottomSpares = $derived(EDITOR_PIECES.filter((piece) => piece.color === orientation));
	const toolKind = $derived(tool === 'move' || tool === 'erase' ? tool : 'piece');
	const toolHint = $derived.by(() => {
		if (tool === 'move') {
			return 'Drag pieces to move them. Drag a piece off the board to remove it.';
		}
		if (tool === 'erase') {
			return 'Erase: click a piece to remove it. Press Escape or choose Move when you are done.';
		}
		return `Place: click a square to put a ${PIECE_NAMES[tool]} there. Press Escape or choose Move when you are done.`;
	});

	onMount(() => {
		boardAdapter = createChessgroundAdapter(boardElement, {
			state: positionState,
			orientation,
			onPiecePlacementChange: handlePiecePlacementChange,
		});

		return () => boardAdapter?.destroy();
	});

	function notifyEvaluationReadiness(drafts: { fen?: string; enPassant?: string } = {}): void {
		const candidateFen = drafts.fen ?? fenDraft;
		const candidateEnPassant = drafts.enPassant ?? enPassantDraft;
		onvaliditychange?.(
			boardDraftValid &&
				candidateFen === serializeFen(positionState) &&
				candidateEnPassant === positionState.enPassant,
		);
	}

	function commitState(
		nextState: PositionState,
		options: { syncBoard?: boolean; message?: string } = {},
	): boolean {
		const validation = validatePositionState(nextState);
		if (!validation.valid) {
			boardError = validation.error ?? 'The position is invalid.';
			boardDraftValid = false;
			notifyEvaluationReadiness();
			return false;
		}

		if (nextState.piecePlacement !== positionState.piecePlacement) {
			heldSquare = undefined;
		}

		positionState = { ...nextState };
		fenDraft = serializeFen(positionState);
		enPassantDraft = positionState.enPassant;
		fenError = '';
		enPassantError = '';
		boardError = '';
		boardDraftValid = true;

		if (options.syncBoard !== false) {
			boardAdapter?.sync(positionState);
		}

		onchange?.({ ...positionState });
		notifyEvaluationReadiness();
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
			notifyEvaluationReadiness();
			fenInputElement.focus();
			return;
		}

		fenError = '';
		commitState(parseFen(fenDraft), { message: 'FEN imported.' });
		focusSquare(focusedSquare);
	}

	function handleFenDraftInput(event: Event): void {
		const draft = (event.currentTarget as HTMLInputElement).value;
		fenError = '';
		notifyEvaluationReadiness({ fen: draft });
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
			notifyEvaluationReadiness();
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
		notifyEvaluationReadiness({ enPassant: draft });
	}

	function clearBoard(): void {
		commitState(parseFen(EMPTY_BOARD_FEN), { message: 'Board cleared.' });
		focusSquare(focusedSquare);
	}

	function resetPosition(): void {
		commitState(parseFen(INITIAL_FEN), { message: 'Initial position restored.' });
		focusSquare(focusedSquare);
	}

	function flipBoard(): void {
		orientation = orientation === 'white' ? 'black' : 'white';
		boardAdapter?.setOrientation(orientation);
		statusMessage = `Board flipped: ${orientation} is now at the bottom.`;
	}

	function selectTool(nextTool: 'move' | 'erase'): void {
		tool = tool === nextTool ? 'move' : nextTool;
		heldSquare = undefined;
		statusMessage =
			tool === 'erase'
				? 'Erase tool selected. Click a piece to remove it.'
				: 'Move tool selected. Drag pieces or pick them up with Enter.';
	}

	function toggleSpare(symbol: PieceSymbol): void {
		if (tool === symbol) {
			tool = 'move';
			statusMessage = 'Move tool selected. Drag pieces or pick them up with Enter.';
			return;
		}
		tool = symbol;
		heldSquare = undefined;
		statusMessage = `${capitalize(PIECE_NAMES[symbol])} selected. Click a square to place it.`;
	}

	/**
	 * Pressing a spare piece starts a Chessground drag of a brand-new piece.
	 * Dragging it onto the board drops it there (Chessground reports the
	 * change). A plain click, or a drag released off the board, arms the piece
	 * as the current tool so that it can be stamped onto squares. Keyboard and
	 * assistive-technology activation arrives as a bare click and arms it too.
	 */
	function spareDrag(node: HTMLButtonElement, symbol: PieceSymbol) {
		let pointerPress = false;
		let releasePending: (() => void) | undefined;

		const start = (event: MouseEvent | TouchEvent): void => {
			if (!boardAdapter || (event instanceof MouseEvent && event.button !== 0)) {
				return;
			}

			event.preventDefault();
			releasePending?.();
			pointerPress = true;
			const startPoint = pointOf(event);
			const isTouch = event.type === 'touchstart';
			const endType = isTouch ? 'touchend' : 'mouseup';
			boardAdapter.dragNewPiece(symbol, event);

			const finish = (): void => {
				releasePending = undefined;
				document.removeEventListener(endType, release);
				document.removeEventListener('touchcancel', finish);
				// The click a mouse release on the button dispatches next is already
				// handled by `release`; drop the flag once it has passed.
				setTimeout(() => {
					pointerPress = false;
				}, 0);
			};
			const release = (endEvent: Event): void => {
				finish();
				const endPoint = pointOf(endEvent);
				const droppedOnBoard =
					startPoint !== undefined &&
					endPoint !== undefined &&
					Math.hypot(endPoint[0] - startPoint[0], endPoint[1] - startPoint[1]) >
						CLICK_TOLERANCE_PX &&
					boardAdapter?.squareAt(endPoint[0], endPoint[1]) !== undefined;
				if (!droppedOnBoard) {
					toggleSpare(symbol);
				}
			};

			releasePending = finish;
			document.addEventListener(endType, release);
			if (isTouch) {
				// A cancelled touch (system gesture, scroll takeover) never fires touchend.
				document.addEventListener('touchcancel', finish);
			}
		};

		const click = (): void => {
			if (!pointerPress) {
				toggleSpare(symbol);
			}
		};

		node.addEventListener('mousedown', start);
		node.addEventListener('touchstart', start, { passive: false });
		node.addEventListener('click', click);
		return {
			destroy() {
				releasePending?.();
				node.removeEventListener('mousedown', start);
				node.removeEventListener('touchstart', start);
				node.removeEventListener('click', click);
			},
		};
	}

	function pointOf(event: Event): [number, number] | undefined {
		if (event instanceof MouseEvent) {
			return [event.clientX, event.clientY];
		}
		const touch = (event as TouchEvent).changedTouches?.[0];
		return touch ? [touch.clientX, touch.clientY] : undefined;
	}

	function applyToolToSquare(square: Square): void {
		if (!boardAdapter) {
			boardError = 'The board is not ready yet.';
			return;
		}

		boardError = '';
		const piece = piecesBySquare[square];

		if (tool === 'erase') {
			removeAt(square);
			return;
		}

		if (tool !== 'move') {
			boardAdapter.place(square, tool);
			statusMessage = `Placed a ${PIECE_NAMES[tool]} on ${square}.`;
			return;
		}

		if (heldSquare === undefined) {
			if (!piece) {
				statusMessage = `There is no piece on ${square}.`;
				return;
			}
			heldSquare = square;
			statusMessage = `Picked up the ${PIECE_NAMES[piece]} on ${square}. Choose a destination square.`;
			return;
		}

		if (heldSquare === square) {
			heldSquare = undefined;
			statusMessage = `Put the piece back on ${square}.`;
			return;
		}

		const from = heldSquare;
		heldSquare = undefined;
		if (boardAdapter.move(from, square)) {
			statusMessage = `Moved the piece from ${from} to ${square}.`;
		} else {
			boardError = `There is no piece on ${from}.`;
		}
	}

	function removeAt(square: Square): void {
		if (!boardAdapter) {
			boardError = 'The board is not ready yet.';
			return;
		}

		const piece = piecesBySquare[square];
		if (!piece) {
			statusMessage = `${square} is already empty.`;
			return;
		}

		if (heldSquare === square) {
			heldSquare = undefined;
		}
		boardAdapter.remove(square);
		statusMessage = `Removed the ${PIECE_NAMES[piece]} from ${square}.`;
	}

	function cancelInteraction(): void {
		if (heldSquare !== undefined) {
			statusMessage = `Put the piece back on ${heldSquare}.`;
			heldSquare = undefined;
			return;
		}
		if (tool !== 'move') {
			tool = 'move';
			statusMessage = 'Move tool selected. Drag pieces or pick them up with Enter.';
		}
	}

	function handleSquareKeydown(event: KeyboardEvent): void {
		const square = (event.target as HTMLElement).dataset.square as Square | undefined;
		if (!square) {
			return;
		}

		const fileIndex = displayFiles.indexOf(square[0] as (typeof EDITOR_FILES)[number]);
		const rankIndex = displayRanks.indexOf(square[1] as (typeof EDITOR_RANKS)[number]);
		let next: Square | undefined;

		switch (event.key) {
			case 'ArrowLeft':
				next = squareAtDisplay(fileIndex - 1, rankIndex);
				break;
			case 'ArrowRight':
				next = squareAtDisplay(fileIndex + 1, rankIndex);
				break;
			case 'ArrowUp':
				next = squareAtDisplay(fileIndex, rankIndex - 1);
				break;
			case 'ArrowDown':
				next = squareAtDisplay(fileIndex, rankIndex + 1);
				break;
			case 'Home':
				next = squareAtDisplay(0, rankIndex);
				break;
			case 'End':
				next = squareAtDisplay(7, rankIndex);
				break;
			case 'Delete':
			case 'Backspace':
				event.preventDefault();
				removeAt(square);
				return;
			case 'Escape':
				event.preventDefault();
				cancelInteraction();
				return;
			default:
				return;
		}

		event.preventDefault();
		if (next) {
			focusSquare(next);
		}
	}

	function squareAtDisplay(fileIndex: number, rankIndex: number): Square | undefined {
		if (fileIndex < 0 || fileIndex > 7 || rankIndex < 0 || rankIndex > 7) {
			return undefined;
		}
		return `${displayFiles[fileIndex]}${displayRanks[rankIndex]}`;
	}

	function focusSquare(square: Square): void {
		focusedSquare = square;
		squareGridElement.querySelector<HTMLElement>(`[data-square="${square}"]`)?.focus();
	}

	function squareLabel(square: Square): string {
		const piece = piecesBySquare[square];
		const held = heldSquare === square ? ', picked up' : '';
		return `${square}, ${piece ? PIECE_NAMES[piece] : 'empty'}${held}`;
	}

	function capitalize(text: string): string {
		return text.charAt(0).toUpperCase() + text.slice(1);
	}
</script>

{#snippet spareRow(spares: typeof EDITOR_PIECES, color: string)}
	<div class="spare-row cg-wrap" role="group" aria-label="{color} spare pieces">
		{#each spares as spare (spare.symbol)}
			<button
				type="button"
				class="spare"
				aria-label={spare.label}
				aria-pressed={tool === spare.symbol}
				title="Drag onto the board, or select and click squares"
				use:spareDrag={spare.symbol}
			>
				<piece class="spare-piece {spare.color} {spare.role}" aria-hidden="true"></piece>
			</button>
		{/each}
	</div>
{/snippet}

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
			{@render spareRow(topSpares, orientation === 'white' ? 'Black' : 'White')}

			<div class="board-stage" data-tool={toolKind}>
				<div bind:this={boardElement} class="chessground-host" aria-hidden="true"></div>
				<div
					bind:this={squareGridElement}
					class="square-grid"
					role="grid"
					tabindex="-1"
					aria-label="Editable Dice Chess board"
					aria-describedby="board-help"
					aria-rowcount="8"
					aria-colcount="8"
					onkeydown={handleSquareKeydown}
				>
					{#each displayRanks as rank (rank)}
						<div class="square-row" role="row">
							{#each displayFiles as file (file)}
								{@const square = `${file}${rank}` as Square}
								<button
									type="button"
									role="gridcell"
									class="square"
									data-square={square}
									data-held={heldSquare === square ? 'true' : undefined}
									tabindex={focusedSquare === square ? 0 : -1}
									aria-label={squareLabel(square)}
									onclick={() => applyToolToSquare(square)}
									onfocus={() => (focusedSquare = square)}
								></button>
							{/each}
						</div>
					{/each}
				</div>
			</div>

			{@render spareRow(bottomSpares, orientation === 'white' ? 'White' : 'Black')}

			<div class="board-toolbar">
				<div class="tool-group" role="group" aria-label="Board tool">
					<button
						type="button"
						class="tool"
						aria-pressed={tool === 'move'}
						onclick={() => selectTool('move')}
					>
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path
								d="M12 3v18M3 12h18m-9-9-3 3m3-3 3 3m-3 15-3-3m3 3 3-3M3 12l3-3m-3 3 3 3m15-3-3-3m3 3-3 3"
							/>
						</svg>
						Move
					</button>
					<button
						type="button"
						class="tool erase"
						aria-pressed={tool === 'erase'}
						onclick={() => selectTool('erase')}
					>
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M4 7h16M10 3h4l1 2H9l1-2ZM6 7l1 13h10l1-13M10 11v6m4-6v6" />
						</svg>
						Erase
					</button>
				</div>
				<div class="board-actions" role="group" aria-label="Board presets">
					<button type="button" class="secondary" onclick={flipBoard}>
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M7 4v13M7 4 4 7m3-3 3 3m7 13V7m0 13 3-3m-3 3-3-3" />
						</svg>
						Flip board
					</button>
					<button type="button" class="secondary" onclick={clearBoard}>Clear board</button>
					<button type="button" class="secondary" onclick={resetPosition}>Initial position</button>
				</div>
			</div>

			<p class="board-hint" data-tool={toolKind}>{toolHint}</p>
			<p id="board-help" class="board-help">
				Keyboard: Tab to the board, arrow keys move between squares, Enter picks up and drops a
				piece or applies the selected tool, Delete removes a piece, Escape cancels.
			</p>
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
						<label title={option.label}>
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
				<p class="field-help">K, Q: White kingside and queenside. k, q: Black.</p>
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
					Use “-” or concatenated targets such as a3c3e3. Board edits never change this field.
				</p>
				{#if enPassantError}
					<p id="en-passant-error" class="field-error" role="alert">{enPassantError}</p>
				{/if}
			</form>

			<div class="control-card status-card">
				<p class="status-label">Editor status</p>
				{#if boardError}
					<p class="field-error" role="alert">{boardError}</p>
				{/if}
				<p class="status-message" aria-live="polite">{statusMessage}</p>
			</div>
		</div>
	</div>
</section>

<style>
	.position-editor {
		box-sizing: border-box;
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

	.editor-heading h2 {
		margin: 0;
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
		grid-template-columns: minmax(18rem, 1.15fr) minmax(17rem, 0.85fr);
		gap: clamp(1.25rem, 3vw, 2rem);
		align-items: start;
	}

	.board-column,
	.controls-column {
		min-width: 0;
	}

	.board-column {
		display: grid;
		gap: 0.75rem;
	}

	/* Spare pieces: the `cg-wrap` class lets Chessground's piece-set CSS paint them. */
	.spare-row {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 0.35rem;
		padding: 0.35rem;
		border: 1px solid #1e293b;
		border-radius: 0.85rem;
		/* A light, board-like tone keeps black spare pieces legible on the dark page. */
		background: #e3cda6;
	}

	.spare {
		display: block;
		box-sizing: border-box;
		min-height: 0;
		aspect-ratio: 1;
		max-height: 4rem;
		padding: 0.2rem;
		border: 1px solid transparent;
		border-radius: 0.6rem;
		background: transparent;
		cursor: grab;
		touch-action: none;
	}

	.spare:hover {
		background: rgb(0 0 0 / 12%);
	}

	.spare[aria-pressed='true'] {
		border-color: #1d4ed8;
		background: rgb(37 99 235 / 32%);
		box-shadow: 0 0 0 0.15rem rgb(37 99 235 / 45%);
	}

	.spare-row piece.spare-piece {
		position: static;
		display: block;
		width: 100%;
		height: 100%;
		background-position: center;
		background-size: contain;
		pointer-events: none;
	}

	.board-stage {
		position: relative;
		z-index: 1;
		width: 100%;
		aspect-ratio: 1;
		border: 0.35rem solid #1e293b;
		border-radius: 0.4rem;
		background: #d8b170;
		box-shadow: 0 1.5rem 3rem rgb(0 0 0 / 28%);
	}

	.chessground-host {
		position: absolute;
		inset: 0;
	}

	/* Transparent, focusable squares laid over Chessground for keyboard use and tool clicks. */
	.square-grid {
		position: absolute;
		z-index: 3;
		inset: 0;
		display: grid;
		grid-template-rows: repeat(8, minmax(0, 1fr));
		pointer-events: none;
	}

	.square-row {
		display: grid;
		grid-template-columns: repeat(8, minmax(0, 1fr));
	}

	.square {
		min-height: 0;
		margin: 0;
		border: 0;
		border-radius: 0;
		padding: 0;
		background: transparent;
	}

	.square:focus-visible {
		outline: 0.22rem solid #60a5fa;
		outline-offset: -0.22rem;
	}

	.square[data-held] {
		background: rgb(251 191 36 / 28%);
		box-shadow: inset 0 0 0 0.25rem #fbbf24;
	}

	.board-stage[data-tool='erase'] .square-grid,
	.board-stage[data-tool='piece'] .square-grid {
		pointer-events: auto;
	}

	.board-stage[data-tool='piece'] .square {
		cursor: copy;
	}

	.board-stage[data-tool='erase'] .square {
		cursor: crosshair;
	}

	.board-stage[data-tool='piece'] .square:hover {
		background: rgb(96 165 250 / 38%);
	}

	.board-stage[data-tool='erase'] .square:hover {
		background: rgb(251 113 133 / 42%);
	}

	.board-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.65rem;
	}

	.tool-group,
	.board-actions,
	.field-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.tool-group {
		padding: 0.25rem;
		border: 1px solid rgb(148 163 184 / 16%);
		border-radius: 0.85rem;
		background: rgb(8 12 22 / 54%);
	}

	button.tool {
		min-height: 2.4rem;
		border-color: transparent;
		padding: 0.45rem 0.85rem;
		background: transparent;
		color: #cbd5e1;
	}

	button.tool:hover {
		background: rgb(30 41 59 / 85%);
	}

	button.tool[aria-pressed='true'] {
		border-color: #3b82f6;
		background: #2563eb;
		color: #eff6ff;
	}

	button.tool.erase[aria-pressed='true'] {
		border-color: #f43f5e;
		background: #be123c;
	}

	button svg {
		width: 1.1em;
		height: 1.1em;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.board-hint,
	.board-help,
	.field-help {
		margin: 0;
		color: #94a3b8;
		font-size: 0.78rem;
		line-height: 1.45;
	}

	.board-hint {
		color: #cbd5e1;
		font-weight: 600;
	}

	.board-hint[data-tool='erase'] {
		color: #fda4af;
	}

	.board-hint[data-tool='piece'] {
		color: #93c5fd;
	}

	.field-help {
		margin-top: 0.6rem;
	}

	.controls-column {
		display: grid;
		gap: 1rem;
	}

	fieldset {
		margin: 0;
	}

	legend,
	label {
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
		cursor: pointer;
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
		flex: 0 1 9rem;
	}

	input,
	button {
		min-height: 2.75rem;
		border-radius: 0.7rem;
		font: inherit;
	}

	input {
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
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
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
	input:focus-visible {
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

	.status-card {
		display: grid;
		gap: 0.35rem;
	}

	.status-label {
		margin: 0;
		color: #94a3b8;
		font-size: 0.72rem;
		font-weight: 750;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.status-card .field-error {
		margin: 0;
	}

	.status-message {
		min-height: 1.25rem;
		margin: 0;
		color: #a7f3d0;
		font-size: 0.82rem;
		line-height: 1.45;
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

		.field-row {
			flex-direction: column;
		}

		.field-row.compact input {
			flex-basis: auto;
		}

		.board-toolbar {
			flex-direction: column;
			align-items: stretch;
		}

		.tool-group button,
		.board-actions button {
			flex: 1 1 auto;
		}

		.castling-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
