#!/usr/bin/env bash
# 启动「投资日课」本地服务
cd "$(dirname "$0")" || exit 1
exec python3 server.py "$@"
