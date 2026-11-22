-- CivicWatch PostgreSQL Database Schema

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  gender VARCHAR(40) NOT NULL,
  mobile VARCHAR(15) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  state VARCHAR(100) DEFAULT 'Maharashtra',
  city VARCHAR(100) DEFAULT 'Mumbai',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  admin_level VARCHAR(30) NOT NULL DEFAULT 'CITY'
    CHECK (admin_level IN ('NATIONAL', 'STATE', 'DISTRICT', 'CITY', 'BLOCK')),
  state VARCHAR(100),
  district VARCHAR(100),
  city VARCHAR(100),
  block VARCHAR(100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS issues (
  id SERIAL PRIMARY KEY,
  tracking_id VARCHAR(20) UNIQUE NOT NULL,
  title VARCHAR(200) NOT NULL,
  category VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  department VARCHAR(120) NOT NULL DEFAULT 'Municipal Corporation',
  photo_url TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'In Progress', 'Resolved')),
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  state VARCHAR(100) DEFAULT 'Maharashtra',
  district VARCHAR(100) DEFAULT 'Mumbai Suburban',
  city VARCHAR(100) DEFAULT 'Mumbai',
  block VARCHAR(100) DEFAULT 'Powai',
  pincode VARCHAR(10),
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Upgrade existing columns if tables already existed
ALTER TABLE users ADD COLUMN IF NOT EXISTS state VARCHAR(100) DEFAULT 'Maharashtra';
ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(100) DEFAULT 'Mumbai';

ALTER TABLE admins ADD COLUMN IF NOT EXISTS admin_level VARCHAR(30) DEFAULT 'CITY';
ALTER TABLE admins ADD COLUMN IF NOT EXISTS state VARCHAR(100);
ALTER TABLE admins ADD COLUMN IF NOT EXISTS district VARCHAR(100);
ALTER TABLE admins ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE admins ADD COLUMN IF NOT EXISTS block VARCHAR(100);
ALTER TABLE admins ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

ALTER TABLE issues ADD COLUMN IF NOT EXISTS title VARCHAR(200);
ALTER TABLE issues ADD COLUMN IF NOT EXISTS category VARCHAR(100);
ALTER TABLE issues ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS state VARCHAR(100) DEFAULT 'Maharashtra';
ALTER TABLE issues ADD COLUMN IF NOT EXISTS district VARCHAR(100) DEFAULT 'Mumbai Suburban';
ALTER TABLE issues ADD COLUMN IF NOT EXISTS city VARCHAR(100) DEFAULT 'Mumbai';
ALTER TABLE issues ADD COLUMN IF NOT EXISTS block VARCHAR(100) DEFAULT 'Powai';
ALTER TABLE issues ADD COLUMN IF NOT EXISTS pincode VARCHAR(10);
ALTER TABLE issues ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT FALSE;

-- Demo issues for testing
INSERT INTO issues (tracking_id, title, category, description, department, status, latitude, longitude, state, district, city, block)
VALUES
('CW-DEMO01', 'Pothole near main road', 'Road', 'Pothole reported near the main road', 'Public Works Department (PWD)', 'Pending', 19.0760000, 72.8777000, 'Maharashtra', 'Mumbai Suburban', 'Mumbai', 'Powai'),
('CW-DEMO02', 'Garbage collection delayed', 'Garbage', 'Garbage collection is delayed in the residential lane', 'Sanitation and Waste Management', 'In Progress', 19.0900000, 72.8650000, 'Maharashtra', 'Mumbai Suburban', 'Mumbai', 'Powai'),
('CW-DEMO03', 'Streetlight not working', 'Streetlight', 'Streetlight fixture blinking and off for 3 days', 'Street Lighting Department', 'Resolved', 19.1170000, 72.9050000, 'Maharashtra', 'Mumbai Suburban', 'Mumbai', 'Powai')
ON CONFLICT (tracking_id) DO NOTHING;
