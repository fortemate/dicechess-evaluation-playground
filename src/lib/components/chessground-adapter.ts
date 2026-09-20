// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Config } from '@lichess-org/chessground/config';
import type { Key, MouchEvent, Piece } from '@lichess-org/chessground/types';

import { canonicalizePiecePlacement } from '$lib/position/fen.js';
import type { ActiveColor, PieceSymbol, PositionState, Square } from '$lib/position/model.js';

export type PieceColor = 'white' | 'black';
export type PieceRole = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';
export type BoardOrientation = PieceColor;

export interface EditorPiece {
	symbol: PieceSymbol;
	label: string;
	glyph: string;
	color: PieceColor;
	role: PieceRole;
}

export interface ChessgroundAdapter {
	sync(state: PositionState): void;
	place(square: Square, piece: PieceSymbol): void;
	remove(square: Square): void;
	move(from: Square, to: Square): boolean;
	/**
	 * Starts dragging a spare piece that is not on the board yet. Chessground
	 * follows the pointer on the document and drops the piece on the square
	 * under the release point, replacing whatever stands there; a release
	 * outside the board discards the spare piece and changes nothing.
	 */
	dragNewPiece(piece: PieceSymbol, event: MouseEvent | TouchEvent): void;
	/** The board square under a viewport point, or undefined outside the board. */
	squareAt(clientX: number, clientY: number): Square | undefined;
	setOrientation(orientation: BoardOrientation): void;
	destroy(): void;
}

interface CreateChessgroundAdapterOptions {
	state: PositionState;
	orientation: BoardOrientation;
	onPiecePlacementChange: (piecePlacement: string) => void;
}

export const EDITOR_PIECES: readonly EditorPiece[] = [
	{ symbol: 'K', label: 'White king', glyph: '♔', color: 'white', role: 'king' },
	{ symbol: 'Q', label: 'White queen', glyph: '♕', color: 'white', role: 'queen' },
	{ symbol: 'R', label: 'White rook', glyph: '♖', color: 'white', role: 'rook' },
	{ symbol: 'B', label: 'White bishop', glyph: '♗', color: 'white', role: 'bishop' },
	{ symbol: 'N', label: 'White knight', glyph: '♘', color: 'white', role: 'knight' },
	{ symbol: 'P', label: 'White pawn', glyph: '♙', color: 'white', role: 'pawn' },
	{ symbol: 'k', label: 'Black king', glyph: '♚', color: 'black', role: 'king' },
	{ symbol: 'q', label: 'Black queen', glyph: '♛', color: 'black', role: 'queen' },
	{ symbol: 'r', label: 'Black rook', glyph: '♜', color: 'black', role: 'rook' },
	{ symbol: 'b', label: 'Black bishop', glyph: '♝', color: 'black', role: 'bishop' },
	{ symbol: 'n', label: 'Black knight', glyph: '♞', color: 'black', role: 'knight' },
	{ symbol: 'p', label: 'Black pawn', glyph: '♟', color: 'black', role: 'pawn' },
];

export const EDITOR_FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
export const EDITOR_RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'] as const;

export const EDITOR_SQUARES: readonly Square[] = EDITOR_RANKS.flatMap((rank) =>
	EDITOR_FILES.map((file) => `${file}${rank}` as Square),
);

const PIECES_BY_SYMBOL: Readonly<Record<PieceSymbol, Piece>> = Object.fromEntries(
	EDITOR_PIECES.map(({ symbol, color, role }) => [symbol, { color, role }]),
) as Record<PieceSymbol, Piece>;

export function createChessgroundAdapter(
	element: HTMLElement,
	options: CreateChessgroundAdapterOptions,
): ChessgroundAdapter {
	const notifyPiecePlacementChange = (api: Api): void => {
		options.onPiecePlacementChange(canonicalizePiecePlacement(api.getFen()));
	};

	const config: Config = {
		fen: options.state.piecePlacement,
		orientation: options.orientation,
		turnColor: toChessgroundColor(options.state.activeColor),
		coordinates: true,
		autoCastle: false,
		disableContextMenu: true,
		animation: { enabled: false },
		highlight: { lastMove: false, check: false },
		movable: { free: true, color: 'both', rookCastle: false },
		premovable: { enabled: false },
		draggable: { enabled: true, deleteOnDropOff: true },
		selectable: { enabled: true },
		drawable: { enabled: false },
		// Fires after every board edit Chessground performs itself: a drag or
		// click-click move, a spare piece dropped on the board, and a piece
		// dragged off the board.
		events: { change: () => notifyPiecePlacementChange(api) },
	};

	const api = Chessground(element, config);

	const notify = (): void => notifyPiecePlacementChange(api);

	return {
		sync(state) {
			api.set({
				fen: state.piecePlacement,
				turnColor: toChessgroundColor(state.activeColor),
			});
		},
		place(square, piece) {
			api.setPieces(new Map<Key, Piece | undefined>([[square, PIECES_BY_SYMBOL[piece]]]));
			notify();
		},
		remove(square) {
			api.setPieces(new Map<Key, Piece | undefined>([[square, undefined]]));
			notify();
		},
		move(from, to) {
			const piece = api.state.pieces.get(from);
			if (!piece || from === to) {
				return false;
			}

			api.setPieces(
				new Map<Key, Piece | undefined>([
					[from, undefined],
					[to, piece],
				]),
			);
			notify();
			return true;
		},
		dragNewPiece(piece, event) {
			// Chessground refreshes its cached board rectangle from a scroll listener
			// that runs a frame later; a press right after a scroll would otherwise drop
			// the piece where the board used to be. Measure afresh first.
			api.state.dom.bounds.clear();
			api.dragNewPiece(PIECES_BY_SYMBOL[piece], event as MouchEvent, true);
		},
		squareAt(clientX, clientY) {
			return api.getKeyAtDomPos([clientX, clientY]) as Square | undefined;
		},
		setOrientation(orientation) {
			api.set({ orientation });
		},
		destroy() {
			api.destroy();
		},
	};
}

function toChessgroundColor(activeColor: ActiveColor): PieceColor {
	return activeColor === 'w' ? 'white' : 'black';
}
