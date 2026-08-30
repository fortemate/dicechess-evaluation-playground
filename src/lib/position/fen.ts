// SPDX-FileCopyrightText: 2026 Jegors Čemisovs
// SPDX-License-Identifier: AGPL-3.0-only

import type { ActiveColor, Board, EnPassantTarget, PieceSymbol, PositionState } from './model.js';
import { CANONICAL_CASTLING_SYMBOLS, VALID_PIECE_SYMBOLS } from './model.js';

const MAX_HALF_MOVE_CLOCK = 127;
const MAX_FULL_MOVE_NUMBER = 2_147_483_647;

export interface ValidationResult {
	valid: boolean;
	error?: string;
}

/**
 * Validates a FEN string for syntax correctness.
 * Accepts 4-field or 6-field FEN strings. Six-field move counters are
 * syntax-validated against the evaluator engine contract, then ignored.
 */
export function validateFen(fen: string): ValidationResult {
	const trimmed = fen.trim();
	if (!trimmed) {
		return { valid: false, error: 'FEN string cannot be empty' };
	}

	const fields = trimmed.split(/\s+/);
	if (fields.length !== 4 && fields.length !== 6) {
		return {
			valid: false,
			error: `Invalid FEN: expected 4 or 6 fields, got ${fields.length}`,
		};
	}

	const piecePlacementResult = validatePiecePlacement(fields[0]);
	if (!piecePlacementResult.valid) {
		return piecePlacementResult;
	}

	const activeColorResult = validateActiveColor(fields[1]);
	if (!activeColorResult.valid) {
		return activeColorResult;
	}

	const castlingRightsResult = validateCastlingRights(fields[2]);
	if (!castlingRightsResult.valid) {
		return castlingRightsResult;
	}

	const enPassantResult = validateEnPassantTarget(fields[3]);
	if (!enPassantResult.valid) {
		return enPassantResult;
	}

	if (fields.length === 6) {
		const halfMoveResult = validateDecimalCounter(
			fields[4],
			'half-move clock',
			0,
			MAX_HALF_MOVE_CLOCK,
		);
		if (!halfMoveResult.valid) {
			return halfMoveResult;
		}

		const fullMoveResult = validateDecimalCounter(
			fields[5],
			'full-move number',
			1,
			MAX_FULL_MOVE_NUMBER,
		);
		if (!fullMoveResult.valid) {
			return fullMoveResult;
		}
	}

	return { valid: true };
}

function validateDecimalCounter(
	value: string,
	label: string,
	minimum: number,
	maximum: number,
): ValidationResult {
	if (!/^\d+$/.test(value)) {
		return { valid: false, error: `Invalid ${label} '${value}': expected a decimal integer` };
	}

	const parsed = Number(value);
	if (parsed < minimum || parsed > maximum) {
		return {
			valid: false,
			error: `Invalid ${label} '${value}': expected ${minimum}-${maximum}`,
		};
	}

	return { valid: true };
}

/**
 * Validates a PositionState object for syntax correctness.
 */
export function validatePositionState(state: PositionState): ValidationResult {
	const piecePlacementResult = validatePiecePlacement(state.piecePlacement);
	if (!piecePlacementResult.valid) {
		return piecePlacementResult;
	}

	const activeColorResult = validateActiveColor(state.activeColor);
	if (!activeColorResult.valid) {
		return activeColorResult;
	}

	const castlingRightsResult = validateCastlingRights(state.castlingRights);
	if (!castlingRightsResult.valid) {
		return castlingRightsResult;
	}

	const enPassantResult = validateEnPassantTarget(state.enPassant);
	if (!enPassantResult.valid) {
		return enPassantResult;
	}

	return { valid: true };
}

/**
 * Validates the piece placement field of a FEN string.
 */
