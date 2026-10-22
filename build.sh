#!/usr/bin/env bash
# 打一个可以扔到任何静态托管的包
set -euo pipefail
cd "$(dirname "$0")"
rm -rf dist
mkdir -p dist
cp index.html manifest.webmanifest sw.js dist/
cp -R assets data icons dist/
: > dist/.nojekyll
echo "已生成 dist/（$(du -sh dist | cut -f1)）"
find dist -type f | sed 's|^dist/||' | sort
