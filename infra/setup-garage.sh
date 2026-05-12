#!/bin/bash
set -e

# Setup script for Garage S3 storage
# Run this once after `docker compose up -d garage` on a fresh install

RPC_HOST="${1:-127.0.0.1:3901}"
RPC_SECRET="deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
KEY_NAME="shipyard-key"
BUCKET_NAME="shipyard"
CAPACITY="10GB"
ZONE="default"

echo "=== Garage Bootstrap Script ==="

# Wait for Garage to be ready
echo "Waiting for Garage to be ready..."
until /garage status >/dev/null 2>&1; do
    sleep 1
done

# Get node ID
NODE_ID=$(/garage status 2>/dev/null | grep -oP '^\d{16}' | head -1 || true)
if [ -z "$NODE_ID" ]; then
    echo "ERROR: Could not find node ID"
    exit 1
fi
echo "Found node: $NODE_ID"

# Setup layout if not already done
echo "Setting up cluster layout..."
/garage layout assign "$NODE_ID" -c "$CAPACITY" -z "$ZONE" 2>/dev/null || true

# Apply layout (use --version 1 for new cluster, otherwise increment)
LAYOUT_VERSION=$(/garage layout show 2>/dev/null | grep -oP 'Current cluster layout version: \K\d+' || echo "0")
NEW_VERSION=$((LAYOUT_VERSION + 1))
echo "Applying layout version $NEW_VERSION..."
/garage layout apply --version "$NEW_VERSION" 2>/dev/null || echo "Layout already applied"

# Create key if not exists
echo "Creating S3 key..."
KEY_OUTPUT=$(/garage key create "$KEY_NAME" 2>/dev/null || true)
if echo "$KEY_OUTPUT" | grep -q "Key ID:"; then
    ACCESS_KEY=$(echo "$KEY_OUTPUT" | grep "Key ID:" | awk '{print $3}')
    SECRET_KEY=$(echo "$KEY_OUTPUT" | grep "Secret key:" | awk '{print $3}')
    echo "Created new key: $ACCESS_KEY"
    echo "  Update your .env with:"
    echo "    GARAGE_S3_ACCESS_KEY=$ACCESS_KEY"
    echo "    GARAGE_S3_SECRET_KEY=$SECRET_KEY"
else
    # Key might already exist, get it
    ACCESS_KEY=$(/garage key list 2>/dev/null | grep "$KEY_NAME" | awk '{print $1}')
    echo "Using existing key: $ACCESS_KEY"
fi

# Create bucket if not exists
echo "Setting up bucket..."
/garage bucket create "$BUCKET_NAME" 2>/dev/null || echo "Bucket already exists"

# Allow key on bucket
echo "Allowing key on bucket..."
BUCKET_ID=$(/garage bucket list 2>/dev/null | grep "$BUCKET_NAME" | awk '{print $1}')
/garage bucket allow "$BUCKET_ID" --key "$ACCESS_KEY" --write 2>/dev/null || echo "Key already allowed"

echo "=== Garage bootstrap complete ==="
echo "Access key: $ACCESS_KEY"
echo "Bucket: $BUCKET_NAME"