import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PaymentRequirements, SettleResponse } from "@x402/core/types";

export type StoredQuote = {
  id: string;
  resource: string;
  requirements: PaymentRequirements;
  expiresAt: number;
};

export type StoredSettlement = {
  messageHash: string;
  quoteId: string;
  payloadHash: string;
  status: "UNKNOWN" | "CONFIRMED" | "FAILED";
  receipt?: SettleResponse;
  body?: string;
};

/** Durable single-writer claim: a crash can leave UNKNOWN, never permission to pay again. */
export class SettlementStore {
  private readonly db: DatabaseSync;

  constructor(path = process.env.DAY4_SETTLEMENT_DB ?? ".data/day4-payments.sqlite") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS day4_quotes (
        id TEXT PRIMARY KEY,
        resource TEXT NOT NULL,
        requirements TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS day4_settlements (
        message_hash TEXT PRIMARY KEY,
        quote_id TEXT NOT NULL UNIQUE,
        payload_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('UNKNOWN', 'CONFIRMED', 'FAILED')),
        receipt TEXT,
        body TEXT
      );
    `);
  }

  saveQuote(quote: StoredQuote) {
    this.db.prepare(`INSERT INTO day4_quotes VALUES (?, ?, ?, ?)`).run(
      quote.id, quote.resource, JSON.stringify(quote.requirements), quote.expiresAt,
    );
  }

  getQuote(id: string): StoredQuote | undefined {
    const row = this.db.prepare(`SELECT * FROM day4_quotes WHERE id = ?`).get(id);
    if (!row) return undefined;
    return {
      id: String(row.id), resource: String(row.resource),
      requirements: JSON.parse(String(row.requirements)), expiresAt: Number(row.expires_at),
    };
  }

  get(messageHash: string): StoredSettlement | undefined {
    return this.readRow(this.db.prepare(`SELECT * FROM day4_settlements WHERE message_hash = ?`).get(messageHash));
  }

  getByQuote(quoteId: string): StoredSettlement | undefined {
    return this.readRow(this.db.prepare(`SELECT * FROM day4_settlements WHERE quote_id = ?`).get(quoteId));
  }

  /** Only the caller that inserted the claim is allowed to call /settle. */
  claim(messageHash: string, quoteId: string, payloadHash: string): boolean {
    return this.db.prepare(`
      INSERT OR IGNORE INTO day4_settlements (message_hash, quote_id, payload_hash, status)
      VALUES (?, ?, ?, 'UNKNOWN')
    `).run(messageHash, quoteId, payloadHash).changes === 1;
  }

  confirm(messageHash: string, receipt: SettleResponse, body: string) {
    this.db.prepare(`UPDATE day4_settlements SET status = 'CONFIRMED', receipt = ?, body = ? WHERE message_hash = ? AND status = 'UNKNOWN'`)
      .run(JSON.stringify(receipt), body, messageHash);
  }

  fail(messageHash: string, receipt: SettleResponse) {
    this.db.prepare(`UPDATE day4_settlements SET status = 'FAILED', receipt = ? WHERE message_hash = ? AND status = 'UNKNOWN'`)
      .run(JSON.stringify(receipt), messageHash);
  }

  pending(messageHash: string, receipt: SettleResponse) {
    this.db.prepare(`UPDATE day4_settlements SET receipt = ? WHERE message_hash = ? AND status = 'UNKNOWN'`)
      .run(JSON.stringify(receipt), messageHash);
  }

  close() { this.db.close(); }

  private readRow(row: Record<string, unknown> | undefined): StoredSettlement | undefined {
    if (!row) return undefined;
    return {
      messageHash: String(row.message_hash), quoteId: String(row.quote_id),
      payloadHash: String(row.payload_hash), status: row.status as StoredSettlement["status"],
      ...(row.receipt ? { receipt: JSON.parse(String(row.receipt)) } : {}),
      ...(row.body ? { body: String(row.body) } : {}),
    };
  }
}
