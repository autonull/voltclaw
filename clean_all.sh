#!/bin/bash
sed -i '/eslint-disable/d' src/core/self-test.ts src/memory/sqlite.ts src/tools/browser.ts src/tools/code_exec.ts src/tools/errors.ts src/tools/rlm-helpers.ts
