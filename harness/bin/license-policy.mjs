// License policy for the work harness: which skills a company may use commercially.
// A skill is blocked when its own terms forbid commercial use, when it is an Anthropic proprietary
// skill copied out of Anthropic's service (its license forbids keeping copies outside the service),
// or when no license grants any right to use it (no license means all rights reserved).
// Copyleft (GPL, AGPL, MPL, CC BY-SA) is allowed: using it internally is permitted; obligations apply
// only when the company redistributes it.
import fs from 'node:fs';
import path from 'node:path';

const NONCOMMERCIAL = /\b(non-?commercial|by-nc|cc[ -]?by[ -]?nc|polyform[- ]noncommercial|personal use only|not for commercial)\b/i;
const PROPRIETARY_TEXT = /all rights reserved/i;
const PROPRIETARY_HINT = /\b(proprietary|governed\s+by\s+your\s+agreement\s+with\s+anthropic)\b/i;
const GRANT = /\b(mit|apache|bsd|isc|mpl|mozilla public license|general public license|gpl|lgpl|agpl|cc0|cc[ -]?by|creative commons attribution|unlicense|public domain|zlib|0bsd|permission is hereby granted|biopython license|developer terms)\b/i;

function frontmatterLicense(skillMd) {
  const m = /^---\n([\s\S]*?)\n---/.exec(skillMd);
  if (!m) return '';
  const l = /^license:\s*(.+)$/im.exec(m[1]);
  return l ? l[1].trim() : '';
}

function licenseTexts(dir) {
  const out = [];
  for (const n of fs.readdirSync(dir)) {
    if (!/^licen[cs]e/i.test(n)) continue;
    try { out.push(fs.readFileSync(path.join(dir, n), 'utf8').slice(0, 4000)); } catch {}
  }
  return out;
}

// dir: a skill folder; repoLicense: the license name the build recorded (may be "unspecified").
// trusted: a reason string when the source is known to be licensed although no file says so (sources.json licensePolicy.trustedSources).
export function classify(dir, repoLicense = '', trusted = null) {
  let fm = '';
  try { fm = frontmatterLicense(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')); } catch {}
  const texts = licenseTexts(dir);
  if (NONCOMMERCIAL.test(fm) && !/mit license\. .*data/i.test(fm)) return { ok: false, why: `non-commercial license (${fm})` };
  for (const t of texts) {
    if (NONCOMMERCIAL.test(t.slice(0, 600))) return { ok: false, why: 'non-commercial license file' };
    if (PROPRIETARY_TEXT.test(t.slice(0, 300)) && PROPRIETARY_HINT.test(t)) return { ok: false, why: 'proprietary, all rights reserved (copy not permitted outside the vendor service)' };
  }
  if (repoLicense && !/^(unspecified|see license|proprietary)/i.test(repoLicense) && GRANT.test(repoLicense)) return { ok: true, why: repoLicense };
  if (repoLicense === 'CC') return { ok: true, why: 'Creative Commons attribution' };
  if (GRANT.test(fm)) return { ok: true, why: fm };
  for (const t of texts) if (GRANT.test(t)) return { ok: true, why: 'license file grants use' };
  if (trusted) return { ok: true, why: `trusted source: ${trusted}` };
  return { ok: false, why: 'no license found (all rights reserved by default)' };
}
