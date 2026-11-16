"""Maia-3 sidecar for Chess Coach (ARCHITECTURE §11, feature H7).

Loads one Maia-3 model and then answers JSON lines on stdin, one per line:

    {"id": 7, "fen": "<start position, optional>", "moves": ["e2e4", "e7e5"],
     "self_elo": 600, "oppo_elo": 600}

with the probability that a human of that rating plays each legal move:

    {"id": 7, "moves": [{"uci": "g1f3", "p": 0.41}, ...]}

The server samples the move from these and checks it against the rules itself, so this
process never decides what is played. Started by the server with the virtual environment's
Python by absolute path:

    python maia_sidecar.py --model maia3-5m --checkpoint-path C:\\Tools\\Maia3\\models\\maia3-5m.pt --device cpu

with HF_HUB_OFFLINE=1, so starting a bot never touches the network (decision D30).
"""

import json
import sys
from collections import deque

import chess
import torch
from torch.amp import autocast

from maia3.dataset import get_historical_tokens, get_legal_moves_mask, tokenize_board
from maia3.uci import load_model, parse_args
from maia3.utils import get_all_possible_moves, mirror_move


def out(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def main():
    cfg = parse_args(sys.argv[1:])
    # a few threads are plenty for a model this small, and leave the cores to Stockfish
    torch.set_num_threads(2)
    model = load_model(cfg)
    all_moves = get_all_possible_moves()
    move_index = {m: i for i, m in enumerate(all_moves)}
    index_move = {i: m for m, i in move_index.items()}
    use_amp = bool(cfg.use_amp) and str(cfg.device).startswith("cuda")

    @torch.no_grad()
    def probabilities(req):
        board = chess.Board(req["fen"]) if req.get("fen") else chess.Board()
        # the model sees up to cfg.history positions: the real ones, oldest padded when the game is young
        history = deque(maxlen=cfg.history)
        history.append(tokenize_board(board))
        for uci in req.get("moves", []):
            move = chess.Move.from_uci(uci)
            if move not in board.legal_moves:
                raise ValueError(f"illegal move in the game so far: {uci}")
            board.push(move)
            history.append(tokenize_board(board))
        if board.is_game_over():
            return []
        legal = get_legal_moves_mask(board, move_index)
        if not bool(legal.any()):
            return []
        tokens = get_historical_tokens(history, cfg, base=0.0, inc=0.0, clk_left_before=0.0, clk_ponder=0.0)
        tokens = tokens.unsqueeze(0).to(cfg.device)
        self_elos = torch.tensor([int(req["self_elo"])], dtype=torch.long, device=cfg.device)
        oppo_elos = torch.tensor([int(req["oppo_elo"])], dtype=torch.long, device=cfg.device)
        with autocast("cuda", enabled=use_amp):
            logits_move, _value, _ = model(tokens, self_elos, oppo_elos)
        logits = logits_move[0].float().masked_fill(~legal.to(cfg.device), float("-inf"))
        probs = torch.softmax(logits, dim=-1).cpu()
        moves = []
        for idx in torch.nonzero(legal).flatten().tolist():
            uci = index_move[idx]
            # the model always looks from the side to move: Black's moves come back mirrored
            if board.turn == chess.BLACK:
                uci = mirror_move(uci)
            moves.append({"uci": uci, "p": float(probs[idx])})
        moves.sort(key=lambda m: m["p"], reverse=True)
        return moves

    out({"ready": True, "model": cfg.model, "device": str(cfg.device)})
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            if req.get("quit"):
                return
            out({"id": rid, "moves": probabilities(req)})
        except Exception as exc:  # one bad request must not end the process
            out({"id": rid, "error": f"{type(exc).__name__}: {exc}"})


if __name__ == "__main__":
    main()
