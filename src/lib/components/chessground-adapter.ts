// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Config } from '@lichess-org/chessground/config';
import type { Key, Piece } from '@lichess-org/chessground/types';

import { canonicalizePiecePlacement } from '$lib/position/fen.js';
import type { ActiveColor, PieceSymbol, PositionState, Square } from '$lib/position/model.js';

export interface EditorPiece {
	symbol: PieceSymbol;
	label: string;
	glyph: string;
}

export interface ChessgroundAdapter {
	sync(state: PositionState): void;
	place(square: Square, piece: PieceSymbol): void;
	remove(square: Square): void;
	move(from: Square, to: Square): boolean;
	destroy(): void;
}

interface CreateChessgroundAdapterOptions {
	state: PositionState;
	onPiecePlacementChange: (piecePlacement: string) => void;
}

export const EDITOR_PIECES: readonly EditorPiece[] = [
	{ symbol: 'K', label: 'White king', glyph: '♔' },
	{ symbol: 'Q', label: 'White queen', glyph: '♕' },
	{ symbol: 'R', label: 'White rook', glyph: '♖' },
	{ symbol: 'B', label: 'White bishop', glyph: '♗' },
	{ symbol: 'N', label: 'White knight', glyph: '♘' },
	{ symbol: 'P', label: 'White pawn', glyph: '♙' },
	{ symbol: 'k', label: 'Black king', glyph: '♚' },
	{ symbol: 'q', label: 'Black queen', glyph: '♛' },
	{ symbol: 'r', label: 'Black rook', glyph: '♜' },
	{ symbol: 'b', label: 'Black bishop', glyph: '♝' },
	{ symbol: 'n', label: 'Black knight', glyph: '♞' },
	{ symbol: 'p', label: 'Black pawn', glyph: '♟' },
];

export const EDITOR_SQUARES: readonly Square[] = Array.from({ length: 8 }, (_, rankIndex) =>
	Array.from({ length: 8 }, (_, fileIndex) =>
		String.fromCharCode('a'.charCodeAt(0) + fileIndex).concat(String(8 - rankIndex)),
	),
).flat() as Square[];

const PIECES_BY_SYMBOL: Readonly<Record<PieceSymbol, Piece>> = {
	K: { color: 'white', role: 'king' },
	Q: { color: 'white', role: 'queen' },
	R: { color: 'white', role: 'rook' },
	B: { color: 'white', role: 'bishop' },
	N: { color: 'white', role: 'knight' },
	P: { color: 'white', role: 'pawn' },
	k: { color: 'black', role: 'king' },
	q: { color: 'black', role: 'queen' },
	r: { color: 'black', role: 'rook' },
	b: { color: 'black', role: 'bishop' },
	n: { color: 'black', role: 'knight' },
	p: { color: 'black', role: 'pawn' },
};

export function createChessgroundAdapter(
	element: HTMLElement,
	options: CreateChessgroundAdapterOptions,
): ChessgroundAdapter {
	const notifyPiecePlacementChange = (api: Api): void => {
		options.onPiecePlacementChange(canonicalizePiecePlacement(api.getFen()));
	};

	const config: Config = {
		fen: options.state.piecePlacement,
		turnColor: toChessgroundColor(options.state.activeColor),
		coordinates: true,
		autoCastle: false,
		disableContextMenu: true,
		animation: { enabled: false },
		movable: {
			free: true,
			color: 'both',
			rookCastle: false,
			events: {
				after: () => notifyPiecePlacementChange(api),
			},
		},
		premovable: { enabled: false },
		draggable: { enabled: true, deleteOnDropOff: false },
		selectable: { enabled: true },
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
		destroy() {
			api.destroy();
		},
	};
}

function toChessgroundColor(activeColor: ActiveColor): 'white' | 'black' {
	return activeColor === 'w' ? 'white' : 'black';
}
