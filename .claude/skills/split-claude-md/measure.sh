#!/bin/sh
# Measures a CLAUDE.md for the split: its words, each section's, and each line's.
#   sh .claude/skills/split-claude-md/measure.sh <dir>/CLAUDE.md [--lines]
# (A script, not inline in SKILL.md: a skill's text has $0 and $1 substituted with its arguments.)
f="$1"
wc -w "$f"
awk '/^##+ /{if(n)printf "%-40s %6d\n",n,w; n=$0; w=0; next} {w+=NF} END{printf "%-40s %6d\n",n,w}' "$f"
if [ "$2" = "--lines" ]; then
  awk '{printf "%3d %5d  %s\n", NR, NF, substr($0,1,90)}' "$f"
fi
