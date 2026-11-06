import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const template = read('src/template.html');
const style = read('src/style.css');
const core = read('src/core.js');
const app = read('src/app.js');
const cubejs = read('js/vendor/cubejs.bundle.js');
const workerTail = read('src/worker-tail.js');

const workerSource = cubejs + '\n' + workerTail;
const workerLiteral = JSON.stringify(workerSource).replace(/<\/script/gi, '<\\/script');

const html = template
  .replace('/*__STYLE__*/', () => style)
  .replace('/*__WORKER_SOURCE__*/', () => 'window.SOLVER_WORKER_SOURCE = ' + workerLiteral + ';')
  .replace('/*__CORE__*/', () => core)
  .replace('/*__APP__*/', () => app);

fs.writeFileSync(path.join(root, 'index.html'), html, 'utf8');
const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log('Built index.html (' + kb + ' KB, self-contained)');
