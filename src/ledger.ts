import { randomUUID } from "node:crypto";
import { chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { BRAKE_DEFAULTS, classifyOpenZone, validateBrakeConfig, type BrakeConfig } from "./brake.js";
import { IDEMPOTENCY_BODY_TTL_MS, RESERVATION_TTL_MS } from "./constants.js";

export type ScopeName = "user" | "run" | "day";
export type ReservationState =
  | "RESERVED"
  | "FORWARDED"
  | "SETTLED"
  | "RELEASED"
  | "DEBIT_RESERVED"
  | "FORCE_RELEASED";

export interface DefaultCaps {
  user: number | null;
  run: number | null;
  day: number | null;
}

export interface LedgerOptions {
  reservationTtlMs?: number;
  now?: () => number;
  defaultCaps?: DefaultCaps;
  /** When true, a reserve with neither user nor day scope is refused. */
  productionDurableScope?: boolean;
  /** Advisory single-writer lease. Does not make multi-pod safe. */
  writerLease?: { holder: string; ttlMs: number };
}

export interface ReserveInput {
  userId: string | null;
  runId: string | null;
  estimateMicros: number;
  idempotencyKey: string | null;
  model: string;
  route: string;
  maxTokens: number;
  maxTokensSource: "request" | "injected";
  priceTableVersion: string;
}

export interface ScopeSnapshot {
  scope: ScopeName;
  key: string;
  cap_micros: number;
  spent_micros: number;
  held_micros: number;
  remaining_micros: number;
  debt_micros: number;
  overshoot_micros: number;
}

export type ReserveResult =
  | { kind: "reserved"; reservationId: string; scopes: ScopeSnapshot[] }
  | { kind: "replay"; httpStatus: number; body: string }
  | { kind: "in_flight"; reservationId: string | null }
  | {
      kind: "deny";
      code: string;
      httpStatus: number;
      scope: ScopeName | null;
      remaining_micros: number;
      requested_micros: number;
      user_id: string | null;
      run_id: string | null;
      message: string;
    };

/** Curve look-ahead. `black` is a locked deny. `color` still has to reserve after the wait. */
export type BrakePreview =
  | { kind: "skip" }
  | { kind: "black"; delay_ms: number; deny: Extract<ReserveResult, { kind: "deny" }> }
  | {
      kind: "color";
      zone: "green" | "amber" | "red";
      delay_ms: number;
      scope: ScopeName;
      remaining_micros: number;
    };

type PreparedReserve =
  | { outcome: "done"; result: ReserveResult }
  | { outcome: "ready"; dayKey: string; accounts: AccountRow[] };

export interface DecisionInput {
  userId: string | null;
  runId: string | null;
  decision: "ALLOW" | "DENY";
  code: string | null;
  scope: string | null;
  requestedMicros: number | null;
  remainingAfterMicros: number | null;
  debtDeltaMicros: number;
  model: string | null;
  route: string | null;
  latencyMs: number | null;
  idempotencyKey: string | null;
  priceTableVersion: string | null;
  upstreamForwarded: boolean;
  reservationId: string | null;
  estimatedMicros: number | null;
  settledMicros: number | null;
  terminalReason: string | null;
  maxTokensSource: string | null;
}

export interface DecisionRow {
  id: number;
  ts: number;
  user_id: string | null;
  run_id: string | null;
  decision: string;
  code: string | null;
  scope: string | null;
  requested_micros: number | null;
  remaining_after_micros: number | null;
  debt_delta_micros: number;
  model: string | null;
  route: string | null;
  latency_ms: number | null;
  idempotency_key: string | null;
  price_table_version: string | null;
  upstream_forwarded: number;
  reservation_id: string | null;
  estimated_micros: number | null;
  settled_micros: number | null;
  terminal_reason: string | null;
  max_tokens_source: string | null;
}

interface AccountRow {
  scope: string;
  scope_key: string;
  cap_micros: number;
  spent_micros: number;
  held_micros: number;
  overshoot_micros: number;
}

interface ReservationRow {
  id: string;
  idempotency_key: string | null;
  user_id: string | null;
  run_id: string | null;
  day_key: string;
  scopes: string;
  estimate_micros: number;
  actual_micros: number | null;
  state: ReservationState;
  terminal_reason: string | null;
  model: string | null;
  route: string | null;
  created_at: number;
  updated_at: number;
  forwarded_at: number | null;
  max_tokens: number | null;
  max_tokens_source: string | null;
  price_table_version: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scope_accounts (
  scope TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  cap_micros INTEGER NOT NULL,
  spent_micros INTEGER NOT NULL DEFAULT 0,
  held_micros INTEGER NOT NULL DEFAULT 0,
  overshoot_micros INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, scope_key)
);
CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT,
  user_id TEXT,
  run_id TEXT,
  day_key TEXT NOT NULL,
  scopes TEXT NOT NULL,
  estimate_micros INTEGER NOT NULL,
  actual_micros INTEGER,
  state TEXT NOT NULL,
  terminal_reason TEXT,
  model TEXT,
  route TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  forwarded_at INTEGER,
  max_tokens INTEGER,
  max_tokens_source TEXT,
  price_table_version TEXT
);
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  user_id TEXT,
  run_id TEXT,
  decision TEXT NOT NULL,
  code TEXT,
  scope TEXT,
  requested_micros INTEGER,
  remaining_after_micros INTEGER,
  debt_delta_micros INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  route TEXT,
  latency_ms INTEGER,
  idempotency_key TEXT,
  price_table_version TEXT,
  upstream_forwarded INTEGER NOT NULL,
  reservation_id TEXT,
  estimated_micros INTEGER,
  settled_micros INTEGER,
  terminal_reason TEXT,
  max_tokens_source TEXT
);
CREATE TABLE IF NOT EXISTS idempotency (
  idem_key TEXT PRIMARY KEY,
  user_id TEXT,
  run_id TEXT,
  reservation_id TEXT,
  state TEXT NOT NULL,
  http_status INTEGER,
  response_body TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS controls (
  kind TEXT NOT NULL,
  ctrl_key TEXT NOT NULL,
  paused INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (kind, ctrl_key)
);
CREATE TABLE IF NOT EXISTS force_release_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_res_state_created ON reservations(state, created_at);
CREATE INDEX IF NOT EXISTS idx_dec_ts ON decisions(ts);
CREATE INDEX IF NOT EXISTS idx_dec_run ON decisions(run_id, ts);
CREATE INDEX IF NOT EXISTS idx_dec_user ON decisions(user_id, ts);
`;

export interface EstimateErrorSummary {
  samples: number;
  under_reserve: number;
  over_reserve: number;
  exact: number;
  net_error_micros: number;
  max_under_reserve_micros: number;
}

interface WriterLeaseRow {
  holder: string;
  until: number;
}

export class Ledger {
  private readonly db: DatabaseSync;
  private readonly ttlMs: number;
  private readonly productionDurableScope: boolean;
  private leaseHolder: string | null = null;
  private leaseTtlMs = 0;
  private nowFn: () => number;

  constructor(path: string, opts: LedgerOptions = {}) {
    this.db = new DatabaseSync(path);
    // DatabaseSync's timeout option does not wait on this Node. Set the pragma
    // before any other statement so a second process waits instead of seeing
    // "database is locked" and refusing to start.
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(SCHEMA);
    this.ttlMs = opts.reservationTtlMs ?? RESERVATION_TTL_MS;
    this.productionDurableScope = opts.productionDurableScope === true;
    this.nowFn = opts.now ?? (() => Date.now());
    if (!this.isWritable()) {
      throw new Error("Ledger is not writable. Refusing to start (fail closed).");
    }
    restrictLedgerPermissions(path);
    if (opts.defaultCaps) {
      for (const scope of ["user", "run", "day"] as const) {
        const cap = opts.defaultCaps[scope];
        if (cap != null) this.setDefaultCap(scope, cap);
      }
    }
    if (opts.writerLease) {
      try {
        this.acquireWriterLease(opts.writerLease.holder, opts.writerLease.ttlMs);
      } catch (err) {
        this.db.close();
        throw err;
      }
    }
  }

  close(): void {
    try {
      this.releaseWriterLease();
    } catch {
      /* closing */
    }
    this.db.close();
  }

  writerLeaseHeld(): boolean {
    if (!this.leaseHolder) return false;
    const row = this.readWriterLease();
    return Boolean(row && row.holder === this.leaseHolder && row.until > this.now());
  }

  acquireWriterLease(holder: string, ttlMs: number): void {
    if (!holder) throw new Error("writer lease holder is required");
    if (!Number.isInteger(ttlMs) || ttlMs < 1) throw new Error("writer lease ttl must be a positive integer");
    this.tx(() => {
      const current = this.readWriterLease();
      const now = this.now();
      if (current && current.holder !== holder && current.until > now) {
        throw new Error(
          `Another writer holds this ledger until ${new Date(current.until).toISOString()}. One store and one process clock are required before a second writer. This kit does not run multi-pod.`,
        );
      }
      const until = now + ttlMs;
      this.db
        .prepare("INSERT INTO meta(k, v) VALUES ('writer_lease', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v")
        .run(JSON.stringify({ holder, until }));
    });
    this.leaseHolder = holder;
    this.leaseTtlMs = ttlMs;
  }

  renewWriterLease(): void {
    if (!this.leaseHolder || this.leaseTtlMs < 1) return;
    this.acquireWriterLease(this.leaseHolder, this.leaseTtlMs);
  }

  releaseWriterLease(): void {
    if (!this.leaseHolder) return;
    const holder = this.leaseHolder;
    this.tx(() => {
      const current = this.readWriterLease();
      if (current && current.holder === holder) {
        this.db.prepare("DELETE FROM meta WHERE k = 'writer_lease'").run();
      }
    });
    this.leaseHolder = null;
  }

  setNow(fn: () => number): void {
    this.nowFn = fn;
  }

  now(): number {
    return this.nowFn();
  }

  utcDay(nowMs = this.now()): string {
    return new Date(nowMs).toISOString().slice(0, 10);
  }

  isWritable(): boolean {
    try {
      this.db
        .prepare(
          "INSERT INTO meta(k, v) VALUES ('heartbeat', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
        )
        .run(String(this.now()));
      return true;
    } catch {
      return false;
    }
  }

  setDefaultCaps(caps: DefaultCaps): void {
    this.setDefaultCap("user", caps.user);
    this.setDefaultCap("run", caps.run);
    this.setDefaultCap("day", caps.day);
  }

  setDefaultCap(scope: ScopeName, micros: number | null): void {
    const key = defaultMetaKey(scope);
    if (micros == null) {
      this.db.prepare("DELETE FROM meta WHERE k = ?").run(key);
      return;
    }
    assertMicros(micros, "cap");
    this.db
      .prepare("INSERT INTO meta(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v")
      .run(key, String(micros));
  }

  getDefaultCap(scope: ScopeName): number | null {
    const row = this.db.prepare("SELECT v FROM meta WHERE k = ?").get(defaultMetaKey(scope)) as
      | { v: string }
      | undefined;
    if (!row) return null;
    return Number(row.v);
  }

  /** Stored operator/env curve. Missing meta uses the locked defaults (`enabled: false`). */
  getBrake(): BrakeConfig {
    const row = this.db.prepare("SELECT v FROM meta WHERE k = ?").get("brake_json") as { v: string } | undefined;
    if (!row) return { ...BRAKE_DEFAULTS };
    return validateBrakeConfig(JSON.parse(row.v) as unknown);
  }

  setBrake(config: BrakeConfig): void {
    const validated = validateBrakeConfig(config);
    this.db
      .prepare("INSERT INTO meta(k, v) VALUES ('brake_json', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v")
      .run(JSON.stringify(validated));
  }

  setCap(scope: ScopeName, scopeKey: string, micros: number): void {
    assertMicros(micros, "cap");
    if (!scopeKey) throw new Error("scope key is required");
    this.tx(() => {
      this.db
        .prepare(
          `INSERT INTO scope_accounts(scope, scope_key, cap_micros, spent_micros, held_micros, overshoot_micros)
           VALUES (?, ?, ?, 0, 0, 0)
           ON CONFLICT(scope, scope_key) DO UPDATE SET cap_micros = excluded.cap_micros`,
        )
        .run(scope, scopeKey, micros);
    });
  }

  pauseGlobal(paused: boolean): void {
    this.setControl("global", "global", paused);
  }

  pauseRun(runId: string, paused: boolean): void {
    if (!runId) throw new Error("run id is required");
    this.setControl("run", runId, paused);
  }

  isGlobalPaused(): boolean {
    return this.readControl("global", "global");
  }

  isRunPaused(runId: string | null): boolean {
    if (!runId) return false;
    return this.readControl("run", runId);
  }

  reserve(input: ReserveInput): ReserveResult {
    if (!Number.isSafeInteger(input.estimateMicros) || input.estimateMicros < 0) {
      return denyResult({
        code: "BAD_REQUEST",
        httpStatus: 400,
        scope: null,
        remaining_micros: 0,
        requested_micros: 0,
        user_id: input.userId,
        run_id: input.runId,
        message: "estimate must be a non-negative integer number of micros.",
      });
    }
    return this.tx(() => this.reserveUnlocked(input));
  }

  /**
   * Decide the curve without taking a hold. The write lock covers the same pre-check
   * sweep as reserve, then commits. Sleep after this returns — never inside the transaction.
   * A black verdict is locked: a later cap raise must not turn it into a forward.
   */
  previewBrake(input: ReserveInput, brake: BrakeConfig): BrakePreview {
    if (!Number.isSafeInteger(input.estimateMicros) || input.estimateMicros < 0) {
      return { kind: "skip" };
    }
    return this.tx(() => {
      const prepared = this.prepareReserve(input);
      if (prepared.outcome === "done") {
        const result = prepared.result;
        if (result.kind === "deny" && (result.code === "BUDGET_EXHAUSTED" || result.code === "SPEND_PAUSED")) {
          return { kind: "black", delay_ms: brake.black_delay_ms, deny: result };
        }
        return { kind: "skip" };
      }
      const open = prepared.accounts.map((row) => ({
        scope: row.scope as ScopeName,
        cap_micros: row.cap_micros,
        remaining_micros: row.cap_micros - row.spent_micros - row.held_micros,
      }));
      return { kind: "color", ...classifyOpenZone(open, brake) };
    });
  }

  markForwarded(reservationId: string): void {
    this.tx(() => {
      const row = this.mustReservation(reservationId);
      if (row.state !== "RESERVED") {
        throw new Error(`cannot mark FORWARDED from state ${row.state}`);
      }
      const now = this.now();
      this.db
        .prepare(
          "UPDATE reservations SET state = 'FORWARDED', forwarded_at = ?, updated_at = ? WHERE id = ?",
        )
        .run(now, now, reservationId);
    });
  }

  /** Pre-forward only. Throws if the reservation already forwarded. */
  release(reservationId: string): void {
    this.tx(() => {
      const row = this.mustReservation(reservationId);
      if (row.state !== "RESERVED") {
        throw new Error(
          `refusing to free-release reservation ${reservationId} from state ${row.state}. Never free-release after FORWARDED.`,
        );
      }
      this.releaseHold(row);
      const now = this.now();
      this.db
        .prepare(
          "UPDATE reservations SET state = 'RELEASED', terminal_reason = 'RELEASE_PRE_FORWARD', updated_at = ? WHERE id = ?",
        )
        .run(now, reservationId);
    });
  }

  /** Confirmed provider no-charge after forward. Releases the unused hold. Does not debit.
   *  A row that already settled or was debited (TTL/crash) stays that way. The debit stands.
   */
  releaseNoCharge(reservationId: string): void {
    this.tx(() => {
      const row = this.mustReservation(reservationId);
      if (
        row.state === "RELEASED" ||
        row.state === "FORCE_RELEASED" ||
        row.state === "DEBIT_RESERVED" ||
        row.state === "SETTLED"
      ) {
        return;
      }
      if (row.state !== "FORWARDED") {
        throw new Error(`releaseNoCharge requires FORWARDED, found ${row.state}`);
      }
      this.releaseHold(row);
      const now = this.now();
      this.db
        .prepare(
          "UPDATE reservations SET state = 'RELEASED', terminal_reason = 'RELEASE_UPSTREAM_NO_CHARGE', actual_micros = 0, updated_at = ? WHERE id = ?",
        )
        .run(now, reservationId);
    });
  }

  settle(reservationId: string, actualMicros: number): { debtDeltaMicros: number; terminalReason: string } {
    if (!Number.isSafeInteger(actualMicros) || actualMicros < 0) {
      throw new Error("actual micros must be a non-negative integer");
    }
    return this.tx(() => {
      const row = this.mustReservation(reservationId);
      if (row.state === "SETTLED") {
        return { debtDeltaMicros: 0, terminalReason: row.terminal_reason ?? "SETTLED" };
      }
      if (row.state === "DEBIT_RESERVED") {
        const delta = actualMicros - row.estimate_micros;
        if (delta !== 0) this.addSpent(row, delta);
        if (delta > 0) this.addOvershoot(row, delta);
        const now = this.now();
        this.db
          .prepare(
            "UPDATE reservations SET state = 'SETTLED', terminal_reason = 'SETTLED', actual_micros = ?, updated_at = ? WHERE id = ?",
          )
          .run(actualMicros, now, reservationId);
        return { debtDeltaMicros: Math.max(0, delta), terminalReason: "SETTLED" };
      }
      if (row.state !== "FORWARDED") {
        throw new Error(`cannot settle from state ${row.state}`);
      }
      this.releaseHold(row);
      this.addSpent(row, actualMicros);
      const overshoot = Math.max(0, actualMicros - row.estimate_micros);
      if (overshoot > 0) this.addOvershoot(row, overshoot);
      const now = this.now();
      this.db
        .prepare(
          "UPDATE reservations SET state = 'SETTLED', terminal_reason = 'SETTLED', actual_micros = ?, updated_at = ? WHERE id = ?",
        )
        .run(actualMicros, now, reservationId);
      return { debtDeltaMicros: overshoot, terminalReason: "SETTLED" };
    });
  }

  debitReserved(
    reservationId: string,
    reason: "DEBIT_TTL_OR_CRASH" | "DEBIT_UPSTREAM_UNKNOWN",
  ): { debtDeltaMicros: number; terminalReason: string } {
    return this.tx(() => {
      const row = this.mustReservation(reservationId);
      if (row.state === "DEBIT_RESERVED" || row.state === "SETTLED") {
        return { debtDeltaMicros: 0, terminalReason: row.terminal_reason ?? reason };
      }
      if (row.state !== "FORWARDED") {
        throw new Error(`refusing DEBIT_RESERVED from state ${row.state}`);
      }
      this.releaseHold(row);
      this.addSpent(row, row.estimate_micros);
      const now = this.now();
      this.db
        .prepare(
          "UPDATE reservations SET state = 'DEBIT_RESERVED', terminal_reason = ?, actual_micros = ?, updated_at = ? WHERE id = ?",
        )
        .run(reason, row.estimate_micros, now, reservationId);
      return { debtDeltaMicros: 0, terminalReason: reason };
    });
  }

  forceRelease(reservationId: string, reason: string): void {
    if (!reason.trim()) throw new Error("force-release requires an audit reason");
    this.tx(() => {
      const row = this.mustReservation(reservationId);
      if (row.state !== "RESERVED" && row.state !== "FORWARDED") {
        throw new Error(`force-release only applies to open reservations, found ${row.state}`);
      }
      this.releaseHold(row);
      const now = this.now();
      this.db
        .prepare(
          "UPDATE reservations SET state = 'FORCE_RELEASED', terminal_reason = 'FORCE_RELEASE_AUDITED', updated_at = ? WHERE id = ?",
        )
        .run(now, reservationId);
      this.db
        .prepare("INSERT INTO force_release_audit(reservation_id, reason, ts) VALUES (?, ?, ?)")
        .run(reservationId, reason.trim(), now);
    });
  }

  sweep(): { released: number; debited: number } {
    return this.tx(() => this.sweepUnlocked());
  }

  getReservation(id: string): ReservationRow | undefined {
    return this.db.prepare("SELECT * FROM reservations WHERE id = ?").get(id) as ReservationRow | undefined;
  }

  listReservations(filter: { state?: string; runId?: string; limit?: number } = {}): ReservationRow[] {
    const where: string[] = [];
    const args: Array<string | number | null> = [];
    if (filter.state) {
      where.push("state = ?");
      args.push(filter.state);
    }
    if (filter.runId) {
      where.push("run_id = ?");
      args.push(filter.runId);
    }
    const sql = `SELECT * FROM reservations ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`;
    args.push(filter.limit ?? 50);
    return this.db.prepare(sql).all(...args) as unknown as ReservationRow[];
  }

  balances(filter: { userId?: string | null; runId?: string | null } = {}): {
    day_boundary: "UTC";
    day_key: string;
    warning: string | null;
    paused: { global: boolean; run: boolean };
    scopes: Array<ScopeSnapshot & { active_reservations: number }>;
  } {
    const dayKey = this.utcDay();
    const scopes: Array<ScopeSnapshot & { active_reservations: number }> = [];
    const pushAccount = (scope: ScopeName, key: string | null) => {
      if (!key) return;
      const row = this.account(scope, key);
      if (!row) return;
      const snap = this.snapshot(row);
      scopes.push({ ...snap, active_reservations: this.activeCount(scope, key) });
    };
    if (filter.userId) pushAccount("user", filter.userId);
    if (filter.runId) pushAccount("run", filter.runId);
    pushAccount("day", dayKey);
    if (!filter.userId && !filter.runId) {
      const rows = this.db
        .prepare("SELECT * FROM scope_accounts ORDER BY scope, scope_key")
        .all() as unknown as AccountRow[];
      for (const row of rows) {
        if (row.scope === "day" && row.scope_key === dayKey) continue;
        const snap = this.snapshot(row);
        scopes.push({
          ...snap,
          active_reservations: this.activeCount(row.scope as ScopeName, row.scope_key),
        });
      }
    }
    return {
      day_boundary: "UTC",
      day_key: dayKey,
      warning: this.scopeWarning(),
      paused: {
        global: this.isGlobalPaused(),
        run: filter.runId ? this.isRunPaused(filter.runId) : false,
      },
      scopes,
    };
  }

  scopePosture(): { user: boolean; run: boolean; day: boolean; run_alone: boolean; durable: boolean } {
    const user = this.scopeConfigured("user");
    const run = this.scopeConfigured("run");
    const day = this.scopeConfigured("day");
    return {
      user,
      run,
      day,
      run_alone: run && !user && !day,
      durable: user || day,
    };
  }

  scopeWarning(): string | null {
    const posture = this.scopePosture();
    if (!posture.user && !posture.run && !posture.day) {
      return "no caps configured; the spend path will reject until a user, run, or day cap is set";
    }
    if (!posture.user && !posture.day) {
      return "run-only caps are washable by rotating x-burnbrake-run-id. Production requires a user cap and/or a day cap.";
    }
    if (!posture.day) {
      return "no day cap; user and run ids are chosen by the authenticated caller and can be rotated — set a day cap";
    }
    return null;
  }

  logDecision(input: DecisionInput): void {
    this.db
      .prepare(
        `INSERT INTO decisions(
          ts, user_id, run_id, decision, code, scope, requested_micros, remaining_after_micros,
          debt_delta_micros, model, route, latency_ms, idempotency_key, price_table_version,
          upstream_forwarded, reservation_id, estimated_micros, settled_micros, terminal_reason, max_tokens_source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.now(),
        input.userId,
        input.runId,
        input.decision,
        input.code,
        input.scope,
        input.requestedMicros,
        input.remainingAfterMicros,
        input.debtDeltaMicros,
        input.model,
        input.route,
        input.latencyMs,
        input.idempotencyKey,
        input.priceTableVersion,
        input.upstreamForwarded ? 1 : 0,
        input.reservationId,
        input.estimatedMicros,
        input.settledMicros,
        input.terminalReason,
        input.maxTokensSource,
      );
  }

  listDecisions(filter: {
    denyOnly?: boolean;
    userId?: string;
    runId?: string;
    limit?: number;
  } = {}): DecisionRow[] {
    const where: string[] = [];
    const args: Array<string | number | null> = [];
    if (filter.denyOnly) where.push("decision = 'DENY'");
    if (filter.userId) {
      where.push("user_id = ?");
      args.push(filter.userId);
    }
    if (filter.runId) {
      where.push("run_id = ?");
      args.push(filter.runId);
    }
    const sql = `SELECT * FROM decisions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`;
    args.push(filter.limit ?? 100);
    return this.db.prepare(sql).all(...args) as unknown as DecisionRow[];
  }

  estimateErrorSummary(): EstimateErrorSummary {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS samples,
           COALESCE(SUM(CASE WHEN settled_micros > estimated_micros THEN 1 ELSE 0 END), 0) AS under_reserve,
           COALESCE(SUM(CASE WHEN settled_micros < estimated_micros THEN 1 ELSE 0 END), 0) AS over_reserve,
           COALESCE(SUM(CASE WHEN settled_micros = estimated_micros THEN 1 ELSE 0 END), 0) AS exact,
           COALESCE(SUM(settled_micros - estimated_micros), 0) AS net_error_micros,
           COALESCE(MAX(CASE WHEN settled_micros > estimated_micros THEN settled_micros - estimated_micros ELSE 0 END), 0) AS max_under_reserve_micros
         FROM decisions
         WHERE upstream_forwarded = 1
           AND estimated_micros IS NOT NULL
           AND settled_micros IS NOT NULL`,
      )
      .get() as unknown as EstimateErrorSummary;
    return {
      samples: Number(row.samples),
      under_reserve: Number(row.under_reserve),
      over_reserve: Number(row.over_reserve),
      exact: Number(row.exact),
      net_error_micros: Number(row.net_error_micros),
      max_under_reserve_micros: Number(row.max_under_reserve_micros),
    };
  }

  topRuns(windowMs: number, limit = 10): Array<{ run_id: string; spent_micros: number }> {
    const since = this.now() - windowMs;
    return this.db
      .prepare(
        `SELECT run_id, SUM(COALESCE(actual_micros, 0)) AS spent_micros
         FROM reservations
         WHERE run_id IS NOT NULL
           AND state IN ('SETTLED', 'DEBIT_RESERVED')
           AND updated_at >= ?
         GROUP BY run_id
         ORDER BY spent_micros DESC
         LIMIT ?`,
      )
      .all(since, limit) as unknown as Array<{ run_id: string; spent_micros: number }>;
  }

  completeIdempotency(key: string, httpStatus: number, body: string): void {
    const stored = body.length > 1_500_000 ? "" : body;
    const status = body.length > 1_500_000 ? 0 : httpStatus;
    this.db
      .prepare(
        `UPDATE idempotency
         SET state = 'completed', http_status = ?, response_body = ?, updated_at = ?
         WHERE idem_key = ?`,
      )
      .run(status === 0 ? null : status, stored || null, this.now(), key);
  }

  rememberTerminal(input: {
    key: string;
    userId: string | null;
    runId: string | null;
    reservationId: string | null;
    httpStatus: number;
    body: string;
  }): void {
    const body = input.body.length > 1_500_000 ? null : input.body;
    this.tx(() => {
      const existing = this.idempotencyRow(input.key);
      if (!existing) {
        this.db
          .prepare(
            `INSERT INTO idempotency(idem_key, user_id, run_id, reservation_id, state, http_status, response_body, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?)`,
          )
          .run(
            input.key,
            input.userId,
            input.runId,
            input.reservationId,
            body ? input.httpStatus : null,
            body,
            this.now(),
            this.now(),
          );
        return;
      }
      // A reservation_id means reserve() already claimed this key. The black curve
      // sleeps outside the lock, so that claim can land during black_delay_ms.
      // Overwriting the row would turn an in-flight hold into a false 402 replay.
      if (existing.reservation_id) return;
      if (existing.state === "pending" || existing.response_body == null) {
        this.db
          .prepare(
            `UPDATE idempotency SET state = 'completed', http_status = ?, response_body = ?, updated_at = ? WHERE idem_key = ?`,
          )
          .run(body ? input.httpStatus : existing.http_status, body ?? existing.response_body, this.now(), input.key);
      }
    });
  }

  private reserveUnlocked(input: ReserveInput): ReserveResult {
    const prepared = this.prepareReserve(input);
    if (prepared.outcome === "done") return prepared.result;
    return this.commitReserve(input, prepared.dayKey, prepared.accounts);
  }

  private prepareReserve(input: ReserveInput): PreparedReserve {
    const done = (result: ReserveResult): PreparedReserve => ({ outcome: "done", result });
    if (input.idempotencyKey) {
      const existing = this.idempotencyRow(input.idempotencyKey);
      if (existing) {
        if ((existing.user_id ?? null) !== input.userId || (existing.run_id ?? null) !== input.runId) {
          return done(denyResult({
            code: "IDEMPOTENCY_MISMATCH",
            httpStatus: 409,
            scope: null,
            remaining_micros: 0,
            requested_micros: input.estimateMicros,
            user_id: input.userId,
            run_id: input.runId,
            message: "Idempotency key was already used for a different user_id or run_id.",
          }));
        }
        if (existing.http_status && existing.response_body) {
          return done({ kind: "replay", httpStatus: existing.http_status, body: existing.response_body });
        }
        const reservation = existing.reservation_id ? this.getReservation(existing.reservation_id) : undefined;
        const open = reservation?.state === "RESERVED" || reservation?.state === "FORWARDED";
        if (open) {
          return done({ kind: "in_flight", reservationId: existing.reservation_id });
        }
        return done(this.sealTerminalReplay(existing.idem_key, input));
      }
    }

    if (this.readControl("global", "global") || (input.runId && this.readControl("run", input.runId))) {
      const runPaused = Boolean(input.runId && this.readControl("run", input.runId));
      return done(denyResult({
        code: "SPEND_PAUSED",
        httpStatus: 402,
        scope: runPaused ? "run" : null,
        remaining_micros: 0,
        requested_micros: input.estimateMicros,
        user_id: input.userId,
        run_id: input.runId,
        message: runPaused
          ? `Spend is paused for run ${input.runId}. Halt; do not open another client.`
          : "Spend is paused for this deploy. Halt; do not open another client.",
      }));
    }

    this.sweepUnlocked();

    if (this.leaseHolder) {
      const lease = this.readWriterLease();
      const now = this.now();
      if (!lease || lease.holder !== this.leaseHolder || lease.until <= now) {
        return done(denyResult({
          code: "WRITER_LEASE_REQUIRED",
          httpStatus: 503,
          scope: null,
          remaining_micros: 0,
          requested_micros: input.estimateMicros,
          user_id: input.userId,
          run_id: input.runId,
          message:
            "This process does not hold the writer lease. One shared store and one process clock are required before a second writer. Fail closed: refusing to forward.",
        }));
      }
    }

    const dayKey = this.utcDay();
    const wanted: Array<{ scope: ScopeName; key: string }> = [];
    const userDefault = this.getDefaultCap("user");
    const runDefault = this.getDefaultCap("run");
    const dayDefault = this.getDefaultCap("day");
    const userConfigured = userDefault != null || (input.userId ? this.account("user", input.userId) != null : false);
    const runConfigured = runDefault != null || (input.runId ? this.account("run", input.runId) != null : false);
    const dayConfigured = dayDefault != null || this.account("day", dayKey) != null;

    if (userConfigured && !input.userId) {
      return done(denyResult({
        code: "IDENTITY_REQUIRED",
        httpStatus: 400,
        scope: "user",
        remaining_micros: 0,
        requested_micros: input.estimateMicros,
        user_id: null,
        run_id: input.runId,
        message: "user scope is configured; send x-burnbrake-user-id from the authenticated caller.",
      }));
    }
    if (runConfigured && !input.runId) {
      return done(denyResult({
        code: "IDENTITY_REQUIRED",
        httpStatus: 400,
        scope: "run",
        remaining_micros: 0,
        requested_micros: input.estimateMicros,
        user_id: input.userId,
        run_id: null,
        message: "run scope is configured; send x-burnbrake-run-id from the authenticated caller.",
      }));
    }
    if (input.userId && userConfigured) wanted.push({ scope: "user", key: input.userId });
    if (input.runId && runConfigured) wanted.push({ scope: "run", key: input.runId });
    if (dayConfigured) wanted.push({ scope: "day", key: dayKey });

    if (this.productionDurableScope && !wanted.some((scope) => scope.scope === "user" || scope.scope === "day")) {
      return done(denyResult({
        code: "PRODUCTION_SCOPE_REQUIRED",
        httpStatus: 503,
        scope: null,
        remaining_micros: 0,
        requested_micros: input.estimateMicros,
        user_id: input.userId,
        run_id: input.runId,
        message:
          "Production requires a user cap and/or a day cap. A run-only budget is washable by rotating x-burnbrake-run-id. Fail closed: refusing to forward.",
      }));
    }

    if (wanted.length === 0) {
      return done(denyResult({
        code: "NO_BUDGET_CONFIGURED",
        httpStatus: 503,
        scope: null,
        remaining_micros: 0,
        requested_micros: input.estimateMicros,
        user_id: input.userId,
        run_id: input.runId,
        message: "No user, run, or day cap is configured. Fail closed: refusing to forward.",
      }));
    }

    const accounts: AccountRow[] = [];
    for (const scope of wanted) {
      const row = this.ensureAccount(scope.scope, scope.key);
      if (!row) {
        return done(denyResult({
          code: "NO_BUDGET_CONFIGURED",
          httpStatus: 503,
          scope: scope.scope,
          remaining_micros: 0,
          requested_micros: input.estimateMicros,
          user_id: input.userId,
          run_id: input.runId,
          message: `No cap for ${scope.scope}. Fail closed.`,
        }));
      }
      accounts.push(row);
    }

    for (const row of accounts) {
      const remaining = row.cap_micros - row.spent_micros - row.held_micros;
      if (remaining < input.estimateMicros) {
        return done(denyResult({
          code: "BUDGET_EXHAUSTED",
          httpStatus: 402,
          scope: row.scope as ScopeName,
          remaining_micros: remaining,
          requested_micros: input.estimateMicros,
          user_id: input.userId,
          run_id: input.runId,
          message: `Budget exhausted for scope ${row.scope}. Halt this spend loop. This is not a rate limit.`,
        }));
      }
    }

    return { outcome: "ready", dayKey, accounts };
  }

  private commitReserve(input: ReserveInput, dayKey: string, accounts: AccountRow[]): ReserveResult {
    const id = randomUUID();
    const now = this.now();
    const scopeNames = accounts.map((a) => a.scope).join(",");
    this.db
      .prepare(
        `INSERT INTO reservations(
          id, idempotency_key, user_id, run_id, day_key, scopes, estimate_micros, state,
          model, route, created_at, updated_at, max_tokens, max_tokens_source, price_table_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'RESERVED', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.idempotencyKey,
        input.userId,
        input.runId,
        dayKey,
        scopeNames,
        input.estimateMicros,
        input.model,
        input.route,
        now,
        now,
        input.maxTokens,
        input.maxTokensSource,
        input.priceTableVersion,
      );
    for (const row of accounts) {
      this.db
        .prepare("UPDATE scope_accounts SET held_micros = held_micros + ? WHERE scope = ? AND scope_key = ?")
        .run(input.estimateMicros, row.scope, row.scope_key);
    }
    if (input.idempotencyKey) {
      this.db
        .prepare(
          `INSERT INTO idempotency(idem_key, user_id, run_id, reservation_id, state, http_status, response_body, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)`,
        )
        .run(input.idempotencyKey, input.userId, input.runId, id, now, now);
    }
    const scopes = accounts.map((row) => {
      const fresh = this.account(row.scope as ScopeName, row.scope_key)!;
      return this.snapshot(fresh);
    });
    return { kind: "reserved", reservationId: id, scopes };
  }

  /** Terminal reservation (or a completed key with no stored body) must not reserve again. */
  private sealTerminalReplay(idemKey: string, input: ReserveInput): ReserveResult {
    const body = JSON.stringify({
      error: {
        code: "ALREADY_TERMINAL",
        message: "This idempotency key already reached a terminal reservation. Do not start a second forward.",
        scope: null,
        remaining_micros: null,
        requested_micros: input.estimateMicros,
        run_id: input.runId,
        user_id: input.userId,
        halt: false,
        retryable: false,
      },
    });
    this.db
      .prepare(
        `UPDATE idempotency SET state = 'completed', http_status = ?, response_body = ?, updated_at = ? WHERE idem_key = ?`,
      )
      .run(409, body, this.now(), idemKey);
    return { kind: "replay", httpStatus: 409, body };
  }

  private sweepUnlocked(): { released: number; debited: number } {
    const cutoff = this.now() - this.ttlMs;
    const rows = this.db
      .prepare(
        `SELECT * FROM reservations WHERE state IN ('RESERVED', 'FORWARDED') AND created_at <= ?`,
      )
      .all(cutoff) as unknown as ReservationRow[];
    let released = 0;
    let debited = 0;
    for (const row of rows) {
      if (row.state === "RESERVED") {
        this.releaseHold(row);
        this.db
          .prepare(
            "UPDATE reservations SET state = 'RELEASED', terminal_reason = 'RELEASE_PRE_FORWARD', updated_at = ? WHERE id = ?",
          )
          .run(this.now(), row.id);
        released += 1;
      } else if (row.state === "FORWARDED") {
        this.releaseHold(row);
        this.addSpent(row, row.estimate_micros);
        this.db
          .prepare(
            "UPDATE reservations SET state = 'DEBIT_RESERVED', terminal_reason = 'DEBIT_TTL_OR_CRASH', actual_micros = ?, updated_at = ? WHERE id = ?",
          )
          .run(row.estimate_micros, this.now(), row.id);
        debited += 1;
      }
    }
    const bodyCutoff = this.now() - IDEMPOTENCY_BODY_TTL_MS;
    this.db
      .prepare(
        `UPDATE idempotency
         SET response_body = NULL, http_status = NULL
         WHERE state = 'completed' AND response_body IS NOT NULL AND updated_at <= ?`,
      )
      .run(bodyCutoff);
    return { released, debited };
  }

  private releaseHold(row: ReservationRow): void {
    for (const scope of heldScopes(row)) {
      const updated = this.db
        .prepare(
          `UPDATE scope_accounts
           SET held_micros = held_micros - ?
           WHERE scope = ? AND scope_key = ? AND held_micros >= ?`,
        )
        .run(row.estimate_micros, scope.scope, scope.key, row.estimate_micros);
      if (updated.changes !== 1) {
        throw new Error(`ledger hold integrity failure for ${scope.scope}:${scope.key}`);
      }
    }
  }

  private addSpent(row: ReservationRow, delta: number): void {
    for (const scope of heldScopes(row)) {
      this.db
        .prepare(
          "UPDATE scope_accounts SET spent_micros = spent_micros + ? WHERE scope = ? AND scope_key = ?",
        )
        .run(delta, scope.scope, scope.key);
    }
  }

  private addOvershoot(row: ReservationRow, overshoot: number): void {
    for (const scope of heldScopes(row)) {
      this.db
        .prepare(
          "UPDATE scope_accounts SET overshoot_micros = overshoot_micros + ? WHERE scope = ? AND scope_key = ?",
        )
        .run(overshoot, scope.scope, scope.key);
    }
  }

  private ensureAccount(scope: ScopeName, key: string): AccountRow | null {
    const existing = this.account(scope, key);
    if (existing) return existing;
    const cap = this.getDefaultCap(scope);
    if (cap == null) return null;
    this.db
      .prepare(
        `INSERT INTO scope_accounts(scope, scope_key, cap_micros, spent_micros, held_micros, overshoot_micros)
         VALUES (?, ?, ?, 0, 0, 0)`,
      )
      .run(scope, key, cap);
    return this.account(scope, key) ?? null;
  }

  private account(scope: string, key: string): AccountRow | null {
    return (
      (this.db.prepare("SELECT * FROM scope_accounts WHERE scope = ? AND scope_key = ?").get(scope, key) as
        | AccountRow
        | undefined) ?? null
    );
  }

  private snapshot(row: AccountRow): ScopeSnapshot {
    const remaining = row.cap_micros - row.spent_micros - row.held_micros;
    return {
      scope: row.scope as ScopeName,
      key: row.scope_key,
      cap_micros: row.cap_micros,
      spent_micros: row.spent_micros,
      held_micros: row.held_micros,
      remaining_micros: remaining,
      debt_micros: Math.max(0, row.spent_micros + row.held_micros - row.cap_micros),
      overshoot_micros: row.overshoot_micros,
    };
  }

  private activeCount(scope: ScopeName, key: string): number {
    const column = scope === "user" ? "user_id" : scope === "run" ? "run_id" : "day_key";
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM reservations
         WHERE state IN ('RESERVED', 'FORWARDED') AND ${column} = ? AND (',' || scopes || ',') LIKE ?`,
      )
      .get(key, `%,${scope},%`) as { n: number };
    return Number(row.n);
  }

  private scopeConfigured(scope: ScopeName): boolean {
    if (this.getDefaultCap(scope) != null) return true;
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM scope_accounts WHERE scope = ?")
      .get(scope) as { n: number };
    return Number(row.n) > 0;
  }

  private mustReservation(id: string): ReservationRow {
    const row = this.getReservation(id);
    if (!row) throw new Error(`unknown reservation ${id}`);
    return row;
  }

  private idempotencyRow(key: string): {
    idem_key: string;
    user_id: string | null;
    run_id: string | null;
    reservation_id: string | null;
    state: string;
    http_status: number | null;
    response_body: string | null;
  } | null {
    return (
      (this.db.prepare("SELECT * FROM idempotency WHERE idem_key = ?").get(key) as
        | {
            idem_key: string;
            user_id: string | null;
            run_id: string | null;
            reservation_id: string | null;
            state: string;
            http_status: number | null;
            response_body: string | null;
          }
        | undefined) ?? null
    );
  }

  private readWriterLease(): WriterLeaseRow | null {
    const row = this.db.prepare("SELECT v FROM meta WHERE k = 'writer_lease'").get() as { v: string } | undefined;
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.v) as { holder?: unknown; until?: unknown };
      if (typeof parsed.holder !== "string" || typeof parsed.until !== "number") return null;
      return { holder: parsed.holder, until: parsed.until };
    } catch {
      return null;
    }
  }

  private setControl(kind: string, key: string, paused: boolean): void {
    this.db
      .prepare(
        `INSERT INTO controls(kind, ctrl_key, paused, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(kind, ctrl_key) DO UPDATE SET paused = excluded.paused, updated_at = excluded.updated_at`,
      )
      .run(kind, key, paused ? 1 : 0, this.now());
  }

  private readControl(kind: string, key: string): boolean {
    const row = this.db
      .prepare("SELECT paused FROM controls WHERE kind = ? AND ctrl_key = ?")
      .get(kind, key) as { paused: number } | undefined;
    return Boolean(row && row.paused);
  }

  private tx<T>(fn: () => T): T {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        this.db.exec("BEGIN IMMEDIATE");
      } catch (err) {
        if (isBusy(err) && attempt < 4) continue;
        throw err;
      }
      try {
        const value = fn();
        this.db.exec("COMMIT");
        return value;
      } catch (err) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
          /* already closed */
        }
        if (isBusy(err) && attempt < 4) continue;
        throw err;
      }
    }
    throw new Error("ledger lock timeout");
  }
}

function heldScopes(row: ReservationRow): Array<{ scope: ScopeName; key: string }> {
  const names = row.scopes.split(",").filter(Boolean);
  const out: Array<{ scope: ScopeName; key: string }> = [];
  for (const name of names) {
    if (name === "user" && row.user_id) out.push({ scope: "user", key: row.user_id });
    else if (name === "run" && row.run_id) out.push({ scope: "run", key: row.run_id });
    else if (name === "day" && row.day_key) out.push({ scope: "day", key: row.day_key });
    else throw new Error(`reservation ${row.id} has an unusable scope binding: ${name}`);
  }
  return out;
}

function defaultMetaKey(scope: ScopeName): string {
  return `default_cap_${scope}`;
}

function assertMicros(micros: number, label: string): void {
  if (!Number.isSafeInteger(micros) || micros < 0) {
    throw new Error(`${label} must be a non-negative integer number of micros`);
  }
}

function denyResult(fields: Omit<Extract<ReserveResult, { kind: "deny" }>, "kind">): ReserveResult {
  return { kind: "deny", ...fields };
}

function restrictLedgerPermissions(path: string): void {
  if (!path || path === ":memory:") return;
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
    try {
      chmodSync(candidate, 0o600);
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
      if (code === "ENOENT") continue;
      throw new Error(`Could not restrict permissions on the ledger file. Refusing to start.`);
    }
  }
}

function isBusy(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { errcode?: number; code?: string }).errcode;
  const message = String((err as { message?: string }).message ?? "");
  return code === 5 || code === 6 || /database is locked|SQLITE_BUSY/i.test(message);
}

export function decisionsToCsv(rows: DecisionRow[]): string {
  const headers = [
    "id",
    "ts",
    "user_id",
    "run_id",
    "decision",
    "code",
    "scope",
    "requested_micros",
    "remaining_after_micros",
    "debt_delta_micros",
    "model",
    "route",
    "latency_ms",
    "idempotency_key",
    "price_table_version",
    "upstream_forwarded",
    "reservation_id",
    "estimated_micros",
    "settled_micros",
    "terminal_reason",
    "max_tokens_source",
  ] as const;
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvCell(row[h])).join(","));
  }
  return lines.join("\n") + "\n";
}

function csvCell(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}
