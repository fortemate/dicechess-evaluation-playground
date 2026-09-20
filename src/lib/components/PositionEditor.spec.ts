// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';

import { parseFen } from '$lib/position/fen.js';
import type { PositionState, Square } from '$lib/position/model.js';

import PositionEditor from './PositionEditor.svelte';

const boardHarness = vi.hoisted(() => ({
	create: vi.fn(),
	sync: vi.fn(),
	place: vi.fn(),
	remove: vi.fn(),
	move: vi.fn(),
	dragNewPiece: vi.fn(),
	squareAt: vi.fn(),
	setOrientation: vi.fn(),
	destroy: vi.fn(),
	onPiecePlacementChange: undefined as ((piecePlacement: string) => void) | undefined,
}));

vi.mock('./chessground-adapter.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./chessground-adapter.js')>();
	return {
		...actual,
		createChessgroundAdapter: boardHarness.create.mockImplementation((_element, options) => {
			boardHarness.onPiecePlacementChange = options.onPiecePlacementChange;
			return {
				sync: boardHarness.sync,
				place: boardHarness.place,
				remove: boardHarness.remove,
				move: boardHarness.move,
				dragNewPiece: boardHarness.dragNewPiece,
				squareAt: boardHarness.squareAt,
				setOrientation: boardHarness.setOrientation,
				destroy: boardHarness.destroy,
			};
		}),
	};
});

beforeEach(() => {
	vi.clearAllMocks();
	boardHarness.onPiecePlacementChange = undefined;
	boardHarness.move.mockReturnValue(true);
	boardHarness.squareAt.mockReturnValue(undefined);
});

const INITIAL_PLACEMENT = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

function board(): HTMLElement {
	return screen.getByRole('grid', { name: 'Editable Dice Chess board' });
}

function square(name: string): HTMLButtonElement {
	return screen.getByRole<HTMLButtonElement>('gridcell', { name });
}

function tool(name: 'Move' | 'Erase'): HTMLButtonElement {
	return screen.getByRole<HTMLButtonElement>('button', { name });
}

function focusedSquare(): Square | undefined {
	return (document.activeElement as HTMLElement | null)?.dataset.square as Square | undefined;
}

async function renderEditor(props: Record<string, unknown> = {}) {
	const result = render(PositionEditor, props);
	await waitFor(() => expect(boardHarness.create).toHaveBeenCalledOnce());
	return result;
}

