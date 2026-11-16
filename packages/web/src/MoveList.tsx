// The move list: the main line with variations inline, Lichess style. Click a move to go there.
// Moves are written with piece pictures (a setting), and a move the engine has labelled as
// notable (brilliant, great, inaccuracy, mistake, miss, blunder) carries its badge.

import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { LABEL_NAME, type Color, type MoveLabel, type MoveTree, type NodeId } from '@chess-coach/core';
import { Badge, LABEL_LOOK } from './labels.tsx';
import { San } from './San.tsx';

const NOTABLE: ReadonlySet<MoveLabel> = new Set(['brilliant', 'great', 'inaccuracy', 'mistake', 'miss', 'blunder']);

function moveNumber(tree: MoveTree, id: NodeId, force: boolean): string {
  const node = tree.nodes[id]!;
  const parent = tree.nodes[node.parent!]!;
  const parts = parent.fen.split(' ');
  const whiteMoved = parts[1] === 'w';
  const n = parts[5] ?? '1';
  if (whiteMoved) return `${n}.`;
  return force ? `${n}…` : '';
}

export type MoveListProps = {
  tree: MoveTree;
  focus: NodeId;
  figurine: boolean;
  /** show the engine's labels on the moves */
  labels: boolean;
  onGoto: (id: NodeId) => void;
  /** "Make main line" and "Delete from here": left out for a game against a bot */
  onPromote?: (id: NodeId) => void;
  onDelete?: (id: NodeId) => void;
  empty?: string;
};

export function MoveList({ tree, focus, figurine, labels, onGoto, onPromote, onDelete, empty }: MoveListProps) {
  const current = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    current.current?.scrollIntoView({ block: 'nearest' });
  }, [focus]);

  const move = (id: NodeId, forceNumber: boolean): ReactNode => {
    const node = tree.nodes[id]!;
    const parent = tree.nodes[node.parent!]!;
    const by: Color = parent.fen.split(' ')[1] === 'b' ? 'black' : 'white';
    const num = moveNumber(tree, id, forceNumber);
    const label = labels ? node.judged?.label : undefined;
    const notable = label && NOTABLE.has(label) ? label : undefined;
    return (
      <Fragment key={id}>
        {num && <span className="ply-num">{num}</span>}
        <button
          ref={id === focus ? current : undefined}
          className={`san${id === focus ? ' current' : ''}`}
          style={notable && id !== focus ? { color: LABEL_LOOK[notable].color } : undefined}
          title={label ? LABEL_NAME[label] : undefined}
          onClick={() => onGoto(id)}
        >
          <San san={node.san!} by={by} figurine={figurine} />
          {notable && <Badge label={notable} small />}
        </button>
      </Fragment>
    );
  };

  // the line that starts with `first`, with every side line it meets in brackets
  const line = (first: NodeId, depth: number): ReactNode[] => {
    const out: ReactNode[] = [];
    let id: NodeId | undefined = first;
    let forceNumber = true;
    while (id) {
      const node: MoveTree['nodes'][string] = tree.nodes[id]!;
      const parent: MoveTree['nodes'][string] = tree.nodes[node.parent!]!;
      out.push(move(id, forceNumber));
      forceNumber = false;
      const siblings = parent.children[0] === id ? parent.children.slice(1) : [];
      for (const alt of siblings) {
        out.push(
          <span key={`v${alt}`} className={`variation depth-${Math.min(depth, 3)}`}>
            ({line(alt, depth + 1)})
          </span>,
        );
        forceNumber = true;
      }
      id = node.children[0];
    }
    return out;
  };

  const root = tree.nodes[tree.root]!;
  const first = root.children[0];
  const focusNode = tree.nodes[focus]!;
  const parentOfFocus = focusNode.parent ? tree.nodes[focusNode.parent]! : null;
  const isSideLine = !!parentOfFocus && parentOfFocus.children[0] !== focus;

  return (
    <div className="moves">
      <div className="moves-scroll">
        {first ? (
          <>
            {line(first, 0)}
            {root.children.slice(1).map((alt) => (
              <span key={`v${alt}`} className="variation depth-0">
                ({line(alt, 1)})
              </span>
            ))}
          </>
        ) : (
          <p className="muted empty">{empty ?? 'No moves yet. Move a piece on the board, or load a game.'}</p>
        )}
      </div>
      {focus !== tree.root && (onPromote || onDelete) && (
        <div className="moves-actions">
          {isSideLine && onPromote && (
            <button className="link" onClick={() => onPromote(focus)} title="Make this side line the main line">
              Make main line
            </button>
          )}
          {onDelete && (
            <button className="link danger" onClick={() => onDelete(focus)} title="Delete this move and everything after it">
              Delete from here
            </button>
          )}
        </div>
      )}
    </div>
  );
}
