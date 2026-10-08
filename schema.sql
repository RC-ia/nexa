-- NEXA — schema do D1 (memória persistente)
-- Aplicar com: wrangler d1 execute <DB_NAME> --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  memory TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_memories_user_id
  ON memories (user_id, id DESC);
