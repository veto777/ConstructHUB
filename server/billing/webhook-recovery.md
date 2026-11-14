# L6: abandoned webhook claims

Deferred under the requirement that recovery cannot process an event twice.

The current claim in ledger.ts commits before the handler in stripe.ts runs.
The handler uses separate transactions and calls other services. A process can
die after one of those effects succeeds but before a new processed_at marker
could be written.

Adding processed_at and reclaiming an unfinished claim after five minutes does
not establish that its original handler stopped. A slow original and a retry
could both process it. A claim token could fence the completion write, but it
would not fence the existing handler's other database writes or provider calls.

A database advisory lock can exclude workers while its connection lives.
Losing that connection releases the lock without necessarily stopping provider
requests or work on other connections. It also cannot undo effects committed
before a process died.

Safe recovery needs a broader review of each handler: durable, independently
idempotent steps, provider idempotency keys where applicable, and durable jobs
for effects outside the transaction. Only then can a completion marker and a
reclaim rule safely resume unfinished work. Existing completed and abandoned
claims also need a deliberate migration policy because they are indistinguishable.

No schema or runtime claim behavior changed. The owner must decide whether to
authorize that broader recovery work; the stale-claim timeout alone is unsafe.
