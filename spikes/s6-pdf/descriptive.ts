// English descriptive notation ("Kt-KB3", "BxP ch", "Castles") resolved against a position.
//
// Old public-domain books print moves this way. The transcriber copies the printed text and
// this code works out which legal move it is, so the model never converts notation or judges a
// move (decision D33). A printed move is accepted only when exactly one legal move fits it.

import { legalMoves, type Chess, type MoveInfo, type Role } from '@chess-coach/core';

/** File names from the mover's side. A bare B, Kt or R can be either wing. */
const FILES: Record<string, string> = { QR: 'a', QKt: 'b', QN: 'b', QB: 'c', Q: 'd', K: 'e', KB: 'f', KKt: 'g', KN: 'g', KR: 'h', R: 'ah', Kt: 'bg', N: 'bg', B: 'cf' };
const PIECES: Record<string, Role> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', Kt: 'knight', N: 'knight', P: 'pawn' };

export type Mark = 'check' | 'mate' | null;

type PieceSpec = { role: Role; wing?: 'K' | 'Q'; files?: string; at?: { files: string; rank: number } };
type SquareSpec = { files: string; rank: number };

export type Parsed =
  | { kind: 'castle'; side: 'kingside' | 'queenside' | null; mark: Mark }
  | { kind: 'move'; piece: PieceSpec; to: SquareSpec; promotion?: Role; mark: Mark }
  | { kind: 'capture'; piece: PieceSpec; target: PieceSpec; enPassant: boolean; promotion?: Role; mark: Mark };

function squareSpec(text: string): SquareSpec | null {
  const m = text.match(/^(QR|QKt|QN|QB|KB|KKt|KN|KR|Q|K|R|Kt|N|B)([1-8])$/);
  return m ? { files: FILES[m[1]!]!, rank: Number(m[2]) } : null;
}

/** "Kt", "KR", "QBP", "R(R1)", "KtP" … */
function pieceSpec(text: string): PieceSpec | null {
  let body = text;
  let at: SquareSpec | undefined;
  const hint = body.match(/^(.*)\((.+)\)$/);
  if (hint) {
    body = hint[1]!;
    const sq = squareSpec(hint[2]!);
    if (!sq) return null;
    at = sq;
  }
  if (body === 'P') return { role: 'pawn', at };
  // a pawn named by its file: KP, QBP, KtP, RP …
  const pawn = body.match(/^(QR|QKt|QN|QB|KB|KKt|KN|KR|Q|K|R|Kt|N|B)P$/);
  if (pawn) return { role: 'pawn', files: FILES[pawn[1]!]!, at };
  if (PIECES[body]) return { role: PIECES[body]!, at };
  // a piece named by its wing: KR, QKt, KB …
  const winged = body.match(/^(K|Q)(R|Kt|N|B)$/);
  if (winged) return { role: PIECES[winged[2]!]!, wing: winged[1] as 'K' | 'Q', at };
  return null;
}

const PROMO: Record<string, Role> = { Q: 'queen', R: 'rook', B: 'bishop', Kt: 'knight', N: 'knight' };

