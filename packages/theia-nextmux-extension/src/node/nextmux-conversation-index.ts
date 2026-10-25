import { conversationAttention } from '../common/nextmux-conversation-attention';
import { DatabaseSync } from 'node:sqlite';
import type { DesktopConversationIndexRecord, DesktopConversationProjectSummary, DesktopConversationSearchRequest } from '../common/nextmux-platform-protocol';
import { conversationHistorySearchRecords, conversationMessageSearchTexts } from './nextmux-conversation-search';

/** Rebuildable local index. JSON payloads and their committed manifest remain authoritative. */
export class ConversationIndex {
    private readonly db: DatabaseSync;
    readonly #setMetadataStmt: ReturnType<DatabaseSync['prepare']>;
    readonly #insertSessionStmt: ReturnType<DatabaseSync['prepare']>;
    readonly #insertSearchStmt: ReturnType<DatabaseSync['prepare']>;
    readonly #removeSearchStmt: ReturnType<DatabaseSync['prepare']>;
    readonly #removeSessionStmt: ReturnType<DatabaseSync['prepare']>;

    constructor(path: string) {
        this.db = new DatabaseSync(path);
        try { this.db.exec(`
            PRAGMA busy_timeout = 5000;
            -- This database is a rebuildable projection; WAL keeps readers
            -- available while the writer batches index updates, and NORMAL
            -- avoids a full fsync on every derived-index checkpoint. The
            -- authoritative conversation JSON remains FULL/fsynced by the
            -- conversation store before its manifest is published.
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA secure_delete = ON;
            CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY, workspace_path TEXT NOT NULL, updated_at INTEGER NOT NULL,
                summary TEXT NOT NULL, search_record TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS sessions_project_order ON sessions(workspace_path, updated_at DESC, id);
            CREATE INDEX IF NOT EXISTS sessions_order ON sessions(updated_at DESC, id);
            CREATE INDEX IF NOT EXISTS sessions_pinned_order
                ON sessions((CASE WHEN json_extract(summary, '$.pinned') = 1 THEN 1 ELSE 0 END), updated_at DESC, id);
            CREATE VIRTUAL TABLE IF NOT EXISTS search_text USING fts5(id UNINDEXED, text, tokenize='trigram');
        `);
            if (!this.db.prepare("SELECT value FROM metadata WHERE key = 'secure_delete'").get()) {
                this.db.exec("INSERT INTO search_text(search_text, rank) VALUES('secure-delete', 1); INSERT INTO metadata(key, value) VALUES('secure_delete', '1');");
            }
            this.#setMetadataStmt = this.db.prepare('INSERT OR REPLACE INTO metadata(key, value) VALUES (?, ?)');
            this.#insertSessionStmt = this.db.prepare('INSERT INTO sessions(id, workspace_path, updated_at, summary, search_record) VALUES (?, ?, ?, ?, ?)');
            this.#insertSearchStmt = this.db.prepare('INSERT INTO search_text(rowid, id, text) VALUES (?, ?, ?)');
            this.#removeSearchStmt = this.db.prepare('DELETE FROM search_text WHERE rowid = (SELECT rowid FROM sessions WHERE id = ?)');
            this.#removeSessionStmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
        } catch (error) { this.db.close(); throw error; }
    }

    #closed = false;

