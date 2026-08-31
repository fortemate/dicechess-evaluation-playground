// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Config } from '@lichess-org/chessground/config';
import type { Key, Piece } from '@lichess-org/chessground/types';

import { parseFen } from '$lib/position/fen.js';

import { EDITOR_PIECES, EDITOR_SQUARES, createChessgroundAdapter } from './chessground-adapter.js';

vi.mock('@lichess-org/chessground', () => ({ Chessground: vi.fn() }));

const chessgroundMock = vi.mocked(Chessground);
const initialState = parseFen('8/8/8/8/8/8/4P3/4K3 w - -');

let currentFen: string;
let pieces: Map<Key, Piece>;
let api: Api;

beforeEach(() => {
	currentFen = initialState.piecePlacement;
	pieces = new Map<Key, Piece>([
		['e2', { color: 'white', role: 'pawn' }],
		['e1', { color: 'white', role: 'king' }],
	]);

	api = {
		state: { pieces } as Api['state'],
		set: vi.fn((config: Config) => {
			if (config.fen) currentFen = config.fen;
		}),
		getFen: vi.fn(() => currentFen),
		setPieces: vi.fn((diff) => {
			for (const [square, piece] of diff) {
				if (piece) pieces.set(square, piece);
				else pieces.delete(square);
			}
		}),
		destroy: vi.fn(),
	} as unknown as Api;

	chessgroundMock.mockReset();
	chessgroundMock.mockReturnValue(api);
});

describe('chessground adapter', () => {
	it('exposes complete editor choices', () => {
		expect(EDITOR_PIECES).toHaveLength(12);
		expect(EDITOR_PIECES.map(({ symbol }) => symbol)).toEqual([
			'K',
			'Q',
			'R',
			'B',
			'N',
			'P',
			'k',
			'q',
			'r',
			'b',
			'n',
			'p',
		]);
		expect(EDITOR_SQUARES).toHaveLength(64);
		expect(EDITOR_SQUARES[0]).toBe('a8');
		expect(EDITOR_SQUARES.at(-1)).toBe('h1');
	});

	it('creates a free editor and reports pointer moves through canonical placement', () => {
		const onPiecePlacementChange = vi.fn();
		const element = document.createElement('div');
		createChessgroundAdapter(element, { state: initialState, onPiecePlacementChange });

		expect(chessgroundMock).toHaveBeenCalledOnce();
		const config = chessgroundMock.mock.calls[0][1];
		expect(config).toMatchObject({
			fen: initialState.piecePlacement,
			turnColor: 'white',
			autoCastle: false,
			disableContextMenu: true,
			movable: { free: true, color: 'both', rookCastle: false },
			draggable: { enabled: true, deleteOnDropOff: false },
		});

		currentFen = '4k3/8/8/8/8/8/8/4K3';
		config?.movable?.events?.after?.('e2', 'e4', { premove: false });
		expect(onPiecePlacementChange).toHaveBeenCalledWith(currentFen);
	});

	it('synchronizes placement and active color without emitting a change', () => {
		const onPiecePlacementChange = vi.fn();
		const adapter = createChessgroundAdapter(document.createElement('div'), {
			state: initialState,
			onPiecePlacementChange,
		});
		const blackState = parseFen('8/8/8/8/8/8/8/8 b - -');

		adapter.sync(blackState);

		expect(api.set).toHaveBeenCalledWith({
			fen: blackState.piecePlacement,
			turnColor: 'black',
		});
		expect(onPiecePlacementChange).not.toHaveBeenCalled();
	});

	it('places and removes mapped pieces', () => {
		const onPiecePlacementChange = vi.fn();
		const adapter = createChessgroundAdapter(document.createElement('div'), {
			state: initialState,
			onPiecePlacementChange,
		});

		currentFen = '8/8/8/8/8/8/8/1n6';
		adapter.place('b1', 'n');
		const placeDiff = vi.mocked(api.setPieces).mock.calls[0][0];
		expect(placeDiff.get('b1')).toEqual({ color: 'black', role: 'knight' });

		currentFen = '8/8/8/8/8/8/8/8';
		adapter.remove('b1');
		const removeDiff = vi.mocked(api.setPieces).mock.calls[1][0];
		expect(removeDiff.has('b1')).toBe(true);
		expect(removeDiff.get('b1')).toBeUndefined();
		expect(onPiecePlacementChange).toHaveBeenNthCalledWith(1, '8/8/8/8/8/8/8/1n6');
		expect(onPiecePlacementChange).toHaveBeenNthCalledWith(2, '8/8/8/8/8/8/8/8');
	});

	it('rejects impossible keyboard moves and performs a valid capture-style move', () => {
		const onPiecePlacementChange = vi.fn();
		const adapter = createChessgroundAdapter(document.createElement('div'), {
			state: initialState,
			onPiecePlacementChange,
		});

		expect(adapter.move('a1', 'a2')).toBe(false);
		expect(adapter.move('e2', 'e2')).toBe(false);
		expect(api.setPieces).not.toHaveBeenCalled();

		currentFen = '8/8/8/8/4P3/8/8/4K3';
		expect(adapter.move('e2', 'e4')).toBe(true);
		const moveDiff = vi.mocked(api.setPieces).mock.calls[0][0];
		expect(moveDiff.get('e2')).toBeUndefined();
		expect(moveDiff.get('e4')).toEqual({ color: 'white', role: 'pawn' });
		expect(onPiecePlacementChange).toHaveBeenCalledWith(currentFen);
	});

	it('destroys the Chessground instance', () => {
		const adapter = createChessgroundAdapter(document.createElement('div'), {
			state: initialState,
			onPiecePlacementChange: vi.fn(),
		});

		adapter.destroy();
		expect(api.destroy).toHaveBeenCalledOnce();
	});
});
