# Single store, one clock

The kit ledger is one SQLite file. UTC day keys come from **this process clock** (`Date` on the writer). Health reports `day_clock.source: "process"` and `day_clock.multi_writer` as unsupported without one shared store and one clock.

## Before a second writer

Do not run two `burnbrake serve` processes against different files and expect one UTC day. Do not run two processes on one file unless you accept SQLite's own locking **and** the same clock.

`BURNBRAKE_WRITER_LEASE=1` takes an advisory lease in the ledger (`writer_lease` meta row, default 30 seconds, renewed by the holder). A second serve with a different writer id refuses to start while the lease is live. A reserve without a live lease is HTTP **503** `WRITER_LEASE_REQUIRED` and does not forward.

That lease is **one writer**, not a multi-pod design. It does not merge clocks. It does not replicate the file. The CLI still opens the file as the operator and does not take the lease, including while serve is up. Filesystem access remains full operator control.

## What this is not

A shared multi-pod kit. A hosted multi-tenant runtime. See [HOSTED_VS_KIT.md](./HOSTED_VS_KIT.md).
