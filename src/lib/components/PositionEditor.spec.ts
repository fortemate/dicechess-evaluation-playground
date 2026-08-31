// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseFen } from '$lib/position/fen.js';
import type { PositionState } from '$lib/position/model.js';

import PositionEditor from './PositionEditor.svelte';

const boardHarness = vi.hoisted(() => ({
	create: vi.fn(),
	sync: vi.fn(),
	place: vi.fn(),
	remove: vi.fn(),
	move: vi.fn(),
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
				destroy: boardHarness.destroy,
			};
		}),
	};
});

beforeEach(() => {
	vi.clearAllMocks();
	boardHarness.onPiecePlacementChange = undefined;
	boardHarness.move.mockReturnValue(true);
});

describe('PositionEditor', () => {
	it('renders labelled explicit-state and keyboard controls without network access', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		render(PositionEditor);

		await waitFor(() => expect(boardHarness.create).toHaveBeenCalledOnce());
		expect(screen.getByRole('heading', { name: 'Build a test position' })).toBeTruthy();
		expect(screen.getByLabelText('Import FEN')).toBeTruthy();
		expect(screen.getByRole('img', { name: 'Editable Dice Chess board' })).toBeTruthy();
		expect(screen.getByRole('group', { name: 'Side to move' })).toBeTruthy();
		expect(screen.getByRole('group', { name: 'Castling rights' })).toBeTruthy();
		expect(screen.getByLabelText('En-passant target(s)')).toBeTruthy();
		expect(screen.getByLabelText('Piece')).toBeTruthy();
		expect(screen.getByLabelText('Square')).toBeTruthy();
		expect(screen.getByLabelText('From square')).toBeTruthy();
		expect(screen.getByLabelText('To square')).toBeTruthy();
		expect(screen.getByTestId('editor-layout').classList.contains('editor-layout')).toBe(true);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('imports and canonicalizes valid FEN from the keyboard', async () => {
		const user = userEvent.setup();
		const onchange = vi.fn<(state: PositionState) => void>();
		render(PositionEditor, { onchange });
		await waitFor(() => expect(boardHarness.create).toHaveBeenCalledOnce());
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
		expect(document.activeElement).toBe(
			screen.getByRole('img', { name: 'Editable Dice Chess board' }),
		);
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

	it('routes place, remove, pointer, and keyboard moves through the board adapter', async () => {
		const user = userEvent.setup();
		const onchange = vi.fn<(state: PositionState) => void>();
		render(PositionEditor, { onchange });
		await waitFor(() => expect(boardHarness.create).toHaveBeenCalledOnce());

		await user.selectOptions(screen.getByLabelText('Piece'), 'n');
		await user.selectOptions(screen.getByLabelText('Square'), 'b4');
		await user.click(screen.getByRole('button', { name: 'Place piece' }));
		expect(boardHarness.place).toHaveBeenCalledWith('b4', 'n');

		await user.click(screen.getByRole('button', { name: 'Remove piece' }));
		expect(boardHarness.remove).toHaveBeenCalledWith('b4');

		boardHarness.onPiecePlacementChange?.('8/8/8/8/1n6/8/8/8');
		expect(onchange).toHaveBeenLastCalledWith(
			expect.objectContaining({ piecePlacement: '8/8/8/8/1n6/8/8/8' }),
		);

		await user.selectOptions(screen.getByLabelText('From square'), 'b4');
		await user.selectOptions(screen.getByLabelText('To square'), 'c6');
		await user.click(screen.getByRole('button', { name: 'Move piece' }));
		expect(boardHarness.move).toHaveBeenCalledWith('b4', 'c6');
		expect(screen.getByText('Moved the piece from b4 to c6.')).toBeTruthy();
	});

	it('rejects impossible keyboard moves and focuses the source square', async () => {
		const user = userEvent.setup();
		boardHarness.move.mockReturnValue(false);
		render(PositionEditor);
		await waitFor(() => expect(boardHarness.create).toHaveBeenCalledOnce());

		const from = screen.getByLabelText<HTMLSelectElement>('From square');
		await user.selectOptions(from, 'a1');
		await user.selectOptions(screen.getByLabelText('To square'), 'a2');
		await user.click(screen.getByRole('button', { name: 'Move piece' }));

		expect(screen.getByRole('alert').textContent).toBe('There is no piece on a1.');
		expect(document.activeElement).toBe(from);
	});

	it('clears and restores the initial position without evaluating', async () => {
		const user = userEvent.setup();
		const onchange = vi.fn<(state: PositionState) => void>();
		render(PositionEditor, { onchange });
		await waitFor(() => expect(boardHarness.create).toHaveBeenCalledOnce());

		await user.click(screen.getByRole('button', { name: 'Clear board' }));
		expect(onchange).toHaveBeenLastCalledWith(parseFen('8/8/8/8/8/8/8/8 w - -'));

		await user.click(screen.getByRole('button', { name: 'Initial position' }));
		expect(onchange).toHaveBeenLastCalledWith(
			parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -'),
		);
		expect(document.activeElement).toBe(
			screen.getByRole('img', { name: 'Editable Dice Chess board' }),
		);
	});
});
