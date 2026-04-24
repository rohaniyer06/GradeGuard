#!/usr/bin/env bash
set -euo pipefail

openclaw daemon start
openclaw gateway start
npm run start:ui
