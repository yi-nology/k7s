#!/bin/bash
# AppRun wrapper: 使用自带的 glibc 2.35 运行, 兼容麒麟 (glibc 2.31)
SELF=$(readlink -f "$0")
HERE=${SELF%/*}
export LD_LIBRARY_PATH="$HERE/usr/lib/x86_64-linux-gnu:$HERE/usr/lib:$HERE/lib:$LD_LIBRARY_PATH"
exec "$HERE/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2" \
    --library-path "$HERE/usr/lib/x86_64-linux-gnu:$HERE/usr/lib:$HERE/lib" \
    "$HERE/AppRun.wrapped" "$@"
