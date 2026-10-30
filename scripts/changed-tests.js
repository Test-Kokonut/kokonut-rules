#!/usr/bin/env node
// changed-tests.js: the tests a change calls for: those of the files it changes, and those of the code that uses
// them (the rulebook: "A pull request runs only the tests for what changed.").
// Run by .github/workflows/tests.yml on a pull request and on a push to a branch other than main:
//   node scripts/changed-tests.js [--base <branch>]      (default main; the change: git diff origin/<branch>...HEAD)
// It prints the test files to run, one per line, sorted; nothing when no test applies. For each changed file, one
// deleted too:
//   - a test file (tests/*.test.js) that is still there: itself;
//   - the test named after the file: tests/<name>.test.js, <name> the file's name without its extension, in lower
//     case, "_" read as "-" (.claude/hooks/no-main.js: tests/no-main.test.js; .claude/settings.json:
//     tests/settings.test.js); a few files are read by tests named otherwise (OTHER_READERS below: CLAUDE.md by the
//     rulebook tests);
//   - the code that uses the file: every .js file of the repo that requires it, directly or through other files (a
//     require of a relative path written out: require('./x'), require('../y.js')), brings its own test, as above, or
//     runs itself when it is a test.
// A change to how the tests run (package.json, the test workflow, this script) runs every test.
// Node only, no packages. A CI check: an internal error fails loudly.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EVERY_TEST = ['package.json', '.github/workflows/tests.yml', 'scripts/changed-tests.js'];
// Files read by tests not named after them: the file, or a folder ending in "/", and those tests.
const OTHER_READERS = {
  'CLAUDE.md': ['tests/rulebook.test.js', 'tests/rulebook-hooks.test.js'],
};
const SKIP = new Set(['.git', 'node_modules']);

const isTest = (f) => f.startsWith('tests/') && f.endsWith('.test.js');
const exists = (f) => fs.existsSync(path.join(ROOT, f));

// The files the change holds, relative to the repo's root.
function changedFiles(base) {
  const out = execFileSync('git', ['-C', ROOT, 'diff', '--name-only', '--no-renames', '-z', `origin/${base}...HEAD`], { encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

// Every .js file of the repo, relative to its root.
function jsFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const f = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...jsFiles(f));
    else if (f.endsWith('.js')) out.push(f);
  }
  return out;
}

// The files a .js file requires by a relative path written out; a path without an extension is a .js file.
function requires(file) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return [...text.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)].map((m) => {
    const target = path.relative(ROOT, path.resolve(ROOT, path.dirname(file), m[1])).split(path.sep).join('/');
    return path.extname(target) ? target : `${target}.js`;
  });
}

// The tests of a file that is not a test: the one named after it, and the other readers of it.
function testsOf(file) {
  const name = path.posix.basename(file).replace(/^\.+/, '').replace(/\.[^.]*$/, '').toLowerCase().replace(/_/g, '-');
  const others = Object.entries(OTHER_READERS).filter(([f]) => file === f || (f.endsWith('/') && file.startsWith(f)));
  return [`tests/${name}.test.js`].concat(...others.map(([, tests]) => tests)).filter(exists);
}

// The tests the changed files call for, sorted.
function testsFor(changed) {
  const files = jsFiles('');
  if (changed.some((f) => EVERY_TEST.includes(f))) return files.filter(isTest).sort();
  const users = new Map(); // a file -> the .js files that require it
  for (const f of files) for (const r of requires(f)) users.set(r, (users.get(r) || new Set()).add(f));
  const picked = new Set();
  const seen = new Set();
  const visit = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    if (isTest(f)) { if (exists(f)) picked.add(f); } else for (const t of testsOf(f)) picked.add(t);
    for (const u of users.get(f) || []) visit(u);
  };
  for (const f of changed) visit(f);
  return [...picked].sort();
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const k = argv.indexOf('--base');
  for (const t of testsFor(changedFiles((k >= 0 && argv[k + 1]) || 'main'))) console.log(t);
}

module.exports = { testsFor, testsOf, requires, changedFiles };
