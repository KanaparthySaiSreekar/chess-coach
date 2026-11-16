import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// the two typefaces are served from this computer (no font service is called): Inter for the
// interface, Newsreader for the coach's words
import '@fontsource-variable/inter/index.css';
import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/newsreader/opsz-italic.css';
import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.brown.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';
import './pieces/pieces.css';
import './styles.css';
import { App } from './App.tsx';
import { connect } from './store.ts';

connect();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
