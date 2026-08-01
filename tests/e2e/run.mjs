import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runChecks } from './checks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const example = path.join(root, 'example');

const DEV_PORT = 5199;
const PROD_PORT = 5198;

/** Runs a command to completion, failing the suite if it exits non-zero. */
function run(command, args, cwd) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, stdio: 'inherit', shell: false });

		child.on('exit', (code) =>
			code === 0
				? resolve()
				: reject(new Error(`${command} ${args.join(' ')} exited ${code}`))
		);
	});
}

/** Starts a server and waits until it answers, so checks never race the boot. */
async function start(command, args, cwd, port, env = {}) {
	const child = spawn(command, args, {
		cwd,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: { ...process.env, ...env },
	});

	const output = [];

	child.stdout.on('data', (chunk) => output.push(String(chunk)));
	child.stderr.on('data', (chunk) => output.push(String(chunk)));

	for (let attempt = 0; attempt < 60; attempt++) {
		try {
			await fetch(`http://localhost:${port}/`);

			return child;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}

	child.kill('SIGKILL');

	throw new Error(`Server on ${port} never came up:\n${output.join('')}`);
}

async function stop(child) {
	child.kill('SIGTERM');

	await new Promise((resolve) => {
		child.once('exit', resolve);
		setTimeout(resolve, 3000).unref();
	});
}

const failures = [];

await run('node', [path.join(root, 'node_modules/.bin/tsdown')], root);

const dev = await start(
	'node',
	[path.join(example, 'node_modules/.bin/vite'), '--port', String(DEV_PORT), '--strictPort'],
	example,
	DEV_PORT
);

try {
	failures.push(...(await runChecks(`http://localhost:${DEV_PORT}`, 'dev server')));
} finally {
	await stop(dev);
}

await run(path.join(example, 'node_modules/.bin/vite'), ['build'], example);

const prod = await start('node', ['dist/server/index.js'], example, PROD_PORT, {
	PORT: String(PROD_PORT),
});

try {
	failures.push(...(await runChecks(`http://localhost:${PROD_PORT}`, 'production server')));
} finally {
	await stop(prod);
}

if (failures.length > 0) {
	console.error(`\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
	process.exit(1);
}

console.log('\nAll end-to-end checks passed.');
