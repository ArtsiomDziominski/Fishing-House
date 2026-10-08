// Хуки Claude Code для этого репозитория (подключены в .claude/settings.json). Правила из CLAUDE.md, которые может
// проверить машина, проверяются здесь, а не держатся на внимательности:
//
//   guard — перед правкой файла: то, что генерирует сборка карты, руками не правим;
//   note  — после правки: запоминаем, какие пакеты тронуты в этой сессии;
//   world — после `npm run build:world`: возвращаем правленый bucket.png из коммита;
//   check — перед концом хода: тесты и типы тронутых пакетов. Упали — ход продолжается, пока не починено.
//
// Событие приходит JSON-ом в stdin. Проверить руками:
//   echo '{"tool_input":{"file_path":"shared/src/world-data.ts"}}' | node .claude/hooks/rules.mjs guard

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BUCKET = 'app/public/assets/bucket.png';
// Что пишет tools/build-world.mjs (и tools/build-dig.mjs). Картинки руками и так не поправить, но world-data.ts — обычный текст.
const GENERATED = [/^shared\/src\/(world|dig)-data\.ts$/, /^app\/public\/assets\/.*\.png$/, /^art\/house\//];
const PACKAGES = ['shared', 'game-server', 'app'];
const CODE = /\.(ts|vue|mjs|js|json)$/;

let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { /* запустили руками без события */ }

const rel = file => path.relative(ROOT, path.resolve(ROOT, file)).replaceAll('\\', '/');
const say = out => process.stdout.write(JSON.stringify(out));
const run = cmd => spawnSync(cmd, { cwd: ROOT, shell: true, encoding: 'utf8' });

// Что тронуто в сессии — в файле вне репозитория: edited — когда правили в последний раз, blocked — когда check
// в последний раз не дал закончить ход.
const stateFile = path.join(os.tmpdir(), 'fishing-house-claude', `${String(input.session_id || 'manual').replace(/[^\w-]/g, '')}.json`);
const load = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return { touched: [], edited: 0, blocked: 0 }; } };
const save = state => { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(state)); };
function touch(...packages) {
  const state = load();
  save({ ...state, touched: [...new Set([...state.touched, ...packages])], edited: Date.now() });
}

const actions = {
  guard() {
    const file = rel(input.tool_input?.file_path || '');
    if (!GENERATED.some(re => re.test(file))) return;
    say({ hookSpecificOutput: {
      hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: `${file} генерирует tools/build-world.mjs — руками не править. Менять разметку в tools/world-shapes.mjs (или саму сборку) и пересобирать: npm run build:world.`,
    } });
  },

  note() {
    const file = rel(input.tool_input?.file_path || '');
    const pkg = PACKAGES.find(p => file.startsWith(p + '/'));
    if (pkg && CODE.test(file)) touch(pkg);
  },

  world() {
    if (!/build:world|build-world\.mjs/.test(input.tool_input?.command || '')) return;
    touch('shared', 'app');             // сборка переписала world-data.ts и картинки
    if (!run(`git status --porcelain -- ${BUCKET}`).stdout.trim()) return;
    const back = run(`git checkout -- ${BUCKET}`);
    say({ hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: back.status === 0
        ? `Хук вернул ${BUCKET} из коммита: сборка затирает правленую версию.`
        : `Сборка изменила ${BUCKET}, а вернуть его из коммита не вышло: ${back.stderr.trim()}`,
    } });
  },

  check() {
    const state = load();
    if (!state.touched.length) return;
    // От общего кода зависят все: тронут он — проверяем всё.
    const packages = state.touched.includes('shared') ? PACKAGES : state.touched;
    const cmds = [...(packages.includes('shared') ? ['npm test'] : []), ...packages.map(p => `npm run typecheck -w ${p}`)];
    const failed = [];
    for (const cmd of cmds) {
      const r = run(cmd);
      if (r.status !== 0) failed.push(`$ ${cmd}\n${(r.stdout + r.stderr).trim().slice(-3000)}`);
    }
    if (!failed.length) { fs.rmSync(stateFile, { force: true }); return; }
    // Один отказ на одну порцию правок: если с прошлого отказа ничего не правили, значит, ход кончают сознательно
    // (например, чтобы спросить) — тогда только предупреждаем.
    if (state.blocked >= state.edited) {
      say({ systemMessage: `Проверки не проходят: ${failed.map(f => f.split('\n')[0].slice(2)).join(', ')}` });
      return;
    }
    save({ ...state, blocked: Date.now() });
    process.stderr.write(`Проверки после правок не прошли — почини, прежде чем заканчивать ход.\n\n${failed.join('\n\n')}\n`);
    process.exitCode = 2;
  },
};

actions[process.argv[2]]?.();