export function validatePiecePlacement(piecePlacement: string): ValidationResult {
	if (!piecePlacement) {
		return { valid: false, error: 'Piece placement cannot be empty' };
	}

	const ranks = piecePlacement.split('/');
	if (ranks.length !== 8) {
		return {
			valid: false,
			error: `Invalid piece placement: expected 8 ranks, got ${ranks.length}`,
		};
	}

	for (let i = 0; i < 8; i++) {
		const rankStr = ranks[i];
		const rankNumber = 8 - i;
		let squareCount = 0;

		for (let j = 0; j < rankStr.length; j++) {
			const char = rankStr[j];

			if (char >= '1' && char <= '8') {
				squareCount += Number(char);
			} else if (VALID_PIECE_SYMBOLS.has(char)) {
				squareCount += 1;
			} else {
				return {
					valid: false,
					error: `Invalid piece placement: unsupported symbol '${char}' in rank ${rankNumber}`,
				};
			}
		}

		if (squareCount !== 8) {
			return {
				valid: false,
				error: `Invalid piece placement: rank ${rankNumber} width is ${squareCount}, expected 8`,
			};
		}
	}

	return { valid: true };
}

/**
 * Validates active color.
 */
export function validateActiveColor(activeColor: string): ValidationResult {
	if (activeColor !== 'w' && activeColor !== 'b') {
		return {
			valid: false,
			error: `Invalid active color '${activeColor}': expected 'w' or 'b'`,
		};
	}
	return { valid: true };
}

/**
 * Validates castling rights string.
 */
export function validateCastlingRights(castlingRights: string): ValidationResult {
	if (castlingRights === '-') {
		return { valid: true };
	}

	if (!castlingRights || castlingRights.length > 4) {
		return {
			valid: false,
			error: `Invalid castling rights '${castlingRights}'`,
		};
	}

	const seen = new Set<string>();
	for (let i = 0; i < castlingRights.length; i++) {
		const char = castlingRights[i];
		if (!CANONICAL_CASTLING_SYMBOLS.includes(char as (typeof CANONICAL_CASTLING_SYMBOLS)[number])) {
			return {
				valid: false,
				error: `Invalid castling symbol '${char}' in '${castlingRights}'`,
			};
		}
		if (seen.has(char)) {
			return {
				valid: false,
				error: `Duplicate castling symbol '${char}' in '${castlingRights}'`,
			};
		}
		seen.add(char);
	}

	return { valid: true };
}

/**
 * Validates one or more concatenated Dice Chess en-passant target squares.
 */
export function validateEnPassantTarget(enPassant: string): ValidationResult {
	if (enPassant === '-') {
		return { valid: true };
	}

	if (!enPassant || enPassant.length % 2 !== 0) {
		return {
			valid: false,
			error: `Invalid en-passant field '${enPassant}': expected complete square pairs`,
		};
	}

	const seen = new Set<string>();
	for (let index = 0; index < enPassant.length; index += 2) {
		const square = enPassant.slice(index, index + 2);
		if (!/^[a-h][1-8]$/.test(square)) {
			return {
				valid: false,
				error: `Invalid en-passant square '${square}' in '${enPassant}'`,
			};
		}
		if (seen.has(square)) {
			return {
				valid: false,
				error: `Duplicate en-passant square '${square}' in '${enPassant}'`,
			};
		}
		seen.add(square);
	}

	return { valid: true };
}

/**
 * Canonicalizes castling rights string to canonical order (K, Q, k, q) or '-'.
 */
export function canonicalizeCastlingRights(castlingRights: string): string {
	const validation = validateCastlingRights(castlingRights);
	if (!validation.valid) {
		throw new Error(validation.error);
	}

	if (castlingRights === '-') {
		return '-';
	}

	let result = '';
	for (const sym of CANONICAL_CASTLING_SYMBOLS) {
		if (castlingRights.includes(sym)) {
			result += sym;
		}
	}

	return result;
}

/**
 * Canonicalizes en-passant targets to the evaluator engine serialization
 * order: ascending square index (rank first, then file).
 */
export function canonicalizeEnPassantTarget(enPassant: string): EnPassantTarget {
	const validation = validateEnPassantTarget(enPassant);
	if (!validation.valid) {
		throw new Error(validation.error);
	}

	if (enPassant === '-') {
		return '-';
	}

	const squares: string[] = [];
	for (let index = 0; index < enPassant.length; index += 2) {
		squares.push(enPassant.slice(index, index + 2));
	}

	squares.sort((left, right) => squareIndex(left) - squareIndex(right));
	return squares.join('') as EnPassantTarget;
}

