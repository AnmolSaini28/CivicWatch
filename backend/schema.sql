CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  gender VARCHAR(40) NOT NULL,
  mobile VARCHAR(15) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS issues (
  id SERIAL PRIMARY KEY,
  tracking_id VARCHAR(20) UNIQUE NOT NULL,
  category VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  department VARCHAR(120) NOT NULL DEFAULT 'Municipal Corporation',
  status VARCHAR(30) NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'In Progress', 'Resolved')),
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO issues (tracking_id, category, description, department, status, latitude, longitude)
VALUES
('CW-DEMO01', 'Road', 'Pothole reported near the main road', 'Roads Department', 'Pending', 19.0760000, 72.8777000),
('CW-DEMO02', 'Garbage', 'Garbage collection is delayed', 'Sanitation Department', 'In Progress', 19.0900000, 72.8650000)
ON CONFLICT (tracking_id) DO NOTHING;
