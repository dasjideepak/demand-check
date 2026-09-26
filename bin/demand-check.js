#!/usr/bin/env node
import { run } from '../src/cli.js';

const code = await run(process.argv.slice(2));
process.exitCode = code;
// Exit only once stdout has drained, so piped output is never cut off on macOS.
process.stdout.write('', () => process.exit(code));
