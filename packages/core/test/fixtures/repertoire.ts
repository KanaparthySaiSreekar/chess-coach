// A White repertoire for the gate tests (PLAN WP 8.3): six lines, three of them bad on purpose.
//   1.e4 Nc6 2.Ke3            an illegal move (V1)
//   1.e4 a6 2.Bxa6 bxa6 3.d4  an unsound move: a bishop for a pawn (V2)
//   1.e4 d6 2.Nf3 e5 3.Bc4    a transposition conflict: the same position as 1.e4 e5 2.Nf3 d6, where the repertoire plays 3.d4 (V5)
export const TEST_REPERTOIRE = `[Event "Test: White"]
[ChapterName "White"]
[Orientation "white"]

1. e4 e5 { The classical reply. } (1... c5 2. Nf3 d6 3. d4) (1... Nc6 2. Ke3) (1... a6 2. Bxa6 bxa6 3. d4) (1... d6 2. Nf3 e5 3. Bc4) 2. Nf3 Nc6 (2... d6 3. d4) 3. Bb5 a6 4. Ba4 *`;
