#!/usr/bin/env node
// Turns the harness off for Claude Code: removes its hooks and its block in ~/.claude/CLAUDE.md. Keeps your data.
import { uninstall } from './lib.mjs';
uninstall();
