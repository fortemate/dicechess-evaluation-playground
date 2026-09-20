// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Config } from '@lichess-org/chessground/config';
import type { Key, Piece } from '@lichess-org/chessground/types';

import { parseFen } from '$lib/position/fen.js';

import {
	EDITOR_FILES,
	EDITOR_PIECES,
	EDITOR_RANKS,
	EDITOR_SQUARES,
	createChessgroundAdapter,
} from './chessground-adapter.js';

vi.mock('@lichess-org/chessground', () => ({ Chessground: vi.fn() }));

const chessgroundMock = vi.mocked(Chessground);
const initialState = parseFen('8/8/8/8/8/8/4P3/4K3 w - -');

let currentFen: string;
let pieces: Map<Key, Piece>;
let boundsClear: ReturnType<typeof vi.fn>;
let api: Api;

beforeEach(() => {
	currentFen = initialState.piecePlacement;
	pieces = new Map<Key, Piece>([
		['e2', { color: 'white', role: 'pawn' }],
		['e1', { color: 'white', role: 'king' }],
	]);

	boundsClear = vi.fn();
	api = {
		state: { pieces, dom: { bounds: { clear: boundsClear } } } as unknown as Api['state'],
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
		dragNewPiece: vi.fn(),
		getKeyAtDomPos: vi.fn(() => undefined),
		destroy: vi.fn(),
	} as unknown as Api;

	chessgroundMock.mockReset();
	chessgroundMock.mockReturnValue(api);
});

function createAdapter(onPiecePlacementChange = vi.fn()) {
	return {
		onPiecePlacementChange,
		adapter: createChessgroundAdapter(document.createElement('div'), {
			state: initialState,
			orientation: 'white',
			onPiecePlacementChange,
		}),
	};
}

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
		expect(EDITOR_PIECES.filter(({ color }) => color === 'white')).toHaveLength(6);
		expect(EDITOR_PIECES.find(({ symbol }) => symbol === 'n')).toMatchObject({
			color: 'black',
			role: 'knight',
			label: 'Black knight',
		});
		expect(EDITOR_FILES).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
		expect(EDITOR_RANKS).toEqual(['8', '7', '6', '5', '4', '3', '2', '1']);
		expect(EDITOR_SQUARES).toHaveLength(64);
		expect(EDITOR_SQUARES[0]).toBe('a8');
		expect(EDITOR_SQUARES.at(-1)).toBe('h1');
	});

	it('creates a free editor that deletes on drop-off and reports Chessground changes canonically', () => {
		const onPiecePlacementChange = vi.fn();
		const element = document.createElement('div');
		createChessgroundAdapter(element, {
			state: initialState,
			orientation: 'black',
			onPiecePlacementChange,
		});

		expect(chessgroundMock).toHaveBeenCalledOnce();
		expect(chessgroundMock.mock.calls[0][0]).toBe(element);
		const config = chessgroundMock.mock.calls[0][1];
		expect(config).toMatchObject({
			fen: initialState.piecePlacement,
			orientation: 'black',
			turnColor: 'white',
			autoCastle: false,
			disableContextMenu: true,
			highlight: { lastMove: false, check: false },
			movable: { free: true, color: 'both', rookCastle: false },
			draggable: { enabled: true, deleteOnDropOff: true },
			selectable: { enabled: true },
			drawable: { enabled: false },
		});
		expect(config?.movable?.events).toBeUndefined();

		currentFen = '4k3/8/8/8/8/8/8/4K3';
		config?.events?.change?.();
		expect(onPiecePlacementChange).toHaveBeenCalledExactlyOnceWith(currentFen);
	});

	it('synchronizes placement and active color without emitting a change', () => {
		const { adapter, onPiecePlacementChange } = createAdapter();
		const blackState = parseFen('8/8/8/8/8/8/8/8 b - -');

		adapter.sync(blackState);

		expect(api.set).toHaveBeenCalledWith({
			fen: blackState.piecePlacement,
			turnColor: 'black',
		});
		expect(onPiecePlacementChange).not.toHaveBeenCalled();
	});

	it('places and removes mapped pieces', () => {
		const { adapter, onPiecePlacementChange } = createAdapter();

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
		const { adapter, onPiecePlacementChange } = createAdapter();

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

	it('starts a forced Chessground drag for a spare piece from fresh board bounds', () => {
		const { adapter, onPiecePlacementChange } = createAdapter();
		const event = new MouseEvent('mousedown', { clientX: 10, clientY: 20 });

		adapter.dragNewPiece('q', event);

		expect(boundsClear).toHaveBeenCalledOnce();
		expect(boundsClear.mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(api.dragNewPiece).mock.invocationCallOrder[0],
		);
		expect(api.dragNewPiece).toHaveBeenCalledExactlyOnceWith(
			{ color: 'black', role: 'queen' },
			event,
			true,
		);
		expect(onPiecePlacementChange).not.toHaveBeenCalled();
	});

	it('resolves viewport points to board squares through Chessground', () => {
		const { adapter } = createAdapter();

		expect(adapter.squareAt(5, 6)).toBeUndefined();
		expect(api.getKeyAtDomPos).toHaveBeenCalledWith([5, 6]);

		vi.mocked(api.getKeyAtDomPos).mockReturnValue('c3');
		expect(adapter.squareAt(120, 240)).toBe('c3');
		expect(api.getKeyAtDomPos).toHaveBeenLastCalledWith([120, 240]);
	});

	it('changes the orientation without emitting a change', () => {
		const { adapter, onPiecePlacementChange } = createAdapter();

		adapter.setOrientation('black');

		expect(api.set).toHaveBeenCalledExactlyOnceWith({ orientation: 'black' });
		expect(onPiecePlacementChange).not.toHaveBeenCalled();
	});

	it('destroys the Chessground instance', () => {
		const { adapter } = createAdapter();

		adapter.destroy();
		expect(api.destroy).toHaveBeenCalledOnce();
	});
});
