#!/usr/bin/env bash

# Minifarm Client Setup Script
# Run this script on each client node to set up Docker and join the Swarm cluster.
#
# Usage:
#   ./setup-client.sh <client-hostname>    # Setup a single client
#   ./setup-client.sh --all                # Setup all clients from clients.json
#
# Examples:
#   ./setup-client.sh minifarm-client-1.local
#   ./setup-client.sh minifarm-client-12.local
#   ./setup-client.sh --all

set -e

# Script directory (for finding daemon.json)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Configuration
MANAGER_IP="10.0.1.1"
CLIENTS_JSON="${SCRIPT_DIR}/../server/clients.json"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

# Function to setup a single client
setup_client() {
    local CLIENT_HOST="$1"

    echo -e "${GREEN}=== Minifarm Client Setup ===${NC}"
    echo "Client: ${CLIENT_HOST}"
    echo ""

    # Test SSH connection
    echo -e "${YELLOW}[1/6] Testing SSH connection...${NC}"
    if ! ssh -o ConnectTimeout=5 "${CLIENT_HOST}" "echo 'Connected'" > /dev/null 2>&1; then
        echo -e "${RED}✗ Failed to connect to ${CLIENT_HOST}${NC}"
        echo "Please ensure:"
        echo "  1. The client is powered on"
        echo "  2. SSH is configured in ~/.ssh/config"
        echo "  3. SSH keys are set up correctly"
        return 1
    fi
    echo -e "${GREEN}✓ Connected${NC}"
    echo ""

    # Detect OS and verify it's Alpine
    echo -e "${YELLOW}[2/6] Detecting OS and checking Docker...${NC}"
    OS=$(ssh "${CLIENT_HOST}" "cat /etc/os-release | grep '^ID=' | cut -d= -f2 | tr -d '\"'")
    echo "Detected OS: ${OS}"

    if [ "$OS" != "alpine" ]; then
        echo -e "${RED}✗ Unsupported OS: ${OS}${NC}"
        echo "This script only supports Alpine Linux clients."
        echo "If you need to support other OS, please modify the script."
        return 1
    fi

    SUDO_CMD="doas"

    # Check Docker installation
    if ssh "${CLIENT_HOST}" "command -v docker" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Docker already installed${NC}"
    else
        echo "Installing Docker on Alpine Linux..."
        ssh -t "${CLIENT_HOST}" "${SUDO_CMD} apk update && ${SUDO_CMD} apk add docker"
        echo -e "${GREEN}✓ Docker installed${NC}"
    fi

    # Ensure user is in docker group (for socket access without doas)
    REMOTE_USER=$(ssh "${CLIENT_HOST}" "whoami")
    if ssh "${CLIENT_HOST}" "groups" | grep -q docker; then
        echo -e "${GREEN}✓ User ${REMOTE_USER} is in docker group${NC}"
    else
        echo "Adding ${REMOTE_USER} to docker group..."
        ssh -t "${CLIENT_HOST}" "${SUDO_CMD} addgroup ${REMOTE_USER} docker"
        echo -e "${GREEN}✓ User added to docker group${NC}"
        echo -e "${YELLOW}Note: Group change takes effect on next login${NC}"
    fi
    echo ""

    # Configure daemon.json and start Docker service
    echo -e "${YELLOW}[3/6] Configuring Docker daemon...${NC}"
    scp "${SCRIPT_DIR}/daemon.json" "${CLIENT_HOST}:/tmp/daemon.json"
    echo -e "${GREEN}✓ daemon.json copied${NC}"
    echo ""

    echo -e "${YELLOW}[4/6] Setting up Docker configuration and service...${NC}"
    ssh -t "${CLIENT_HOST}" "${SUDO_CMD} sh -c 'mkdir -p /etc/docker && mv /tmp/daemon.json /etc/docker/daemon.json && chmod 644 /etc/docker/daemon.json && rc-update add docker default 2>/dev/null; rc-service docker restart'"
    echo -e "${GREEN}✓ Docker configured and started${NC}"
    echo ""

    # Join Docker Swarm
    echo -e "${YELLOW}[6/6] Joining Docker Swarm...${NC}"

    # Get Swarm token
    if [ -f /tmp/swarm-worker-token ]; then
        TOKEN=$(cat /tmp/swarm-worker-token)
    else
        TOKEN=$(docker swarm join-token worker -q 2>/dev/null)
        if [ -z "$TOKEN" ]; then
            echo -e "${RED}✗ Could not get Swarm token. Is Swarm initialized on manager?${NC}"
            return 1
        fi
    fi

    # Check if already in swarm
    if ssh "${CLIENT_HOST}" "${SUDO_CMD} docker info 2>/dev/null | grep -q 'Swarm: active'" 2>/dev/null; then
        echo -e "${GREEN}✓ Client already in Swarm${NC}"
    else
        # Leave any stale swarm first
        ssh "${CLIENT_HOST}" "${SUDO_CMD} docker swarm leave 2>/dev/null || true" 2>/dev/null

        # Join swarm
        if ssh "${CLIENT_HOST}" "${SUDO_CMD} docker swarm join --token ${TOKEN} ${MANAGER_IP}:2377" 2>/dev/null; then
            echo -e "${GREEN}✓ Joined Docker Swarm${NC}"
        else
            echo -e "${RED}✗ Failed to join Swarm${NC}"
            echo "You can manually join with:"
            echo "  ssh ${CLIENT_HOST} '${SUDO_CMD} docker swarm join --token ${TOKEN} ${MANAGER_IP}:2377'"
            return 1
        fi
    fi
    echo ""

    echo -e "${GREEN}=== Setup Complete ===${NC}"
    echo "Client ${CLIENT_HOST} is ready and part of the Docker Swarm cluster."
}

