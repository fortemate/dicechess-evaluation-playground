export type ActiveColor = 'w' | 'b';

export type PieceSymbol = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K' | 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export type FileSymbol = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h';
export type RankSymbol = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';
export type Square = `${FileSymbol}${RankSymbol}`;

export type EnPassantTarget = Square | '-';

export interface PositionState {
	piecePlacement: string;
	activeColor: ActiveColor;
	castlingRights: string;
	enPassant: EnPassantTarget;
}

export type Board = (PieceSymbol | null)[][];

export const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
export const EMPTY_BOARD_FEN = '8/8/8/8/8/8/8/8 w - -';

export const VALID_PIECE_SYMBOLS: ReadonlySet<string> = new Set([
	'P',
	'N',
	'B',
	'R',
	'Q',
	'K',
	'p',
	'n',
	'b',
	'r',
	'q',
	'k',
]);

export const CANONICAL_CASTLING_SYMBOLS = ['K', 'Q', 'k', 'q'] as const;
export type CastlingSymbol = (typeof CANONICAL_CASTLING_SYMBOLS)[number];
