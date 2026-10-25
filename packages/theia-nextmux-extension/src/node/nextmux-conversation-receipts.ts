import { ConversationDomainError } from '../common/nextmux-conversation-domain-errors';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { validConversationReceipt, type ConversationReadReceipt } from '../common/nextmux-conversation-attention';

/** Tiny durable metadata, separate from the rebuildable search index and large conversation bodies. */
export class ConversationReceiptStore {
    constructor(private readonly path: string) {}

    private withDatabase<T>(action: (db: DatabaseSync) => T): T {
        mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
        const db = new DatabaseSync(this.path);
        try {
            db.exec(`PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
                CREATE TABLE IF NOT EXISTS receipts(session_id TEXT NOT NULL, notice_id TEXT NOT NULL,
                    noticed_at INTEGER NOT NULL, read_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(session_id,notice_id));`);
            const columns = () => db.prepare('PRAGMA table_info(receipts)').all() as Array<{ name: string; pk: number }>;
            if (!columns().some(column => column.name === 'notice_id' && column.pk === 2)) {
                // Recheck after taking the write lock: another window may have
                // migrated the legacy one-row-per-conversation table meanwhile.
                db.exec('BEGIN IMMEDIATE');
                try {
                    const current = columns();
                    if (!current.some(column => column.name === 'notice_id' && column.pk === 2)) {
                        const readAt = current.some(column => column.name === 'read_at') ? 'read_at' : '0';
                        db.exec(`CREATE TABLE receipts_event_migration(session_id TEXT NOT NULL, notice_id TEXT NOT NULL,
                            noticed_at INTEGER NOT NULL, read_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(session_id,notice_id));
                            INSERT INTO receipts_event_migration SELECT session_id,notice_id,noticed_at,${readAt} FROM receipts;
                            DROP TABLE receipts;
                            ALTER TABLE receipts_event_migration RENAME TO receipts;`);
                    }
                    db.exec('COMMIT');
                } catch (error) { db.exec('ROLLBACK'); throw error; }
            }
            db.exec('CREATE INDEX IF NOT EXISTS receipts_session_notice_time ON receipts(session_id,noticed_at DESC)');
            return action(db);
        } finally { db.close(); }
    }

    read(ids: readonly string[], noticeIds?: readonly string[]): readonly ConversationReadReceipt[] {
        if (!Array.isArray(ids) || ids.length > 500 || ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,300}$/.test(id))) {
            throw new ConversationDomainError('CONVERSATION_RECEIPT_INVALID', 'receipt_query_invalid');
        }
        if (noticeIds !== undefined && (!Array.isArray(noticeIds) || noticeIds.length !== ids.length
            || noticeIds.some((noticeId, index) => !validConversationReceipt({ sessionId: ids[index], noticeId, noticedAt: 0 })))) {
            throw new ConversationDomainError('CONVERSATION_RECEIPT_INVALID', 'receipt_notice_invalid');
        }
        if (!ids.length) return [];
        // Sidebar requests pair each conversation with its visible notice.
        // This indexed lookup stays bounded even for very long conversations.
        // The optional form keeps legacy callers compatible without claiming
        // that a receipt for a newer timestamp acknowledges older events.
        const where = noticeIds
            ? `(session_id,notice_id) IN (VALUES ${ids.map(() => '(?,?)').join(',')})`
            : `session_id IN (${ids.map(() => '?').join(',')})`;
        const values = noticeIds ? ids.flatMap((id, index) => [id, noticeIds[index]]) : ids;
        return this.withDatabase(db => db.prepare(`SELECT session_id AS sessionId, notice_id AS noticeId,
            noticed_at AS noticedAt, NULLIF(read_at,0) AS readAt FROM receipts WHERE ${where}
            ORDER BY noticed_at DESC,read_at DESC,notice_id`).all(...values) as unknown as ConversationReadReceipt[]);
    }

    mark(receipt: ConversationReadReceipt): ConversationReadReceipt {
        if (!validConversationReceipt(receipt)) throw new ConversationDomainError('CONVERSATION_RECEIPT_INVALID', 'receipt_invalid');
        return this.withDatabase(db => {
            // An acknowledgement belongs to its event. A delayed write for A
            // cannot replace B, even when both events share a timestamp.
            db.prepare(`INSERT INTO receipts(session_id,notice_id,noticed_at,read_at) VALUES(?,?,?,?)
                ON CONFLICT(session_id,notice_id) DO UPDATE SET
                    noticed_at=MAX(receipts.noticed_at,excluded.noticed_at),
                    read_at=MAX(receipts.read_at,excluded.read_at)`)
                .run(receipt.sessionId,receipt.noticeId,receipt.noticedAt,receipt.readAt ?? Date.now());
            return db.prepare('SELECT session_id AS sessionId,notice_id AS noticeId,noticed_at AS noticedAt, NULLIF(read_at,0) AS readAt FROM receipts WHERE session_id=? AND notice_id=?')
                .get(receipt.sessionId,receipt.noticeId) as unknown as ConversationReadReceipt;
        });
    }

    forget(ids?: readonly string[]): void {
        this.withDatabase(db => {
            if (!ids) { db.exec('DELETE FROM receipts'); return; }
            const remove = db.prepare('DELETE FROM receipts WHERE session_id=?');
            db.exec('BEGIN');
            try { for (const id of ids) remove.run(id); db.exec('COMMIT'); }
            catch (error) { db.exec('ROLLBACK'); throw error; }
        });
    }
}