    close(): void { if (this.#closed) return; this.#closed = true; this.db.close(); }

    generation(): string | undefined {
        // Older projections omitted runtime message provenance, pending questions and user-only branches.
        // Rebuild the derived summaries once; authoritative bodies are retained.
        if ((this.db.prepare("SELECT value FROM metadata WHERE key = 'summary_version'").get() as { value: string } | undefined)?.value !== '3') return undefined;
        // Independently invalidate pre-activity indexes without changing summary contracts.
        if ((this.db.prepare("SELECT value FROM metadata WHERE key = 'activity_search_version'").get() as { value: string } | undefined)?.value !== '1') return undefined;
        return (this.db.prepare("SELECT value FROM metadata WHERE key = 'generation'").get() as { value: string } | undefined)?.value;
    }

    status(): 'ok' | 'partial' {
        return (this.db.prepare("SELECT value FROM metadata WHERE key = 'status'").get() as { value: string } | undefined)?.value === 'partial' ? 'partial' : 'ok';
    }

    begin(rebuild = false): void {
        this.db.exec('BEGIN IMMEDIATE');
        if (rebuild) this.db.exec('DELETE FROM sessions; DELETE FROM search_text; DELETE FROM metadata;');
    }

    commit(generation: string, status: 'ok' | 'partial' = 'ok'): void {
        this.#setMetadataStmt.run('generation', generation);
        this.#setMetadataStmt.run('summary_version', '3');
        this.#setMetadataStmt.run('activity_search_version', '1');
        this.#setMetadataStmt.run('status', status);
        this.db.exec('COMMIT');
    }

    rollback(): void { this.db.exec('ROLLBACK'); }

    upsert(session: Record<string, unknown>): void {
        const record = conversationHistorySearchRecords([session])[0];
        if (!record) return;
        // Never expose empty placeholder turns as an editable complete conversation.
        const { turns: _turns, ...header } = session;
        const turns = Array.isArray(session.turns) ? session.turns : [];
        const latest = turns[turns.length - 1];
        const summary = { ...header, turns: [], historyLoaded: false, turnCount: turns.length,
            ...(latest && typeof latest === 'object' ? { latestTurn: {
                id: latest.id, stage: latest.stage, createdAt: latest.createdAt, completedAt: latest.completedAt, branchUserOnly: latest.branchUserOnly,
                attention: conversationAttention(record.id, latest)
            } } : {}) };
        const searchable = [record.id, record.sourceConversationId, record.sourceMessageId, record.title, record.workspacePath,
            ...record.messages.flatMap(message => [message.id, message.turnId, ...conversationMessageSearchTexts(message)])]
            .join('\n').toLocaleLowerCase();
        this.remove(record.id);
        const inserted = this.#insertSessionStmt.run(record.id, record.workspacePath, record.updatedAt, JSON.stringify(summary), JSON.stringify(record));
        this.#insertSearchStmt.run(inserted.lastInsertRowid, record.id, searchable);
    }

    remove(id: string): void {
        this.#removeSearchStmt.run(id);
        this.#removeSessionStmt.run(id);
    }

    list(options: { workspacePath?: string; pinned?: boolean; limit: number; after?: { updatedAt: number; id: string } }): {
        sessions: readonly Record<string, unknown>[]; total: number; hasMore: boolean
    } {
        const where: string[] = [];
        const params: (string | number)[] = [];
        if (options.workspacePath !== undefined) { where.push('workspace_path = ?'); params.push(options.workspacePath); }
        if (options.pinned !== undefined) {
            where.push("(CASE WHEN json_extract(summary, '$.pinned') = 1 THEN 1 ELSE 0 END) = ?");
            params.push(options.pinned ? 1 : 0);
        }
        const total = (this.db.prepare(`SELECT count(*) AS total FROM sessions ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`)
            .get(...params) as { total: number }).total;
        if (options.after) {
            where.push('(updated_at < ? OR (updated_at = ? AND id > ?))');
            params.push(options.after.updatedAt, options.after.updatedAt, options.after.id);
        }
        const rows = this.db.prepare(`SELECT summary FROM sessions ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY updated_at DESC, id LIMIT ?`).all(...params, options.limit + 1) as { summary: string }[];
        return { sessions: rows.slice(0, options.limit).map(row => JSON.parse(row.summary)), total, hasMore: rows.length > options.limit };
    }

    /** Discover projects independently from the newest conversation page, using derived metadata only. */
    projects(options: { limit: number; after?: { latestUpdatedAt: number; workspacePath: string } }): {
        projects: readonly DesktopConversationProjectSummary[]; total: number; hasMore: boolean
    } {
        const total = (this.db.prepare("SELECT count(DISTINCT workspace_path) AS total FROM sessions WHERE workspace_path <> ''")
            .get() as { total: number }).total;
        const params: (string | number)[] = [];
        const having = options.after
            ? 'HAVING max(updated_at) < ? OR (max(updated_at) = ? AND workspace_path > ?)'
            : '';
        if (options.after) params.push(options.after.latestUpdatedAt, options.after.latestUpdatedAt, options.after.workspacePath);
        const rows = this.db.prepare(`SELECT workspace_path AS workspacePath, count(*) AS conversationCount,
            max(updated_at) AS latestUpdatedAt FROM sessions WHERE workspace_path <> ''
            GROUP BY workspace_path ${having} ORDER BY latestUpdatedAt DESC, workspace_path LIMIT ?`)
            .all(...params, options.limit + 1) as unknown as DesktopConversationProjectSummary[];
        return { projects: rows.slice(0, options.limit).map(row => ({
            workspacePath: row.workspacePath, conversationCount: row.conversationCount, latestUpdatedAt: row.latestUpdatedAt
        })), total, hasMore: rows.length > options.limit };
    }

    /** Candidate records only; final matching retains the established message/snippet semantics. */
    searchRecords(request: DesktopConversationSearchRequest, limit = 100, offset = 0): readonly DesktopConversationIndexRecord[] {
        let query = String(request.query || '').trim().toLocaleLowerCase();
        let conversationId = String(request.conversationId || '').trim().toLocaleLowerCase();
        let messageId = String(request.messageId || '').trim().toLocaleLowerCase();
        const locator = /^nextmux:\/\/conversation\/([^/\s]+)\/message\/([^/\s]+)$/i.exec(query);
        if (locator) {
            try { conversationId = decodeURIComponent(locator[1]).toLocaleLowerCase(); messageId = decodeURIComponent(locator[2]).toLocaleLowerCase(); query = ''; }
            catch { return []; }
        }
        const where: string[] = [];
        const params: (string | number)[] = [];
        if (conversationId) { where.push('lower(s.id) = ?'); params.push(conversationId); }
        const terms = [...query.split(/\s+/).filter(Boolean), ...(messageId ? [messageId] : [])];
        // FTS5 trigram accelerates normal substring searches. Keep short terms
        // and explicit wildcard terms on the indexed text column because a
        // trigram query cannot represent them without changing semantics.
        const ftsTerms: string[] = [];
        for (const term of terms) {
            if (/[\%_]/.test(term) || [...term].length < 3) {
                where.push('instr(f.text, ?) > 0'); params.push(term);
            } else {
                // MATCH is still parameterized. Doubling quotes creates one
                // FTS5 phrase and prevents user input from changing the query.
                ftsTerms.push(`"${term.replaceAll('"', '""')}"`);
            }
        }
        // SQLite resolves MATCH against the virtual table name, not its JOIN
        // alias (`f` would be parsed as a column name).
        if (ftsTerms.length) { where.push('search_text MATCH ?'); params.push(ftsTerms.join(' AND ')); }
        const rows = this.db.prepare(`SELECT s.search_record FROM sessions s ${terms.length ? 'JOIN search_text f ON f.rowid = s.rowid' : ''}
            ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.updated_at DESC, s.id LIMIT ? OFFSET ?`)
            .all(...params, limit, offset) as { search_record: string }[];
        return rows.map(row => JSON.parse(row.search_record));
    }
}