/** Read one printed move (without its number). Null when it is not a move this notation can write. */
export function parseDescriptive(raw: string): Parsed | null {
  let text = raw.trim().replace(/[–—]/g, '-').replace(/×/g, 'x');
  let mark: Mark = null;
  if (/\bmates?\b\.?/i.test(text)) mark = 'mate';
  else if (/\b(dis\.?\s*|dbl\.?\s*|double\s*)?ch(eck)?\b\.?/i.test(text) || text.endsWith('+')) mark = 'check';
  const enPassant = /e\.?\s?p\.?/i.test(text);
  text = text
    .replace(/\bmates?\b\.?/gi, '')
    .replace(/\b(dis\.?\s*|dbl\.?\s*|double\s*)?ch(eck)?\b\.?/gi, '')
    .replace(/e\.?\s?p\.?/gi, '')
    .replace(/[!?+#]+/g, '')
    .replace(/\s+/g, '')
    .replace(/[.,;:]+$/g, '');
  if (/^(castles|o-o|0-0)/i.test(text)) {
    const queenside = /^(o-o-o|0-0-0)/i.test(text) || /castles\(?q/i.test(text);
    const kingside = /^(o-o|0-0)$/i.test(text) || /castles\(?k/i.test(text);
    return { kind: 'castle', side: queenside ? 'queenside' : kingside ? 'kingside' : null, mark };
  }
  // a promotion: P-K8(Q), P-K8=Q
  let promotion: Role | undefined;
  const promo = text.match(/^(.*[1-8])(?:=|\()(Q|R|B|Kt|N)\)?$/);
  if (promo) {
    text = promo[1]!;
    promotion = PROMO[promo[2]!];
  }
  const cut = text.search(/[-x]/);
  if (cut <= 0) return null;
  const piece = pieceSpec(text.slice(0, cut));
  if (!piece) return null;
  const rest = text.slice(cut + 1);
  if (text[cut] === '-') {
    const to = squareSpec(rest);
    return to ? { kind: 'move', piece, to, promotion, mark } : null;
  }
  const target = pieceSpec(rest);
  return target && target.role !== 'king' ? { kind: 'capture', piece, target, enPassant, promotion, mark } : null;
}

const fileOf = (sq: string) => sq[0]!;
const rankOf = (sq: string) => Number(sq[1]);
/** A rank as the book counts it: from the mover's own side. */
const rankFor = (rank: number, white: boolean) => (white ? rank : 9 - rank);
const onSquare = (sq: string, spec: SquareSpec, white: boolean) => spec.files.includes(fileOf(sq)) && rankOf(sq) === rankFor(spec.rank, white);

export type Resolved =
  | { ok: true; info: MoveInfo; via: 'text' | 'mark' | 'wing'; parsed: Parsed }
  | { ok: false; reason: 'unreadable' | 'illegal' | 'ambiguous'; candidates: string[] };

/** Which legal move is this printed move? Exactly one must fit. */
export function resolveDescriptive(pos: Chess, raw: string): Resolved {
  const parsed = parseDescriptive(raw);
  if (!parsed) return { ok: false, reason: 'unreadable', candidates: [] };
  const white = pos.turn === 'white';
  let fits = legalMoves(pos).filter((m) => {
    if (parsed.kind === 'castle') return Boolean(m.castle) && (!parsed.side || m.castle === parsed.side);
    if (m.castle) return false;
    if (m.role !== parsed.piece.role) return false;
    if (parsed.piece.files && !parsed.piece.files.includes(fileOf(m.from))) return false;
    if (parsed.piece.at && !onSquare(m.from, parsed.piece.at, white)) return false;
    // a promotion not named in the text is a queen
    if (m.promotion && m.promotion !== (parsed.promotion ?? 'queen')) return false;
    if (!m.promotion && parsed.promotion) return false;
    if (parsed.kind === 'move') return !m.captured && onSquare(m.to, parsed.to, white);
    if (m.captured !== parsed.target.role) return false;
    if (parsed.enPassant && !m.enPassant) return false;
    if (parsed.target.files && !parsed.target.files.includes(fileOf(m.to))) return false;
    if (parsed.target.at && !onSquare(m.to, parsed.target.at, white)) return false;
    return true;
  });
  let via: 'text' | 'mark' | 'wing' = 'text';
  if (fits.length > 1 && parsed.mark) {
    // "ch" and "mate" are printed information too: they may settle which move is meant
    const marked = fits.filter((m) => (parsed.mark === 'mate' ? m.mate : m.check));
    if (marked.length >= 1 && marked.length < fits.length) {
      fits = marked;
      via = 'mark';
    }
  }
  if (fits.length > 1 && parsed.kind !== 'castle') {
    // "KR" / "QKt": the piece standing on that wing, or, for the target, the one on that wing
    const wingOf = (sq: string) => ('efgh'.includes(fileOf(sq)) ? 'K' : 'Q');
    let narrowed = fits;
    if (parsed.piece.wing) narrowed = narrowed.filter((m) => wingOf(m.from) === parsed.piece.wing);
    if (parsed.kind === 'capture' && parsed.target.wing) narrowed = narrowed.filter((m) => wingOf(m.to) === parsed.target.wing);
    if (narrowed.length >= 1 && narrowed.length < fits.length) {
      fits = narrowed;
      via = 'wing';
    }
  }
  if (!fits.length) return { ok: false, reason: 'illegal', candidates: [] };
  if (fits.length > 1) return { ok: false, reason: 'ambiguous', candidates: fits.map((m) => m.san) };
  return { ok: true, info: fits[0]!, via, parsed };
}
