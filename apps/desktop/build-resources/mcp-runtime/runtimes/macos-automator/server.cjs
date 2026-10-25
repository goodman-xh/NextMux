#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, [path.join(__dirname, 'package', "dist/server.js"), ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
child.once('exit', (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exitCode = code ?? 1; });
child.once('error', error => { process.stderr.write(error.message + '\n'); process.exitCode = 78; });
