# ADR-003: Concurrency Control (`SELECT ... FOR UPDATE`), Deadlock Avoidance & Idempotency

## Status
Accepted

## Context
In a financial system, three classic distributed systems failures occur under concurrent load:
1. **Race Condition (TOCTOU / Double-Spend):** Alice has `R$ 100,00`. She sends two simultaneous requests to transfer `R$ 100,00` each. If both requests read `balance = 10000` before either commits, both succeed and Alice's balance becomes `-R$ 100,00`.
2. **AB-BA Database Deadlock:** Request 1 transfers from Alice (`acc_1`) to Bob (`acc_2`) and locks `acc_1` then `acc_2`. Simultaneously, Request 2 transfers from Bob (`acc_2`) to Alice (`acc_1`) and locks `acc_2` then `acc_1`. Both transactions wait forever on each other.
3. **Network Retry Duplication:** A mobile client sends a transfer request, the server commits it, but the Wi-Fi drops before the HTTP response arrives. The client retries the POST request.

## Decision
1. **Pessimistic Row Locking (`SELECT ... FOR UPDATE`):**
   - Inside `postLedgerTransaction`, before checking balances or inserting entries, we execute `SELECT ... FROM accounts WHERE id IN (...) ORDER BY id ASC FOR UPDATE`.
   - Any concurrent transaction touching any of the same accounts waits in PostgreSQL's lock queue until the first transaction commits or rolls back.
2. **Deterministic Lock Ordering (`ORDER BY id ASC`):**
   - Account IDs are always sorted lexicographically before acquiring locks. Whether Alice pays Bob or Bob pays Alice, both transactions lock `min(acc_A, acc_B)` first, then `max(acc_A, acc_B)`. This makes circular wait (deadlock) mathematically impossible.
3. **Atomic Idempotency Keys (`Idempotency-Key` Header):**
   - Mutating endpoints require an `Idempotency-Key` header.
   - We compute a SHA-256 hash of the request payload and store `(user_id, key, endpoint, request_hash, status_code, response_body)` in `idempotency_records`.
   - If the same key is replayed with the same payload, we return the stored response immediately without re-executing the transaction. If replayed with a *different* payload, we reject with `409 IDEMPOTENCY_KEY_CONFLICT`.

## Consequences
- **Positive:** 100% immunity to parallel double-spend attacks, deadlocks, and network retry duplication, verified by automated concurrency tests.
