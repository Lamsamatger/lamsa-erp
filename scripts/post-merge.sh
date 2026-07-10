#!/bin/bash
set -e

# Install root dependencies (non-interactive)
npm install --prefer-offline 2>/dev/null || npm install

echo "Post-merge setup complete."
