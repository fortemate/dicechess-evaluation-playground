import { describe, expect, it } from 'vitest';
import {
	boardToPiecePlacement,
	canonicalizeFen,
	parseFen,
	piecePlacementToBoard,
	serializeFen,
	validateFen,
	validatePositionState,
} from './fen.js';
import {
	EMPTY_BOARD_FEN,
	INITIAL_FEN,
	type ActiveColor,
	type Board,
	type PositionState,
} from './model.js';

describe('FEN Parsing & Validation', () => {
	describe('validateFen', () => {
		it('accepts standard starting position FEN (4-field)', () => {
			const result = validateFen(INITIAL_FEN);
			expect(result.valid).toBe(true);
			expect(result.error).toBeUndefined();
		});

		it('accepts standard starting position FEN (6-field)', () => {
			const fen6 = `${INITIAL_FEN} 0 1`;
			const result = validateFen(fen6);
			expect(result.valid).toBe(true);
			expect(result.error).toBeUndefined();
		});

		it('accepts empty board FEN', () => {
			const result = validateFen(EMPTY_BOARD_FEN);
			expect(result.valid).toBe(true);
		});

		it('rejects empty or whitespace-only FEN strings', () => {
			expect(validateFen('').valid).toBe(false);
			expect(validateFen('   ').valid).toBe(false);
		});

		it('rejects wrong number of fields', () => {
			expect(validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR').valid).toBe(false);
			expect(validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w').valid).toBe(false);
			expect(validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq').valid).toBe(false);
			expect(validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0').valid).toBe(
				false,
			);
			expect(validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 2').valid).toBe(
				false,
			);
		});

		it('rejects malformed rank count in piece placement', () => {
			const result = validateFen('8/8/8/8/8/8/8 w - -');
			expect(result.valid).toBe(false);
			expect(result.error).toContain('expected 8 ranks');
		});

		it('rejects malformed rank widths', () => {
			// Rank width 7
			const result1 = validateFen('rnbqkbn/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
			expect(result1.valid).toBe(false);
			expect(result1.error).toContain('rank 8 width is 7');

			// Rank width 9
			const result2 = validateFen('rnbqkbnr1/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
			expect(result2.valid).toBe(false);
			expect(result2.error).toContain('rank 8 width is 9');
		});

		it('rejects unsupported piece symbols', () => {
			const result = validateFen('rnbqkbnx/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
			expect(result.valid).toBe(false);
			expect(result.error).toContain("unsupported symbol 'x'");
		});

		it('rejects invalid active color', () => {
			expect(validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR W KQkq -').valid).toBe(false);
			expect(validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq -').valid).toBe(false);
			expect(validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR white KQkq -').valid).toBe(
				false,
			);
		});

		it('rejects duplicate castling symbols', () => {
			const result1 = validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KKkq -');
			expect(result1.valid).toBe(false);
			expect(result1.error).toContain("Duplicate castling symbol 'K'");

			const result2 = validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w QqQ -');
			expect(result2.valid).toBe(false);
			expect(result2.error).toContain("Duplicate castling symbol 'Q'");
		});

		it('rejects invalid castling symbols', () => {
			const result1 = validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w X -');
			expect(result1.valid).toBe(false);
			expect(result1.error).toContain("Invalid castling symbol 'X'");

			const result2 = validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w K- -');
			expect(result2.valid).toBe(false);
			expect(result2.error).toContain("Invalid castling symbol '-'");
		});

		it('rejects invalid en-passant syntax', () => {
			expect(validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq e9').valid).toBe(
				false,
			);
			expect(validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq i3').valid).toBe(
				false,
			);
			expect(validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq E3').valid).toBe(
				false,
			);
			expect(validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq e33').valid).toBe(
				false,
			);
			expect(validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq invalid').valid).toBe(
				false,
			);
		});
	});

	describe('parseFen & serializeFen', () => {
		it('parses 4-field FEN correctly into PositionState', () => {
			const state = parseFen(INITIAL_FEN);
			expect(state).toEqual({
				piecePlacement: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR',
				activeColor: 'w',
				castlingRights: 'KQkq',
				enPassant: '-',
			});
		});

		it('parses 6-field FEN and ignores move counters', () => {
			const fen6 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
			const state = parseFen(fen6);
			expect(state).toEqual({
				piecePlacement: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR',
				activeColor: 'b',
				castlingRights: 'KQkq',
				enPassant: 'e3',
			});

			const serialized = serializeFen(state);
			expect(serialized).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3');
		});

		it('canonicalizes non-canonical castling order', () => {
			const state = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w qK -');
			expect(state.castlingRights).toBe('Kq');

			const serialized = serializeFen(state);
			expect(serialized).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w Kq -');
		});

		it('canonicalizes uncompressed empty squares in piece placement', () => {
			const state = parseFen('r111k3/8/8/8/8/8/8/8 w - -');
			expect(state.piecePlacement).toBe('r3k3/8/8/8/8/8/8/8');

			const serialized = serializeFen(state);
			expect(serialized).toBe('r3k3/8/8/8/8/8/8/8 w - -');
		});

		it('throws Error when parsing invalid FEN', () => {
			expect(() => parseFen('invalid fen')).toThrowError('Invalid FEN');
		});

		it('throws Error when serializing invalid PositionState', () => {
			const invalidState = {
				piecePlacement: '8/8/8/8/8/8/8', // 7 ranks
				activeColor: 'w',
				castlingRights: '-',
				enPassant: '-',
			} as PositionState;

			expect(() => serializeFen(invalidState)).toThrowError();
		});

		it('round-trip serialize and parse', () => {
			const originalFen = 'r1bqk2r/pp1ppp1p/2n3pn/8/4P3/2P2N2/P1P2PPP/R1BQKB1R w KQkq -';
			const state = parseFen(originalFen);
			const serialized = serializeFen(state);
			expect(serialized).toBe(originalFen);
		});

		it('canonicalizeFen helper produces 4-field deterministic FEN', () => {
			const fen6 = 'r1bqk2r/pp1ppp1p/2n3pn/8/4P3/2P2N2/P1P2PPP/R1BQKB1R w qK - 5 12';
			const canonical = canonicalizeFen(fen6);
			expect(canonical).toBe('r1bqk2r/pp1ppp1p/2n3pn/8/4P3/2P2N2/P1P2PPP/R1BQKB1R w Kq -');
		});
	});

	describe('Explicit state & non-inference', () => {
		it('does NOT infer castling rights from piece placement', () => {
			// Board has 8 empty ranks (no rooks, no king), but castling rights is 'KQkq'
			const emptyWithCastling = '8/8/8/8/8/8/8/8 w KQkq -';
			const result = validateFen(emptyWithCastling);
			expect(result.valid).toBe(true);

			const state = parseFen(emptyWithCastling);
			expect(state.castlingRights).toBe('KQkq');
			expect(serializeFen(state)).toBe('8/8/8/8/8/8/8/8 w KQkq -');
		});

		it('does NOT infer en-passant target from piece placement', () => {
			// Board has no pawns, but en-passant target is 'e3'
			const noPawnsWithEp = '8/8/8/8/8/8/8/8 b - e3';
			const result = validateFen(noPawnsWithEp);
			expect(result.valid).toBe(true);

			const state = parseFen(noPawnsWithEp);
			expect(state.enPassant).toBe('e3');
			expect(serializeFen(state)).toBe('8/8/8/8/8/8/8/8 b - e3');
		});

		it('distinguishes syntax validation from evaluator game-legality', () => {
			// Position with 5 white kings and pawns on rank 1 (game-illegal, but syntactically valid)
			const illegalGamePosition = 'KKKKK3/8/8/8/8/8/8/PPPPPPPP w - -';
			const result = validateFen(illegalGamePosition);
			expect(result.valid).toBe(true);

			const state = parseFen(illegalGamePosition);
			expect(serializeFen(state)).toBe(illegalGamePosition);
		});
	});

	describe('Board matrix conversion helpers', () => {
		it('converts piece placement to board matrix and back', () => {
			const placement = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
			const board = piecePlacementToBoard(placement);

			expect(board.length).toBe(8);
			expect(board[0].length).toBe(8);
			expect(board[0][0]).toBe('r');
			expect(board[0][4]).toBe('k');
			expect(board[3][0]).toBeNull();

			const reconstructed = boardToPiecePlacement(board);
			expect(reconstructed).toBe(placement);
		});

		it('throws on invalid board dimensions when converting to piece placement', () => {
			expect(() => boardToPiecePlacement([] as unknown as Board)).toThrow(
				'Invalid board: expected 8 rows',
			);
			expect(() => boardToPiecePlacement([[null, null], [null]] as unknown as Board)).toThrow();
		});
	});

	describe('validatePositionState', () => {
		it('returns valid for well-formed PositionState', () => {
			const state: PositionState = {
				piecePlacement: '8/8/8/8/8/8/8/8',
				activeColor: 'w',
				castlingRights: 'Kq',
				enPassant: 'e3',
			};
			expect(validatePositionState(state).valid).toBe(true);
		});

		it('returns invalid for malformed PositionState fields', () => {
			const badColor: PositionState = {
				piecePlacement: '8/8/8/8/8/8/8/8',
				activeColor: 'x' as unknown as ActiveColor,
				castlingRights: '-',
				enPassant: '-',
			};
			expect(validatePositionState(badColor).valid).toBe(false);
		});
	});
});
