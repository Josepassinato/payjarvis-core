-- Shopping Lists (Planner de Compras Inteligente)
CREATE TABLE IF NOT EXISTS shopping_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  title VARCHAR(200) NOT NULL DEFAULT 'Shopping List',
  theme VARCHAR(100),
  location VARCHAR(200),
  items JSONB NOT NULL DEFAULT '[]',
  total_estimated DECIMAL(10,2),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  shared_with JSONB DEFAULT '[]',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shopping_lists_user ON shopping_lists(user_id);
CREATE INDEX IF NOT EXISTS idx_shopping_lists_user_status ON shopping_lists(user_id, status);
