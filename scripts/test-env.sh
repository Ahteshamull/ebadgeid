#!/usr/bin/env bash
# Shared test-runtime settings for laptops and CI runners. MongoDB does not
# publish the mongodb-memory-server default (8.2.x) for ARM64 Debian. This
# published archive works on both ARM64 and AMD64 Linux runners.
export MONGOMS_VERSION="${MONGOMS_VERSION:-8.0.17}"
export MONGOMS_DISTRO="${MONGOMS_DISTRO:-ubuntu-22.04}"