function squareIndex(square: string): number {
	const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
	const rank = Number(square[1]) - 1;
	return rank * 8 + file;
}

/**
 * Converts a FEN piece placement string to an 8x8 Board matrix.
 */
export function piecePlacementToBoard(piecePlacement: string): Board {
	const validation = validatePiecePlacement(piecePlacement);
	if (!validation.valid) {
		throw new Error(validation.error);
	}

	const ranks = piecePlacement.split('/');
	const board: Board = [];

	for (let i = 0; i < 8; i++) {
		const rankStr = ranks[i];
		const row: (PieceSymbol | null)[] = [];

		for (let j = 0; j < rankStr.length; j++) {
			const char = rankStr[j];
			if (char >= '1' && char <= '8') {
				const emptySquares = Number(char);
				for (let k = 0; k < emptySquares; k++) {
					row.push(null);
				}
			} else {
				row.push(char as PieceSymbol);
			}
		}

		board.push(row);
	}

	return board;
}

/**
 * Converts an 8x8 Board matrix to a canonical FEN piece placement string.
 */
export function boardToPiecePlacement(board: Board): string {
	if (!Array.isArray(board) || board.length !== 8) {
		throw new Error('Invalid board: expected 8 rows');
	}

	const rankStrings: string[] = [];

	for (let i = 0; i < 8; i++) {
		const row = board[i];
		if (!Array.isArray(row) || row.length !== 8) {
			throw new Error(`Invalid board row ${i}: expected 8 columns`);
		}

		let rankStr = '';
		let emptyCount = 0;

		for (let j = 0; j < 8; j++) {
			const cell = row[j];
			if (cell === null) {
				emptyCount++;
			} else {
				if (!VALID_PIECE_SYMBOLS.has(cell)) {
					throw new Error(`Invalid piece symbol '${cell}' at row ${i}, col ${j}`);
				}
				if (emptyCount > 0) {
					rankStr += emptyCount.toString();
					emptyCount = 0;
				}
				rankStr += cell;
			}
		}

		if (emptyCount > 0) {
			rankStr += emptyCount.toString();
		}

		rankStrings.push(rankStr);
	}

	return rankStrings.join('/');
}

/**
 * Canonicalizes a piece placement string (merging adjacent empty square counts).
 */
export function canonicalizePiecePlacement(piecePlacement: string): string {
	const board = piecePlacementToBoard(piecePlacement);
	return boardToPiecePlacement(board);
}

/**
 * Parses a 4- or 6-field FEN string into a PositionState object.
 * Canonicalizes piece placement, castling rights, and en-passant targets.
 * Validates and then ignores move counters in 6-field FEN.
 */
export function parseFen(fen: string): PositionState {
	const validation = validateFen(fen);
	if (!validation.valid) {
		throw new Error(validation.error);
	}

	const fields = fen.trim().split(/\s+/);
	const piecePlacement = canonicalizePiecePlacement(fields[0]);
	const activeColor = fields[1] as ActiveColor;
	const castlingRights = canonicalizeCastlingRights(fields[2]);
	const enPassant = canonicalizeEnPassantTarget(fields[3]);

	return {
		piecePlacement,
		activeColor,
		castlingRights,
		enPassant,
	};
}

/**
 * Serializes a PositionState object into a canonical four-field FEN string.
 */
export function serializeFen(state: PositionState): string {
	const validation = validatePositionState(state);
	if (!validation.valid) {
		throw new Error(validation.error);
	}

	const piecePlacement = canonicalizePiecePlacement(state.piecePlacement);
	const castlingRights = canonicalizeCastlingRights(state.castlingRights);
	const enPassant = canonicalizeEnPassantTarget(state.enPassant);

	return `${piecePlacement} ${state.activeColor} ${castlingRights} ${enPassant}`;
}

/**
 * Normalizes a 4-field or 6-field FEN string into a deterministic 4-field FEN string.
 */
export function canonicalizeFen(fen: string): string {
	return serializeFen(parseFen(fen));
}
