import os
import bcrypt
import psycopg2
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://shivamprabhu@localhost:5432/civicwatch")

def create_admin():
    name = (os.getenv("NEW_ADMIN_NAME") or "Municipal Admin").strip()
    email = (os.getenv("NEW_ADMIN_EMAIL") or "admin@civicwatch.gov.in").strip().lower()
    password = os.getenv("NEW_ADMIN_PASSWORD") or "Admin@Civic2026!"

    if len(password) < 12:
        raise ValueError("Admin password must be at least 12 characters")

    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(12)).decode("utf-8")

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO admins (name, email, password_hash, admin_level, state, district, city, block)
        VALUES (%s, %s, %s, 'NATIONAL', 'Maharashtra', 'Mumbai Suburban', 'Mumbai', 'Powai')
        ON CONFLICT (email) DO NOTHING
        RETURNING id, name, email
    """, (name, email, password_hash))

    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()

    if row:
        print(f"✓ Admin created: {row[2]} (ID: {row[0]})")
    else:
        print(f"Admin email {email} already exists")

if __name__ == "__main__":
    create_admin()
