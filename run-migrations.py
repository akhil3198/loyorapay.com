#!/usr/bin/env python3
import urllib.request, json, os, sys

TOKEN = "sbp_ce1a7344a6ac8b98bcc3a0bdd7cccec805e3575e"
PROJECT = "togjwxlzieqysyrdbcil"
URL = f"https://api.supabase.com/v1/projects/{PROJECT}/database/query"

migrations = [
    "backend/migrations/002-gdpr.sql",
    "backend/migrations/003-security.sql",
    "backend/migrations/004-schema-fixes.sql",
]

base = os.path.dirname(os.path.abspath(__file__))

for m in migrations:
    path = os.path.join(base, m)
    with open(path) as f:
        sql = f.read()

    # Split into individual statements and run each
    statements = [s.strip() for s in sql.split(';') if s.strip() and not s.strip().startswith('--')]

    print(f"Running {m} ({len(statements)} statements)...")
    errors = []
    for stmt in statements:
        data = json.dumps({"query": stmt + ";"}).encode()
        req = urllib.request.Request(URL, data=data, headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json"
        })
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                pass
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            if 'already exists' not in body and 'duplicate' not in body.lower():
                errors.append(f"  stmt: {stmt[:60]}... => {body[:150]}")

    if errors:
        print(f"  Warnings/errors:")
        for e in errors:
            print(e)
    else:
        print(f"  ✓ Done")

print("\n✓ All migrations complete")
