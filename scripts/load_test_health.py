#!/usr/bin/env python3
"""
scripts/load_test_health.py

A synthetic concurrency test against a running instance of
`backend (updated)` — NOT a substitute for real production load testing
(different hardware, network stack, and this sandbox has no real
MongoDB/Redis behind it — see README.md). What it DOES give real evidence
of: whether the Express app itself (middleware chain — CORS, rate
limiting, structured logging, routing) can handle concurrent requests
without falling over or serializing them unexpectedly.

Usage:
  1. Start the server (see README.md for .env setup), then:
     python3 scripts/load_test_health.py [--url URL] [--concurrency N]
"""
import argparse
import time
import urllib.request
import urllib.error
import concurrent.futures


def hit(url):
    start = time.time()
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            status = resp.status
    except urllib.error.HTTPError as e:
        # The server responded — this is a real HTTP status code (e.g.
        # 503 from /health when MongoDB isn't connected), not a failure
        # to connect. Reported distinctly from a genuine connection error
        # below, since lumping them together would make an honestly-
        # reported 503 look like the server crashed.
        status = e.code
    except Exception as e:
        status = f"CONNECTION_ERROR: {e}"
    return time.time() - start, status


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:5000/health")
    parser.add_argument("--concurrency", type=int, default=50)
    args = parser.parse_args()

    print(f"Firing {args.concurrency} concurrent requests at {args.url} ...")
    start_total = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        results = list(ex.map(lambda _: hit(args.url), range(args.concurrency)))
    total = time.time() - start_total

    times = [r[0] for r in results]
    statuses = [r[1] for r in results]
    connection_errors = [s for s in statuses if isinstance(s, str)]
    status_codes = [s for s in statuses if isinstance(s, int)]

    print(f"\nTotal wall time for {args.concurrency} concurrent requests: {total:.3f}s")
    print(f"Average per-request latency: {sum(times)/len(times)*1000:.1f}ms")
    print(f"Min: {min(times)*1000:.1f}ms | Max: {max(times)*1000:.1f}ms")
    print(f"HTTP status codes received: {sorted(set(status_codes)) if status_codes else 'none'}")
    print(f"Connection errors (server unreachable, not an HTTP status): {len(connection_errors)}/{args.concurrency}")
    if connection_errors:
        print(f"  Sample: {connection_errors[0]}")


if __name__ == "__main__":
    main()
