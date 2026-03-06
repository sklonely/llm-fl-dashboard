#!/bin/bash
#
# Auto-collect GPT-4.1 batch results.
# Runs every 30 min via cron. Self-destructs after success.
#
# Setup (on remote Mac Studio):
#   crontab -e
#   */30 * * * * /bin/bash ~/auto_collect.sh >> ~/auto_collect.log 2>&1

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$HOME/llm-fl-batch"
STATE_FILE="$WORK_DIR/batch_state.json"
API_KEY_FILE="$WORK_DIR/.api_key"
COLLECT_SCRIPT="$WORK_DIR/run_gpt41_batch.py"
LOG="$HOME/auto_collect.log"

echo ""
echo "=== $(date) ==="

if [ ! -f "$STATE_FILE" ]; then
    echo "No state file found. Nothing to do."
    exit 0
fi

if [ ! -f "$API_KEY_FILE" ]; then
    echo "No API key file found. Exiting."
    exit 1
fi

API_KEY=$(cat "$API_KEY_FILE")

export OPENAI_API_KEY="$API_KEY"
STATUS=$(python3 "$COLLECT_SCRIPT" status 2>&1)
echo "$STATUS"

if echo "$STATUS" | grep -q "Batch completed"; then
    echo ""
    echo ">>> Batch completed! Collecting results..."
    python3 "$COLLECT_SCRIPT" collect 2>&1
    echo ""
    echo ">>> Results collected. Cleaning up..."

    rm -f "$API_KEY_FILE"
    echo ">>> API key deleted."

    (crontab -l 2>/dev/null | grep -v "auto_collect" | crontab -) 2>/dev/null
    echo ">>> Cron job removed."

    echo ""
    echo "=== DONE. Self-destructed. ==="
elif echo "$STATUS" | grep -q "failed"; then
    echo ">>> Batch FAILED. Check errors. Removing cron."
    rm -f "$API_KEY_FILE"
    (crontab -l 2>/dev/null | grep -v "auto_collect" | crontab -) 2>/dev/null
else
    echo ">>> Still running. Will check again in 30 min."
fi
