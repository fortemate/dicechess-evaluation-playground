import type { ActiveColor, Board, EnPassantTarget, PieceSymbol, PositionState } from './model.js';
import { CANONICAL_CASTLING_SYMBOLS, VALID_PIECE_SYMBOLS } from './model.js';

export interface ValidationResult {
	valid: boolean;
	error?: string;
}

/**
 * Validates a FEN string for syntax correctness.
 * Accepts 4-field or 6-field FEN strings (move counters in 6-field FEN are ignored).
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
 * Validates en-passant target square string.
 */
export function validateEnPassantTarget(enPassant: string): ValidationResult {
	if (enPassant === '-') {
		return { valid: true };
	}

	if (!/^[a-h][1-8]$/.test(enPassant)) {
		return {
			valid: false,
			error: `Invalid en-passant square '${enPassant}'`,
		};
	}

	return { valid: true };
}

/**
 * Canonicalizes castling rights string to canonical order (K, Q, k, q) or '-'.
 */
export function canonicalizeCastlingRights(castlingRights: string): string {
	if (castlingRights === '-' || !castlingRights) {
		return '-';
	}

	let result = '';
	for (const sym of CANONICAL_CASTLING_SYMBOLS) {
		if (castlingRights.includes(sym)) {
			result += sym;
		}
	}

	return result || '-';
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
 * Canonicalizes piece placement and castling rights.
 * Ignores move counters in 6-field FEN.
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
	const enPassant = fields[3] as EnPassantTarget;

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

	return `${piecePlacement} ${state.activeColor} ${castlingRights} ${state.enPassant}`;
}

/**
 * Normalizes a 4-field or 6-field FEN string into a deterministic 4-field FEN string.
 */
export function canonicalizeFen(fen: string): string {
	return serializeFen(parseFen(fen));
}
