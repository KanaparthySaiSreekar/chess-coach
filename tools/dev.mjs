// `npm run dev`: the server (port 5174) and the page with hot reload (port 5173), together.
// Open http://127.0.0.1:5173. Ctrl+C stops both.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const procs = [];

/** Is the port free on the address both servers listen on? */
const free = (port) =>
  new Promise((resolve) => {
    const probe = createServer()
      .once('error', () => resolve(false))
      .once('listening', () => probe.close(() => resolve(true)))
      .listen(port, '127.0.0.1');
  });

// a copy already running (another terminal, or one started in the background) holds the ports:
// say so in words rather than letting Vite fail with a stack trace
const busy = [];
for (const port of [5173, 5174]) if (!(await free(port))) busy.push(port);
if (busy.length) {
  console.log(`Chess Coach: port ${busy.join(' and ')} ${busy.length > 1 ? 'are' : 'is'} already in use, so another copy is probably running.`);
  console.log('Open http://127.0.0.1:5173 to use it, or stop it first (Ctrl+C in its terminal; or close the node.exe that holds the port).');
  process.exit(1);
}

function run(name, command, args, cwd = root) {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true });
  const tag = `[${name}] `;
  const pipe = (stream) =>
    stream.on('data', (d) => {
      for (const line of d.toString().split(/\r?\n/)) if (line.trim()) console.log(tag + line);
    });
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code) => {
    console.log(`${tag}stopped (${code ?? 'killed'})`);
    stopAll();
  });
  procs.push(child);
}

let stopping = false;
function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const p of procs) {
    try {
      p.kill();
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

run('server', process.execPath, ['packages/server/src/index.ts']);
run('page', process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')], path.join(root, 'packages', 'web'));
console.log('Chess Coach: open http://127.0.0.1:5173  (Ctrl+C to stop)');