# Check arguments
if [ $# -lt 1 ]; then
    echo "Usage: $0 <client-hostname>"
    echo "       $0 --all"
    echo ""
    echo "Examples:"
    echo "  $0 minifarm-client-1.local"
    echo "  $0 --all  # Setup all clients from clients.json"
    exit 1
fi

# Handle --all flag
if [ "$1" = "--all" ]; then
    if [ ! -f "$CLIENTS_JSON" ]; then
        echo -e "${RED}✗ clients.json not found at: ${CLIENTS_JSON}${NC}"
        exit 1
    fi

    if ! command -v jq &> /dev/null; then
        echo -e "${RED}✗ jq is required for --all mode. Install with: apt install jq${NC}"
        exit 1
    fi

    # Extract client IDs and iterate
    CLIENT_IDS=$(jq -r '.[].id' "$CLIENTS_JSON")
    TOTAL=$(echo "$CLIENT_IDS" | wc -l)
    CURRENT=0
    FAILED=()
    SUCCEEDED=()

    echo -e "${GREEN}=== Setting up all clients from clients.json ===${NC}"
    echo "Found ${TOTAL} clients to configure"
    echo ""

    for CLIENT_ID in $CLIENT_IDS; do
        CURRENT=$((CURRENT + 1))
        CLIENT_HOST="${CLIENT_ID}.local"
        echo -e "${YELLOW}>>> Processing ${CURRENT}/${TOTAL}: ${CLIENT_HOST}${NC}"
        echo ""

        if setup_client "$CLIENT_HOST"; then
            SUCCEEDED+=("$CLIENT_HOST")
        else
            FAILED+=("$CLIENT_HOST")
        fi
        echo ""
    done

    # Summary
    echo -e "${GREEN}=== All Clients Summary ===${NC}"
    echo "Succeeded: ${#SUCCEEDED[@]}"
    for host in "${SUCCEEDED[@]}"; do
        echo -e "  ${GREEN}✓${NC} $host"
    done

    if [ ${#FAILED[@]} -gt 0 ]; then
        echo "Failed: ${#FAILED[@]}"
        for host in "${FAILED[@]}"; do
            echo -e "  ${RED}✗${NC} $host"
        done
        exit 1
    fi

    exit 0
fi

CLIENT_HOST="$1"

# Run setup for single client
setup_client "$CLIENT_HOST"
