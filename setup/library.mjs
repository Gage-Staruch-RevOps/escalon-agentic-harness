#!/usr/bin/env node
// Downloads (or refreshes) the public skill library from the GitHub repos in harness/sources.json,
// runs the license gate and security scan, and rebuilds the index. About 700 MB the first time.
import { install } from './lib.mjs';
install({ library: true });