describe('PositionEditor', () => {
	it('renders explicit-state controls, spare pieces, tools and a keyboard board without network access', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		await renderEditor();

		expect(boardHarness.create).toHaveBeenCalledWith(
			expect.any(HTMLElement),
			expect.objectContaining({ orientation: 'white' }),
		);
		expect(screen.getByRole('heading', { name: 'Build a test position' })).toBeTruthy();
		expect(screen.getByLabelText('Import FEN')).toBeTruthy();
		expect(board().getAttribute('aria-describedby')).toBe('board-help');

		const squares = screen.getAllByRole('gridcell');
		expect(squares).toHaveLength(64);
		expect(squares[0].getAttribute('aria-label')).toBe('a8, black rook');
		expect(squares.at(-1)?.getAttribute('aria-label')).toBe('h1, white rook');
		expect(squares.filter((cell) => cell.tabIndex === 0)).toEqual([square('e4, empty')]);

		const spareGroups = screen.getAllByRole('group', { name: /spare pieces/ });
		expect(spareGroups.map((group) => group.getAttribute('aria-label'))).toEqual([
			'Black spare pieces',
			'White spare pieces',
		]);
		expect(screen.getByRole('button', { name: 'White knight' }).getAttribute('aria-pressed')).toBe(
			'false',
		);
		expect(tool('Move').getAttribute('aria-pressed')).toBe('true');
		expect(tool('Erase').getAttribute('aria-pressed')).toBe('false');
		expect(screen.getByRole('button', { name: 'Flip board' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Clear board' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Initial position' })).toBeTruthy();

		expect(screen.getByRole('group', { name: 'Side to move' })).toBeTruthy();
		expect(screen.getByRole('group', { name: 'Castling rights' })).toBeTruthy();
		expect(screen.getByLabelText('En-passant target(s)')).toBeTruthy();
		expect(screen.queryByLabelText('Square')).toBeNull();
		expect(screen.queryByLabelText('From square')).toBeNull();
		expect(screen.getByTestId('editor-layout').classList.contains('editor-layout')).toBe(true);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('imports and canonicalizes valid FEN from the keyboard', async () => {
		const user = userEvent.setup();
		const onchange = vi.fn<(state: PositionState) => void>();
		await renderEditor({ onchange });
		const input = screen.getByLabelText<HTMLInputElement>('Import FEN');

		await user.clear(input);
		await user.type(input, '8/8/8/8/8/8/8/K6k b qK e3a3 0 1');
		await user.keyboard('{Enter}');

		expect(onchange).toHaveBeenLastCalledWith({
			piecePlacement: '8/8/8/8/8/8/8/K6k',
			activeColor: 'b',
			castlingRights: 'Kq',
			enPassant: 'a3e3',
		});
		expect(input.value).toBe('8/8/8/8/8/8/8/K6k b Kq a3e3');
		expect(screen.getByLabelText<HTMLInputElement>('Black').checked).toBe(true);
		expect(document.activeElement).toBe(square('e4, empty'));
		expect(square('a1, white king')).toBeTruthy();
		expect(boardHarness.sync).toHaveBeenCalledOnce();
	});

	it('reports invalid FEN inline, preserves state, and returns focus to the field', async () => {
		const user = userEvent.setup();
		const onchange = vi.fn();
		render(PositionEditor, { onchange });
		const input = screen.getByLabelText<HTMLInputElement>('Import FEN');

		await user.clear(input);
		await user.type(input, 'not a position');
		await user.click(screen.getByRole('button', { name: 'Import' }));

		expect(screen.getByRole('alert').textContent).toContain('expected 4 or 6 fields');
		expect(input.value).toBe('not a position');
		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(document.activeElement).toBe(input);
		expect(onchange).not.toHaveBeenCalled();
		expect(boardHarness.sync).not.toHaveBeenCalled();
	});

	it('reports uncommitted and invalid drafts as not ready for evaluation', async () => {
		const user = userEvent.setup();
		const onvaliditychange = vi.fn<(valid: boolean) => void>();
		render(PositionEditor, { onvaliditychange });
		const input = screen.getByLabelText<HTMLInputElement>('Import FEN');

		await user.clear(input);
		await user.type(input, 'not a position');
		expect(onvaliditychange).toHaveBeenLastCalledWith(false);

		const enPassantInput = screen.getByLabelText<HTMLInputElement>('En-passant target(s)');
		await user.clear(enPassantInput);
		await user.type(enPassantInput, '-');
		expect(onvaliditychange).toHaveBeenLastCalledWith(false);

		await user.click(screen.getByRole('button', { name: 'Import' }));
		expect(screen.getByRole('alert')).toBeTruthy();

		await user.click(screen.getByLabelText('Black'));
		expect(screen.queryByRole('alert')).toBeNull();
		expect(onvaliditychange).toHaveBeenLastCalledWith(true);

		await user.clear(input);
		await user.type(input, '8/8/8/8/8/8/8/K6k b - -');
		expect(onvaliditychange).toHaveBeenLastCalledWith(false);

		await user.click(screen.getByRole('button', { name: 'Import' }));
		expect(onvaliditychange).toHaveBeenLastCalledWith(true);
	});

	it('updates side, castling, and validated multi-target en-passant independently', async () => {
		const user = userEvent.setup();
		const onchange = vi.fn<(state: PositionState) => void>();
		render(PositionEditor, { onchange });

		await user.click(screen.getByLabelText('Black'));
		await user.click(screen.getByLabelText('White queenside'));
		expect(onchange).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ activeColor: 'b', castlingRights: 'Kkq' }),
		);

		const enPassantInput = screen.getByLabelText<HTMLInputElement>('En-passant target(s)');
		await user.clear(enPassantInput);
		await user.type(enPassantInput, 'e3a3e3');
		await user.click(screen.getByRole('button', { name: 'Apply' }));
		expect(screen.getByRole('alert').textContent).toContain('Duplicate en-passant square');
		expect(document.activeElement).toBe(enPassantInput);

		await user.clear(enPassantInput);
		await user.type(enPassantInput, 'e3a3');
		await user.click(screen.getByRole('button', { name: 'Apply' }));
		expect(onchange).toHaveBeenLastCalledWith(
			expect.objectContaining({ activeColor: 'b', castlingRights: 'Kkq', enPassant: 'a3e3' }),
		);
		expect(enPassantInput.value).toBe('a3e3');
	});

	it('arms a clicked spare piece, stamps it onto squares, and disarms it on a second click', async () => {
		const user = userEvent.setup();
		const onchange = vi.fn<(state: PositionState) => void>();
		const { container } = await renderEditor({ onchange });
		const knight = screen.getByRole('button', { name: 'White knight' });
		const stage = container.querySelector('.board-stage');

		await user.click(knight);
		expect(boardHarness.dragNewPiece).toHaveBeenCalledExactlyOnceWith('N', expect.any(MouseEvent));
		expect(boardHarness.squareAt).not.toHaveBeenCalled();
		expect(knight.getAttribute('aria-pressed')).toBe('true');
		expect(tool('Move').getAttribute('aria-pressed')).toBe('false');
		expect(stage?.getAttribute('data-tool')).toBe('piece');
		expect(screen.getByText(/Place: click a square to put a white knight there/)).toBeTruthy();

		await user.click(square('b4, empty'));
		expect(boardHarness.place).toHaveBeenCalledExactlyOnceWith('b4', 'N');
		expect(screen.getByText('Placed a white knight on b4.')).toBeTruthy();

		boardHarness.onPiecePlacementChange?.('rnbqkbnr/pppppppp/8/8/1N6/8/PPPPPPPP/RNBQKBNR');
		await tick();
		expect(onchange).toHaveBeenLastCalledWith(
			expect.objectContaining({
				piecePlacement: 'rnbqkbnr/pppppppp/8/8/1N6/8/PPPPPPPP/RNBQKBNR',
			}),
		);
		expect(square('b4, white knight')).toBeTruthy();

		await user.click(knight);
		expect(knight.getAttribute('aria-pressed')).toBe('false');
		expect(tool('Move').getAttribute('aria-pressed')).toBe('true');
		expect(stage?.getAttribute('data-tool')).toBe('move');
	});

	it('drops a dragged spare piece on the board without arming it, and arms it from the keyboard', async () => {
		const user = userEvent.setup();
		await renderEditor();
		const queen = screen.getByRole('button', { name: 'Black queen' });

		boardHarness.squareAt.mockReturnValue('e4');
		await user.pointer([
			{ keys: '[MouseLeft>]', target: queen, coords: { clientX: 10, clientY: 10 } },
			{ coords: { clientX: 300, clientY: 300 } },
			{ keys: '[/MouseLeft]', coords: { clientX: 300, clientY: 300 } },
		]);
		expect(boardHarness.dragNewPiece).toHaveBeenCalledExactlyOnceWith('q', expect.any(MouseEvent));
		expect(boardHarness.squareAt).toHaveBeenCalledExactlyOnceWith(300, 300);
		expect(queen.getAttribute('aria-pressed')).toBe('false');

		boardHarness.squareAt.mockReturnValue(undefined);
		await user.pointer([
			{ keys: '[MouseLeft>]', target: queen, coords: { clientX: 10, clientY: 10 } },
			{ coords: { clientX: 300, clientY: 300 } },
			{ keys: '[/MouseLeft]', coords: { clientX: 300, clientY: 300 } },
		]);
		expect(queen.getAttribute('aria-pressed')).toBe('true');
		await user.click(queen);
		expect(queen.getAttribute('aria-pressed')).toBe('false');

		queen.focus();
		await user.keyboard('{Enter}');
		expect(queen.getAttribute('aria-pressed')).toBe('true');
		expect(screen.getByText('Black queen selected. Click a square to place it.')).toBeTruthy();

		await user.keyboard('{Enter}');
		expect(queen.getAttribute('aria-pressed')).toBe('false');
	});

	it('arms a spare piece on a tap, ignores a cancelled touch, and drops stale release listeners', async () => {
		const user = userEvent.setup();
		await renderEditor();
		const bishop = screen.getByRole('button', { name: 'White bishop' });

		// A completed tap arms the piece exactly once.
		bishop.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }));
		expect(boardHarness.dragNewPiece).toHaveBeenCalledExactlyOnceWith('B', expect.any(Event));
		document.dispatchEvent(new Event('touchend'));
		await tick();
		expect(bishop.getAttribute('aria-pressed')).toBe('true');
		document.dispatchEvent(new Event('touchend'));
		await tick();
		expect(bishop.getAttribute('aria-pressed')).toBe('true');

		// A cancelled touch neither toggles nor blocks the next keyboard activation.
		bishop.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }));
		document.dispatchEvent(new Event('touchcancel'));
		await tick();
		expect(bishop.getAttribute('aria-pressed')).toBe('true');
		bishop.focus();
		await user.keyboard('{Enter}');
		expect(bishop.getAttribute('aria-pressed')).toBe('false');
		document.dispatchEvent(new Event('touchend'));
		await tick();
		expect(bishop.getAttribute('aria-pressed')).toBe('false');

		// A mouse release on the button is handled once; a later stray mouseup is ignored.
		await user.click(bishop);
		expect(bishop.getAttribute('aria-pressed')).toBe('true');
		fireEvent.mouseUp(document);
		await tick();
		expect(bishop.getAttribute('aria-pressed')).toBe('true');
	});

	it('removes pending document listeners when unmounted mid-press', async () => {
		const { unmount } = await renderEditor();
		const rook = screen.getByRole('button', { name: 'White rook' });

		fireEvent.mouseDown(rook, { button: 0 });
		expect(boardHarness.dragNewPiece).toHaveBeenCalledOnce();
		unmount();
		expect(() => fireEvent.mouseUp(document)).not.toThrow();
		expect(boardHarness.squareAt).not.toHaveBeenCalled();
		expect(boardHarness.destroy).toHaveBeenCalledOnce();
	});

	it('erases pieces with the Erase tool by click and with Delete from the keyboard', async () => {
		const user = userEvent.setup();
		const { container } = await renderEditor();

		await user.click(tool('Erase'));
		expect(tool('Erase').getAttribute('aria-pressed')).toBe('true');
		expect(tool('Move').getAttribute('aria-pressed')).toBe('false');
		expect(container.querySelector('.board-stage')?.getAttribute('data-tool')).toBe('erase');

		await user.click(square('e2, white pawn'));
		expect(boardHarness.remove).toHaveBeenCalledExactlyOnceWith('e2');
		expect(screen.getByText('Removed the white pawn from e2.')).toBeTruthy();

		await user.click(square('e4, empty'));
		expect(boardHarness.remove).toHaveBeenCalledOnce();
		expect(screen.getByText('e4 is already empty.')).toBeTruthy();

		await user.keyboard('{Escape}');
		expect(tool('Erase').getAttribute('aria-pressed')).toBe('false');
		expect(tool('Move').getAttribute('aria-pressed')).toBe('true');

		square('d2, white pawn').focus();
		await user.keyboard('{Delete}');
		expect(boardHarness.remove).toHaveBeenLastCalledWith('d2');

		await user.click(tool('Erase'));
		await user.click(tool('Erase'));
		expect(tool('Move').getAttribute('aria-pressed')).toBe('true');
	});

	it('moves pieces from the keyboard by picking them up and dropping them', async () => {
		const user = userEvent.setup();
		await renderEditor();

		square('e4, empty').focus();
		await user.keyboard('{ArrowDown}{ArrowDown}');
		expect(focusedSquare()).toBe('e2');

		await user.keyboard('{Enter}');
		expect(square('e2, white pawn, picked up').dataset.held).toBe('true');
		expect(
			screen.getByText('Picked up the white pawn on e2. Choose a destination square.'),
		).toBeTruthy();

		await user.keyboard('{Enter}');
		expect(screen.queryByRole('gridcell', { name: /picked up/ })).toBeNull();
		expect(screen.getByText('Put the piece back on e2.')).toBeTruthy();

		await user.keyboard('{Enter}{ArrowUp}{ArrowUp}');
		expect(focusedSquare()).toBe('e4');
		await user.keyboard('{Enter}');
		expect(boardHarness.move).toHaveBeenCalledExactlyOnceWith('e2', 'e4');
		expect(screen.getByText('Moved the piece from e2 to e4.')).toBeTruthy();
		expect(screen.queryByRole('gridcell', { name: /picked up/ })).toBeNull();

		await user.keyboard('{Enter}');
		expect(screen.getByText('There is no piece on e4.')).toBeTruthy();

		await user.keyboard('{ArrowDown}{ArrowDown}{Enter}{Escape}');
		expect(screen.queryByRole('gridcell', { name: /picked up/ })).toBeNull();
		expect(screen.getByText('Put the piece back on e2.')).toBeTruthy();
	});

	it('keeps keyboard focus on the board edges and supports Home and End', async () => {
		const user = userEvent.setup();
		await renderEditor();

		square('e4, empty').focus();
		await user.keyboard('{Home}');
		expect(focusedSquare()).toBe('a4');
		await user.keyboard('{ArrowLeft}');
		expect(focusedSquare()).toBe('a4');
		await user.keyboard('{End}');
		expect(focusedSquare()).toBe('h4');
		await user.keyboard('{ArrowRight}');
		expect(focusedSquare()).toBe('h4');
		await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
		expect(focusedSquare()).toBe('h1');
		await user.keyboard('{ArrowUp}'.repeat(8));
		expect(focusedSquare()).toBe('h8');
		await user.keyboard('{Tab}');
		expect(focusedSquare()).toBeUndefined();

		expect(screen.getAllByRole('gridcell').filter((cell) => cell.tabIndex === 0)).toEqual([
			square('h8, black rook'),
		]);
	});

	it('reports impossible keyboard moves as an error', async () => {
		const user = userEvent.setup();
		boardHarness.move.mockReturnValue(false);
		await renderEditor();

		square('e2, white pawn').focus();
		await user.keyboard('{Enter}{ArrowUp}{Enter}');

		expect(boardHarness.move).toHaveBeenCalledWith('e2', 'e3');
		expect(screen.getByRole('alert').textContent).toBe('There is no piece on e2.');
	});

	it('flips the board, the spare rows, and the keyboard grid order', async () => {
		const user = userEvent.setup();
		await renderEditor();

		await user.click(screen.getByRole('button', { name: 'Flip board' }));

		expect(boardHarness.setOrientation).toHaveBeenCalledExactlyOnceWith('black');
		const squares = screen.getAllByRole('gridcell');
		expect(squares[0].getAttribute('aria-label')).toBe('h1, white rook');
		expect(squares.at(-1)?.getAttribute('aria-label')).toBe('a8, black rook');
		expect(
			screen
				.getAllByRole('group', { name: /spare pieces/ })
				.map((g) => g.getAttribute('aria-label')),
		).toEqual(['White spare pieces', 'Black spare pieces']);
		expect(screen.getByText('Board flipped: black is now at the bottom.')).toBeTruthy();

		square('e4, empty').focus();
		await user.keyboard('{ArrowUp}');
		expect(focusedSquare()).toBe('e3');
		await user.keyboard('{ArrowLeft}');
		expect(focusedSquare()).toBe('f3');
	});

	it('clears and restores the initial position without evaluating', async () => {
		const user = userEvent.setup();
		const onchange = vi.fn<(state: PositionState) => void>();
		await renderEditor({ onchange });

		square('e2, white pawn').focus();
		await user.keyboard('{Enter}');
		expect(square('e2, white pawn, picked up')).toBeTruthy();

		await user.click(screen.getByRole('button', { name: 'Clear board' }));
		expect(onchange).toHaveBeenLastCalledWith(parseFen('8/8/8/8/8/8/8/8 w - -'));
		expect(square('e2, empty')).toBeTruthy();
		expect(screen.queryByRole('gridcell', { name: /picked up/ })).toBeNull();
		expect(document.activeElement).toBe(square('e2, empty'));

		await user.click(screen.getByRole('button', { name: 'Initial position' }));
		expect(onchange).toHaveBeenLastCalledWith(parseFen(`${INITIAL_PLACEMENT} w KQkq -`));
		expect(document.activeElement).toBe(square('e2, white pawn'));
		expect(boardHarness.sync).toHaveBeenCalledTimes(2);
	});
});
