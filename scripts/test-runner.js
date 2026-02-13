#!/usr/bin/env node

/**
 * Test runner script that mimics CI behavior locally
 * Useful for debugging test failures before pushing
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const logFile = 'test-output.log';
const logStream = fs.createWriteStream(logFile);

console.log('Running tests...');
console.log(`Output will be saved to ${logFile}`);
console.log('---');

const npmTest = spawn('npm', ['test'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: true
});

// Pipe output to both console and file
npmTest.stdout.on('data', (data) => {
  process.stdout.write(data);
  logStream.write(data);
});

npmTest.stderr.on('data', (data) => {
  process.stderr.write(data);
  logStream.write(data);
});

npmTest.on('close', (code) => {
  logStream.end();
  console.log('---');

  if (code !== 0) {
    console.error(`Tests failed with exit code ${code}`);
    console.log('\nLast 50 lines of output:');
    console.log('='.repeat(60));

    // Read and display last 50 lines
    const output = fs.readFileSync(logFile, 'utf-8');
    const lines = output.trim().split('\n');
    const last50 = lines.slice(-50).join('\n');
    console.log(last50);

    process.exit(code);
  } else {
    console.log('All tests passed!');
    // Clean up log file on success
    fs.unlinkSync(logFile);
  }
});