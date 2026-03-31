-- Grocery habits: tracks recurring grocery purchases per user
CREATE TABLE IF NOT EXISTS grocery_habits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  item_name VARCHAR(200) NOT NULL,
  preferred_brand VARCHAR(100),
  preferred_store VARCHAR(100) NOT NULL,
  avg_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  purchase_count INT NOT NULL DEFAULT 1,
  purchase_frequency_days INT, -- computed after 3+ purchases
  last_purchased_at TIMESTAMP NOT NULL DEFAULT NOW(),
  quantity_usual INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, item_name)
);

CREATE INDEX IF NOT EXISTS idx_grocery_habits_user ON grocery_habits(user_id);
CREATE INDEX IF NOT EXISTS idx_grocery_habits_last ON grocery_habits(user_id, last_purchased_at DESC);
