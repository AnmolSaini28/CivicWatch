import os
import re
import math
import random
import string
import datetime
import threading
from decimal import Decimal
from functools import wraps

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask.json.provider import DefaultJSONProvider
from dotenv import load_dotenv
import psycopg2
import psycopg2.extras
import psycopg2.pool
import bcrypt
import jwt

dotenv_path = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(dotenv_path)

PORT = int(os.getenv("PORT", 5001))
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://shivamprabhu@localhost:5432/civicwatch")
JWT_SECRET = os.getenv("JWT_SECRET", "3f9c41256a578020d58e8d6a8304f4e10fe027430fdb1a6c038d2304fd79fc0b")

UPLOAD_DIRECTORY = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIRECTORY, exist_ok=True)

class CustomJSONProvider(DefaultJSONProvider):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        if isinstance(obj, (datetime.datetime, datetime.date)):
            return obj.isoformat()
        return super().default(obj)

app = Flask(__name__)
app.json = CustomJSONProvider(app)
CORS(app)

db_pool = psycopg2.pool.ThreadedConnectionPool(
    minconn=1,
    maxconn=20,
    dsn=DATABASE_URL
)

def get_db_connection():
    return db_pool.getconn()

def release_db_connection(conn):
    db_pool.putconn(conn)

class DBQuery:
    def __init__(self, commit=False):
        self.commit = commit
        self.conn = None
        self.cur = None

    def __enter__(self):
        self.conn = get_db_connection()
        self.cur = self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        return self.cur

    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            if exc_type is None and self.commit:
                self.conn.commit()
            else:
                self.conn.rollback()
        finally:
            if self.cur:
                self.cur.close()
            if self.conn:
                release_db_connection(self.conn)

AUTHORITIES = [
    "Municipal Corporation",
    "Public Works Department (PWD)",
    "Traffic Police Department",
    "Water Supply Department",
    "Electricity Department",
    "Sanitation and Waste Management",
    "Drainage and Sewerage Department",
    "Street Lighting Department",
    "Parks and Garden Department",
    "Pollution Control Board",
    "Urban Development Authority",
    "Fire and Emergency Services",
]

def make_tracking_id():
    chars = string.ascii_uppercase + string.digits
    return "CW-" + "".join(random.choices(chars, k=6))

def get_distance_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2.0) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lon / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c

def send_nearby_alerts(issue):
    try:
        issue_lat = float(issue.get("latitude") or 0)
        issue_lng = float(issue.get("longitude") or 0)
        if not (-90 <= issue_lat <= 90 and -180 <= issue_lng <= 180):
            return

        with DBQuery(commit=True) as cur:
            cur.execute(
                "SELECT id, name, latitude, longitude FROM users WHERE latitude IS NOT NULL AND longitude IS NOT NULL"
            )
            users = cur.fetchall()

            for u in users:
                try:
                    u_lat = float(u["latitude"])
                    u_lng = float(u["longitude"])
                except (TypeError, ValueError):
                    continue

                dist = get_distance_km(issue_lat, issue_lng, u_lat, u_lng)
                if dist <= 10.0:
                    dist_km = round(dist, 2)
                    dist_text = "nearby" if dist < 0.1 else f"{dist:.1f} km away"
                    category = issue.get("category") or "Civic"
                    title = f"🚨 New {category} Report ({dist_text})"
                    message = issue.get("title") or "New civic problem reported in your neighborhood"

                    cur.execute(
                        """
                        INSERT INTO notifications (user_id, issue_id, title, message, distance_km)
                        VALUES (%s, %s, %s, %s, %s)
                        """,
                        (u["id"], issue["id"], title, message, dist_km)
                    )
    except Exception as err:
        print("send_nearby_alerts notice:", str(err))

def verify_admin(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Admin authentication required"}), 401

        token = auth_header[7:].strip()
        try:
            decoded = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
            if decoded.get("type") != "admin" or not isinstance(decoded.get("adminId"), int):
                return jsonify({"error": "Admin access only"}), 403

            with DBQuery() as cur:
                cur.execute(
                    """
                    SELECT id, name, email, admin_level, state, district, city, block
                    FROM admins
                    WHERE id = %s AND is_active = TRUE
                    """,
                    (decoded["adminId"],)
                )
                admin_row = cur.fetchone()
                if not admin_row:
                    return jsonify({"error": "Admin account is inactive or unavailable"}), 403

                request.admin = dict(admin_row)
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Token has expired"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error": "Invalid or expired token"}), 401
        except Exception as e:
            print("Admin verification error:", str(e))
            return jsonify({"error": "Could not verify admin"}), 500

        return f(*args, **kwargs)
    return decorated_function

@app.route("/uploads/<path:filename>")
def serve_upload(filename):
    return send_from_directory(UPLOAD_DIRECTORY, filename)

@app.route("/", methods=["GET"])
def index():
    return jsonify({"message": "CivicWatch API is running"})

@app.route("/api/authorities", methods=["GET"])
def get_authorities():
    return jsonify(AUTHORITIES)

@app.route("/api/issues", methods=["GET"])
def get_all_issues():
    try:
        with DBQuery() as cur:
            cur.execute("""
                SELECT
                    id,
                    tracking_id,
                    title,
                    category,
                    description,
                    department,
                    photo_url,
                    user_id,
                    status,
                    state,
                    district,
                    city,
                    block,
                    pincode,
                    latitude,
                    longitude,
                    upvotes_count,
                    downvotes_count,
                    comments_count,
                    is_duplicate,
                    duplicate_of_id,
                    is_anonymous,
                    created_at
                FROM issues
                ORDER BY created_at DESC
            """)
            rows = cur.fetchall()
            return jsonify(rows)
    except Exception as e:
        print("GET issues error:", str(e))
        return jsonify({"error": "Could not load issues"}), 500

@app.route("/api/dashboard", methods=["GET"])
def get_dashboard():
    try:
        with DBQuery() as cur:
            cur.execute("""
                SELECT
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE status = 'Pending')::int AS pending,
                    COUNT(*) FILTER (WHERE status = 'In Progress')::int AS "inProgress",
                    COUNT(*) FILTER (WHERE status = 'Resolved')::int AS resolved
                FROM issues
            """)
            counts = cur.fetchone() or {"total": 0, "pending": 0, "inProgress": 0, "resolved": 0}

            cur.execute("""
                SELECT
                    category,
                    COUNT(*)::int AS count
                FROM issues
                GROUP BY category
                ORDER BY count DESC
            """)
            categories = cur.fetchall()

            cur.execute("""
                SELECT
                    id,
                    tracking_id,
                    category,
                    title,
                    status
                FROM issues
                ORDER BY created_at DESC
                LIMIT 8
            """)
            recent = cur.fetchall()

            result = dict(counts)
            result["categories"] = categories
            result["recent"] = recent
            return jsonify(result)
    except Exception as e:
        print("GET dashboard error:", str(e))
        return jsonify({"error": "Could not load dashboard"}), 500

@app.route("/api/issues/track/<tracking_id>", methods=["GET"])
def track_issue(tracking_id):
    try:
        with DBQuery() as cur:
            cur.execute("""
                SELECT
                    id,
                    tracking_id,
                    title,
                    category,
                    description,
                    department,
                    photo_url,
                    status,
                    state,
                    district,
                    city,
                    block,
                    pincode,
                    latitude,
                    longitude,
                    upvotes_count,
                    downvotes_count,
                    comments_count,
                    is_duplicate,
                    duplicate_of_id,
                    created_at,
                    resolved_at
                FROM issues
                WHERE UPPER(tracking_id) = UPPER(%s)
            """, (tracking_id.strip(),))
            issue = cur.fetchone()
            if not issue:
                return jsonify({"error": "No issue found with this tracking ID"}), 404
            return jsonify(issue)
    except Exception as e:
        print("Track issue error:", str(e))
        return jsonify({"error": "Could not track issue"}), 500

@app.route("/api/issues", methods=["POST"])
def create_issue():
    form_data = request.form if request.form else (request.get_json(silent=True) or {})
    
    title = (form_data.get("title") or "").strip()
    category = (form_data.get("category") or "").strip() or "Other"
    description = (form_data.get("description") or "").strip()
    authority = (form_data.get("authority") or form_data.get("department") or "").strip()
    city = (form_data.get("city") or "Mumbai").strip()
    state = (form_data.get("state") or "Maharashtra").strip()
    district = (form_data.get("district") or "Mumbai Suburban").strip()
    block = (form_data.get("block") or "Powai").strip()
    pincode = (form_data.get("pincode") or "").strip()

    is_anon_raw = form_data.get("isAnonymous")
    user_id_raw = form_data.get("userId")
    is_anonymous = (is_anon_raw in ("true", True, "1", 1)) or not user_id_raw

    if not title or not description or not authority:
        return jsonify({"error": "Title, description and authority are required."}), 400

    if len(title) > 200:
        return jsonify({"error": "Title must be 200 characters or fewer."}), 400

    if authority not in AUTHORITIES:
        return jsonify({"error": "Please select a valid authority."}), 400

    try:
        lat = float(form_data.get("latitude"))
        lng = float(form_data.get("longitude"))
        if not (-90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0):
            raise ValueError()
    except (TypeError, ValueError):
        return jsonify({"error": "Please select a valid complaint location on the map."}), 400

    photo_url = None
    if "photo" in request.files:
        photo_file = request.files["photo"]
        if photo_file and photo_file.filename:
            ext = os.path.splitext(photo_file.filename)[1].lower()
            if ext not in [".jpg", ".jpeg", ".png", ".webp", ".gif"]:
                ext = ".jpg"
            filename = f"complaint-{int(datetime.datetime.now().timestamp() * 1000)}-{''.join(random.choices(string.ascii_lowercase + string.digits, k=6))}{ext}"
            file_path = os.path.join(UPLOAD_DIRECTORY, filename)
            photo_file.save(file_path)
            photo_url = f"/uploads/{filename}"

    try:
        user_id = None
        with DBQuery(commit=True) as cur:
            if user_id_raw:
                try:
                    uid_int = int(user_id_raw)
                    cur.execute("SELECT id FROM users WHERE id = %s", (uid_int,))
                    user_row = cur.fetchone()
                    if not user_row:
                        return jsonify({"error": "The selected user account does not exist."}), 400
                    user_id = user_row["id"]
                except (ValueError, TypeError):
                    pass

            tracking_id = make_tracking_id()
            cur.execute("SELECT id FROM issues WHERE tracking_id = %s", (tracking_id,))
            while cur.fetchone():
                tracking_id = make_tracking_id()
                cur.execute("SELECT id FROM issues WHERE tracking_id = %s", (tracking_id,))

            is_duplicate = False
            duplicate_of_id = None
            duplicate_notice = None

            cur.execute("""
                SELECT id, tracking_id, title, category, latitude, longitude
                FROM issues
                WHERE category = %s AND status != 'Resolved' AND latitude IS NOT NULL AND longitude IS NOT NULL
                ORDER BY created_at DESC
                LIMIT 30
            """, (category,))
            nearby_candidates = cur.fetchall()

            for cand in nearby_candidates:
                try:
                    cand_lat = float(cand["latitude"])
                    cand_lng = float(cand["longitude"])
                except (TypeError, ValueError):
                    continue

                dist = get_distance_km(lat, lng, cand_lat, cand_lng)
                if dist <= 0.10:
                    is_duplicate = True
                    duplicate_of_id = cand["id"]
                    duplicate_notice = f"Identified existing {category} report ({cand['tracking_id']}) within {int(dist * 1000)}m. Added support verification to original issue."
                    cur.execute("UPDATE issues SET upvotes_count = upvotes_count + 1 WHERE id = %s", (cand["id"],))
                    break

            cur.execute("""
                INSERT INTO issues
                (
                    tracking_id, title, category, description, department, photo_url,
                    user_id, is_anonymous, latitude, longitude, city, state, district,
                    block, pincode, is_duplicate, duplicate_of_id
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING
                    id, tracking_id, title, category, description, department, photo_url,
                    user_id, is_anonymous, status, city, state, district, block, pincode,
                    latitude, longitude, upvotes_count, downvotes_count, comments_count,
                    is_duplicate, duplicate_of_id, created_at
            """, (
                tracking_id, title, category, description, authority, photo_url,
                user_id, is_anonymous, lat, lng, city, state, district,
                block, pincode, is_duplicate, duplicate_of_id
            ))
            created_issue = dict(cur.fetchone())
            created_issue["duplicateNotice"] = duplicate_notice

        threading.Thread(target=send_nearby_alerts, args=(created_issue,), daemon=True).start()
        return jsonify(created_issue), 201

    except Exception as e:
        print("Create complaint error:", str(e))
        return jsonify({"error": "Could not save complaint to the database."}), 500

@app.route("/api/auth/signup", methods=["POST"])
def user_signup():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    gender = (data.get("gender") or "").strip()
    mobile = (data.get("mobile") or "").strip()
    password = data.get("password") or ""

    if not name or not email or not gender or not mobile or not password:
        return jsonify({"error": "Please fill in all fields"}), 400

    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400

    normalized_mobile = re.sub(r"[\s-]", "", mobile)
    normalized_mobile = re.sub(r"^(\+91|0)", "", normalized_mobile)

    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(10)).decode("utf-8")

    state = (data.get("state") or "Maharashtra").strip()
    city = (data.get("city") or "Mumbai").strip()
    try:
        latitude = float(data.get("latitude", 19.0760000))
        longitude = float(data.get("longitude", 72.8777000))
    except (TypeError, ValueError):
        latitude = 19.0760000
        longitude = 72.8777000

    try:
        with DBQuery(commit=True) as cur:
            cur.execute("""
                INSERT INTO users
                (name, email, gender, mobile, password_hash, state, city, latitude, longitude)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id, name, email, gender, mobile, state, city, latitude, longitude
            """, (name, email, gender, normalized_mobile, password_hash, state, city, latitude, longitude))
            new_user = dict(cur.fetchone())
            return jsonify({"user": new_user}), 201
    except psycopg2.IntegrityError:
        return jsonify({"error": "This email or mobile number is already registered"}), 409
    except Exception as e:
        print("Signup error:", str(e))
        return jsonify({"error": "Could not create account"}), 500

@app.route("/api/auth/login", methods=["POST"])
def user_login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    try:
        with DBQuery() as cur:
            cur.execute("""
                SELECT
                    id, name, email, gender, mobile, state, city, latitude, longitude, password_hash
                FROM users
                WHERE email = %s
            """, (email,))
            account = cur.fetchone()
            if not account:
                return jsonify({"error": "Incorrect email or password"}), 401

            stored_hash = account["password_hash"]
            if not bcrypt.checkpw(password.encode("utf-8"), stored_hash.encode("utf-8")):
                return jsonify({"error": "Incorrect email or password"}), 401

            safe_user = dict(account)
            safe_user.pop("password_hash", None)
            return jsonify({"user": safe_user})
    except Exception as e:
        print("Login error:", str(e))
        return jsonify({"error": "Could not log in"}), 500

@app.route("/api/admin/login", methods=["POST"])
def admin_login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    try:
        with DBQuery() as cur:
            cur.execute("""
                SELECT id, name, email, password_hash, admin_level, state, district, city, block
                FROM admins
                WHERE email = %s AND is_active = TRUE
            """, (email,))
            admin = cur.fetchone()
            if not admin:
                return jsonify({"error": "Invalid admin credentials"}), 401

            stored_hash = admin["password_hash"]
            if not bcrypt.checkpw(password.encode("utf-8"), stored_hash.encode("utf-8")):
                return jsonify({"error": "Invalid admin credentials"}), 401

            exp_time = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)
            token = jwt.encode(
                {
                    "adminId": admin["id"],
                    "type": "admin",
                    "exp": exp_time,
                },
                JWT_SECRET,
                algorithm="HS256"
            )

            return jsonify({
                "message": "Admin login successful",
                "token": token,
                "admin": {
                    "id": admin["id"],
                    "name": admin["name"],
                    "email": admin["email"],
                    "admin_level": admin.get("admin_level") or "CITY",
                    "state": admin.get("state"),
                    "district": admin.get("district"),
                    "city": admin.get("city"),
                    "block": admin.get("block"),
                }
            })
    except Exception as e:
        print("Admin login error:", str(e))
        return jsonify({"error": "Admin login failed"}), 500

@app.route("/api/admin/issues", methods=["GET"])
@verify_admin
def admin_get_issues():
    scope = request.args.get("scope", "")
    admin_info = request.admin
    params = []
    where_clauses = ["1=1"]

    if scope != "all":
        level = admin_info.get("admin_level") or "CITY"
        if level == "BLOCK" and admin_info.get("block"):
            params.append(admin_info["block"])
            where_clauses.append(f"i.block = %s")
        elif level == "CITY" and admin_info.get("city"):
            params.append(admin_info["city"])
            where_clauses.append(f"i.city = %s")
        elif level == "DISTRICT" and admin_info.get("district"):
            params.append(admin_info["district"])
            where_clauses.append(f"i.district = %s")
        elif level == "STATE" and admin_info.get("state"):
            params.append(admin_info["state"])
            where_clauses.append(f"i.state = %s")

    where_sql = " AND ".join(where_clauses)
    query = f"""
        SELECT
            i.id,
            i.tracking_id,
            i.title,
            i.category,
            i.description,
            i.department,
            i.photo_url,
            i.status,
            i.state,
            i.district,
            i.city,
            i.block,
            i.pincode,
            i.latitude,
            i.longitude,
            i.upvotes_count,
            i.downvotes_count,
            i.comments_count,
            i.is_duplicate,
            i.duplicate_of_id,
            i.created_at,
            i.resolved_at,
            CASE
                WHEN i.is_anonymous = TRUE THEN 'Anonymous Citizen'
                WHEN u.name IS NOT NULL THEN u.name
                ELSE 'Anonymous Citizen'
            END AS reported_by,
            i.is_anonymous
        FROM issues i
        LEFT JOIN users u ON i.user_id = u.id
        WHERE {where_sql}
        ORDER BY i.created_at DESC, i.id DESC
    """
    try:
        with DBQuery() as cur:
            cur.execute(query, tuple(params))
            rows = cur.fetchall()
            return jsonify(rows)
    except Exception as e:
        print("Admin get issues error:", str(e))
        return jsonify({"error": "Failed to fetch complaints"}), 500

@app.route("/api/user/issues/<int:user_id>", methods=["GET"])
def get_user_issues(user_id):
    if user_id <= 0:
        return jsonify({"error": "Invalid user ID"}), 400

    try:
        with DBQuery() as cur:
            cur.execute("""
                SELECT
                    id,
                    tracking_id,
                    title,
                    category,
                    description,
                    department,
                    photo_url,
                    status,
                    city,
                    state,
                    district,
                    block,
                    pincode,
                    latitude,
                    longitude,
                    upvotes_count,
                    downvotes_count,
                    comments_count,
                    is_duplicate,
                    duplicate_of_id,
                    is_anonymous,
                    created_at,
                    resolved_at
                FROM issues
                WHERE user_id = %s
                ORDER BY created_at DESC, id DESC
            """, (user_id,))
            rows = cur.fetchall()
            return jsonify(rows)
    except Exception as e:
        print("User get issues error:", str(e))
        return jsonify({"error": "Failed to fetch user complaints"}), 500

@app.route("/api/user/profile/<int:user_id>", methods=["PUT"])
def update_user_profile(user_id):
    if user_id <= 0:
        return jsonify({"error": "Invalid user ID"}), 400

    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400

    mobile = data.get("mobile")
    gender = data.get("gender")
    city = data.get("city")
    state = data.get("state")
    lat_val = data.get("latitude")
    lng_val = data.get("longitude")

    lat = float(lat_val) if (lat_val is not None and lat_val != "") else None
    lng = float(lng_val) if (lng_val is not None and lng_val != "") else None

    try:
        with DBQuery(commit=True) as cur:
            cur.execute("""
                UPDATE users
                SET name = %s,
                    mobile = COALESCE(%s, mobile),
                    gender = COALESCE(%s, gender),
                    city = COALESCE(%s, city),
                    state = COALESCE(%s, state),
                    latitude = COALESCE(%s, latitude),
                    longitude = COALESCE(%s, longitude)
                WHERE id = %s
                RETURNING id, name, email, gender, mobile, state, city, latitude, longitude
            """, (
                name,
                mobile.strip() if mobile else None,
                gender if gender else None,
                city.strip() if city else None,
                state.strip() if state else None,
                lat,
                lng,
                user_id
            ))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "User not found"}), 404

            return jsonify({
                "message": "Profile updated successfully",
                "user": dict(row)
            })
    except Exception as e:
        print("Update profile error:", str(e))
        return jsonify({"error": "Failed to update profile"}), 500

@app.route("/api/issues/<int:issue_id>/vote", methods=["POST"])
def cast_vote(issue_id):
    data = request.get_json(silent=True) or {}
    user_id = data.get("userId")
    vote_type = data.get("voteType")

    if not user_id or vote_type not in ["upvote", "downvote"]:
        return jsonify({"error": "Valid issue ID, user ID and voteType ('upvote'/'downvote') are required"}), 400

    u_id = int(user_id)

    try:
        with DBQuery(commit=True) as cur:
            cur.execute(
                "SELECT id, vote_type FROM issue_votes WHERE issue_id = %s AND user_id = %s",
                (issue_id, u_id)
            )
            existing = cur.fetchone()
            active_vote = None

            if not existing:
                cur.execute(
                    "INSERT INTO issue_votes (issue_id, user_id, vote_type) VALUES (%s, %s, %s)",
                    (issue_id, u_id, vote_type)
                )
                if vote_type == "upvote":
                    cur.execute("UPDATE issues SET upvotes_count = upvotes_count + 1 WHERE id = %s", (issue_id,))
                else:
                    cur.execute("UPDATE issues SET downvotes_count = downvotes_count + 1 WHERE id = %s", (issue_id,))
                active_vote = vote_type
            elif existing["vote_type"] == vote_type:
                cur.execute("DELETE FROM issue_votes WHERE id = %s", (existing["id"],))
                if vote_type == "upvote":
                    cur.execute("UPDATE issues SET upvotes_count = GREATEST(0, upvotes_count - 1) WHERE id = %s", (issue_id,))
                else:
                    cur.execute("UPDATE issues SET downvotes_count = GREATEST(0, downvotes_count - 1) WHERE id = %s", (issue_id,))
                active_vote = None
            else:
                cur.execute(
                    "UPDATE issue_votes SET vote_type = %s, created_at = CURRENT_TIMESTAMP WHERE id = %s",
                    (vote_type, existing["id"])
                )
                if vote_type == "upvote":
                    cur.execute(
                        "UPDATE issues SET upvotes_count = upvotes_count + 1, downvotes_count = GREATEST(0, downvotes_count - 1) WHERE id = %s",
                        (issue_id,)
                    )
                else:
                    cur.execute(
                        "UPDATE issues SET downvotes_count = downvotes_count + 1, upvotes_count = GREATEST(0, upvotes_count - 1) WHERE id = %s",
                        (issue_id,)
                    )
                active_vote = vote_type

            cur.execute(
                "SELECT id, upvotes_count, downvotes_count, is_duplicate FROM issues WHERE id = %s",
                (issue_id,)
            )
            updated = cur.fetchone() or {}

            return jsonify({
                "success": True,
                "userVote": active_vote,
                "upvotes_count": updated.get("upvotes_count", 0),
                "downvotes_count": updated.get("downvotes_count", 0),
                "is_duplicate": updated.get("is_duplicate", False),
            })
    except Exception as e:
        print("Cast vote error:", str(e))
        return jsonify({"error": "Failed to record vote"}), 500

@app.route("/api/issues/<int:issue_id>/vote/<int:user_id>", methods=["GET"])
def get_vote_status(issue_id, user_id):
    try:
        with DBQuery() as cur:
            cur.execute(
                "SELECT vote_type FROM issue_votes WHERE issue_id = %s AND user_id = %s",
                (issue_id, user_id)
            )
            vote_row = cur.fetchone()
            cur.execute(
                "SELECT upvotes_count, downvotes_count, is_duplicate FROM issues WHERE id = %s",
                (issue_id,)
            )
            issue_row = cur.fetchone() or {}

            return jsonify({
                "userVote": vote_row["vote_type"] if vote_row else None,
                "upvotes_count": issue_row.get("upvotes_count", 0),
                "downvotes_count": issue_row.get("downvotes_count", 0),
                "is_duplicate": issue_row.get("is_duplicate", False),
            })
    except Exception as e:
        print("Get vote status error:", str(e))
        return jsonify({"error": "Failed to get vote status"}), 500

@app.route("/api/notifications/<int:user_id>", methods=["GET"])
def get_user_notifications(user_id):
    if user_id <= 0:
        return jsonify({"error": "Invalid user ID"}), 400

    try:
        with DBQuery() as cur:
            cur.execute("""
                SELECT
                    n.id,
                    n.user_id,
                    n.issue_id,
                    n.title,
                    n.message,
                    n.distance_km,
                    n.is_read,
                    n.created_at,
                    i.tracking_id,
                    i.category,
                    i.status,
                    i.department,
                    i.city,
                    i.block,
                    i.latitude as issue_lat,
                    i.longitude as issue_lng,
                    i.upvotes_count,
                    i.downvotes_count,
                    i.comments_count,
                    i.is_duplicate,
                    i.duplicate_of_id,
                    i.is_anonymous,
                    i.photo_url
                FROM notifications n
                LEFT JOIN issues i ON n.issue_id = i.id
                WHERE n.user_id = %s
                ORDER BY n.created_at DESC, n.id DESC
                LIMIT 50
            """, (user_id,))
            rows = cur.fetchall()
            unread_count = sum(1 for n in rows if not n["is_read"])
            return jsonify({
                "notifications": rows,
                "unreadCount": unread_count,
            })
    except Exception as e:
        print("Fetch notifications error:", str(e))
        return jsonify({"error": "Failed to fetch notifications"}), 500

@app.route("/api/notifications/<int:notif_id>/read", methods=["PUT"])
def mark_notification_read(notif_id):
    try:
        with DBQuery(commit=True) as cur:
            cur.execute("UPDATE notifications SET is_read = TRUE WHERE id = %s", (notif_id,))
            return jsonify({"success": True})
    except Exception as e:
        print("Mark notification read error:", str(e))
        return jsonify({"error": "Failed to mark notification read"}), 500

@app.route("/api/notifications/user/<int:user_id>/read-all", methods=["PUT"])
def mark_all_notifications_read(user_id):
    try:
        with DBQuery(commit=True) as cur:
            cur.execute("UPDATE notifications SET is_read = TRUE WHERE user_id = %s", (user_id,))
            return jsonify({"success": True})
    except Exception as e:
        print("Mark all read error:", str(e))
        return jsonify({"error": "Failed to mark all notifications read"}), 500

@app.route("/api/user/location/<int:user_id>", methods=["PUT"])
def update_user_location(user_id):
    data = request.get_json(silent=True) or {}
    try:
        lat = float(data.get("latitude"))
        lng = float(data.get("longitude"))
        if not (-90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0):
            raise ValueError()
    except (TypeError, ValueError):
        return jsonify({"error": "Valid latitude and longitude are required"}), 400

    try:
        with DBQuery(commit=True) as cur:
            cur.execute("""
                UPDATE users
                SET latitude = %s, longitude = %s
                WHERE id = %s
                RETURNING id, name, email, latitude, longitude
            """, (lat, lng, user_id))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "User not found"}), 404
            return jsonify({"success": True, "user": dict(row)})
    except Exception as e:
        print("Update user location error:", str(e))
        return jsonify({"error": "Failed to update user location"}), 500

@app.route("/api/issues/<int:issue_id>/comments", methods=["GET"])
def get_issue_comments(issue_id):
    try:
        with DBQuery() as cur:
            cur.execute("""
                SELECT
                    c.id,
                    c.issue_id,
                    c.user_id,
                    c.comment,
                    c.created_at,
                    u.name as user_name,
                    u.city as user_city
                FROM issue_comments c
                JOIN users u ON c.user_id = u.id
                WHERE c.issue_id = %s
                ORDER BY c.created_at ASC
            """, (issue_id,))
            rows = cur.fetchall()
            return jsonify(rows)
    except Exception as e:
        print("Fetch comments error:", str(e))
        return jsonify({"error": "Failed to fetch comments"}), 500

@app.route("/api/issues/<int:issue_id>/comments", methods=["POST"])
def post_issue_comment(issue_id):
    data = request.get_json(silent=True) or {}
    user_id = data.get("userId")
    comment_text = (data.get("comment") or "").strip()

    if not user_id or not comment_text:
        return jsonify({"error": "Valid issue ID, user ID, and non-empty comment are required"}), 400

    if len(comment_text) > 1000:
        return jsonify({"error": "Comment is too long (maximum 1000 characters)"}), 400

    try:
        u_id = int(user_id)
        with DBQuery(commit=True) as cur:
            cur.execute("SELECT id, name, city FROM users WHERE id = %s", (u_id,))
            user_row = cur.fetchone()
            if not user_row:
                return jsonify({"error": "User not found"}), 404

            cur.execute("SELECT id FROM issues WHERE id = %s", (issue_id,))
            issue_row = cur.fetchone()
            if not issue_row:
                return jsonify({"error": "Issue not found"}), 404

            cur.execute("""
                INSERT INTO issue_comments (issue_id, user_id, comment)
                VALUES (%s, %s, %s)
                RETURNING id, issue_id, user_id, comment, created_at
            """, (issue_id, u_id, comment_text))
            new_comment = dict(cur.fetchone())

            cur.execute("UPDATE issues SET comments_count = comments_count + 1 WHERE id = %s", (issue_id,))

            new_comment["user_name"] = user_row["name"]
            new_comment["user_city"] = user_row["city"]

            return jsonify(new_comment), 201
    except Exception as e:
        print("Post comment error:", str(e))
        return jsonify({"error": "Failed to post comment"}), 500

@app.route("/api/comments/<int:comment_id>", methods=["DELETE"])
def delete_comment(comment_id):
    try:
        with DBQuery(commit=True) as cur:
            cur.execute("SELECT id, issue_id FROM issue_comments WHERE id = %s", (comment_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Comment not found"}), 404

            issue_id = row["issue_id"]
            cur.execute("DELETE FROM issue_comments WHERE id = %s", (comment_id,))
            cur.execute("UPDATE issues SET comments_count = GREATEST(0, comments_count - 1) WHERE id = %s", (issue_id,))

            return jsonify({"success": True, "message": "Comment deleted successfully"})
    except Exception as e:
        print("Delete comment error:", str(e))
        return jsonify({"error": "Failed to delete comment"}), 500

@app.route("/api/admin/issues/<int:issue_id>/mark-duplicate", methods=["PUT"])
def mark_duplicate(issue_id):
    data = request.get_json(silent=True) or {}
    is_duplicate = data.get("isDuplicate") in (True, "true", 1, "1")
    dup_id_raw = data.get("duplicateOfId")
    duplicate_of_id = int(dup_id_raw) if dup_id_raw else None

    try:
        with DBQuery(commit=True) as cur:
            cur.execute("""
                UPDATE issues
                SET is_duplicate = %s, duplicate_of_id = %s
                WHERE id = %s
                RETURNING id, tracking_id, is_duplicate, duplicate_of_id
            """, (is_duplicate, duplicate_of_id, issue_id))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Issue not found"}), 404
            return jsonify({"success": True, "issue": dict(row)})
    except Exception as e:
        print("Mark duplicate error:", str(e))
        return jsonify({"error": "Failed to update duplicate status"}), 500

@app.route("/api/user/password/<int:user_id>", methods=["PUT"])
def update_user_password(user_id):
    data = request.get_json(silent=True) or {}
    curr_pwd = data.get("currentPassword") or ""
    new_pwd = data.get("newPassword") or ""

    if not curr_pwd or not new_pwd:
        return jsonify({"error": "Current and new passwords are required"}), 400

    if len(new_pwd) < 8:
        return jsonify({"error": "New password must be at least 8 characters"}), 400

    try:
        with DBQuery(commit=True) as cur:
            cur.execute("SELECT password_hash FROM users WHERE id = %s", (user_id,))
            user_row = cur.fetchone()
            if not user_row:
                return jsonify({"error": "User not found"}), 404

            if not bcrypt.checkpw(curr_pwd.encode("utf-8"), user_row["password_hash"].encode("utf-8")):
                return jsonify({"error": "Current password is incorrect"}), 401

            new_hash = bcrypt.hashpw(new_pwd.encode("utf-8"), bcrypt.gensalt(10)).decode("utf-8")
            cur.execute("UPDATE users SET password_hash = %s WHERE id = %s", (new_hash, user_id))
            return jsonify({"message": "Password updated successfully"})
    except Exception as e:
        print("Change password error:", str(e))
        return jsonify({"error": "Failed to update password"}), 500

@app.route("/api/user/issues/<int:issue_id>", methods=["DELETE"])
def delete_user_issue(issue_id):
    user_id_raw = request.args.get("userId")
    try:
        user_id = int(user_id_raw)
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid issue ID or user ID"}), 400

    try:
        with DBQuery(commit=True) as cur:
            cur.execute("""
                DELETE FROM issues
                WHERE id = %s AND user_id = %s AND status = 'Pending'
                RETURNING id, tracking_id
            """, (issue_id, user_id))
            row = cur.fetchone()
            if not row:
                return jsonify({
                    "error": "Complaint not found or cannot be cancelled once In Progress / Resolved"
                }), 400
            return jsonify({
                "message": f"Complaint {row['tracking_id']} successfully cancelled",
                "id": issue_id
            })
    except Exception as e:
        print("Delete issue error:", str(e))
        return jsonify({"error": "Failed to cancel complaint"}), 500

@app.route("/api/admin/issues/<int:issue_id>", methods=["PATCH"])
@verify_admin
def admin_update_issue(issue_id):
    data = request.get_json(silent=True) or {}
    status = data.get("status")
    department = data.get("department")

    valid_statuses = ["Pending", "In Progress", "Resolved"]
    if status is None and department is None:
        return jsonify({"error": "Provide status or department"}), 400

    if status is not None and status not in valid_statuses:
        return jsonify({"error": "Invalid complaint status"}), 400

    if department is not None and department not in AUTHORITIES:
        return jsonify({"error": "Invalid department"}), 400

    try:
        with DBQuery(commit=True) as cur:
            cur.execute("""
                UPDATE issues
                SET
                    status = COALESCE(%s, status),
                    department = COALESCE(%s, department),
                    resolved_at = CASE
                        WHEN %s = 'Resolved' AND status <> 'Resolved'
                            THEN CURRENT_TIMESTAMP
                        WHEN %s IS NOT NULL AND %s <> 'Resolved'
                            THEN NULL
                        ELSE resolved_at
                    END
                WHERE id = %s
                RETURNING *
            """, (status, department, status, status, status, issue_id))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Complaint not found"}), 404

            return jsonify({
                "message": "Complaint updated successfully",
                "issue": dict(row)
            })
    except Exception as e:
        print("Update complaint error:", str(e))
        return jsonify({"error": "Failed to update complaint"}), 500

@app.route("/api/admin/users", methods=["GET"])
@verify_admin
def admin_get_users():
    try:
        with DBQuery() as cur:
            cur.execute("""
                SELECT
                    u.id,
                    u.name,
                    u.email,
                    u.gender,
                    u.mobile,
                    u.created_at,
                    COUNT(i.id)::int AS total_complaints
                FROM users u
                LEFT JOIN issues i ON i.user_id = u.id
                GROUP BY
                    u.id, u.name, u.email, u.gender, u.mobile, u.created_at
                ORDER BY u.created_at DESC
            """)
            rows = cur.fetchall()
            return jsonify(rows)
    except Exception as e:
        print("Admin get users error:", str(e))
        return jsonify({"error": "Failed to fetch users"}), 500

def init_database():
    try:
        with DBQuery(commit=True) as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    email VARCHAR(255) UNIQUE NOT NULL,
                    gender VARCHAR(40) NOT NULL,
                    mobile VARCHAR(15) UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    state VARCHAR(100) DEFAULT 'Maharashtra',
                    city VARCHAR(100) DEFAULT 'Mumbai',
                    latitude NUMERIC(10, 7) DEFAULT 19.0760000,
                    longitude NUMERIC(10, 7) DEFAULT 72.8777000,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                ALTER TABLE users ADD COLUMN IF NOT EXISTS state VARCHAR(100) DEFAULT 'Maharashtra';
                ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(100) DEFAULT 'Mumbai';
                ALTER TABLE users ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 7) DEFAULT 19.0760000;
                ALTER TABLE users ADD COLUMN IF NOT EXISTS longitude NUMERIC(10, 7) DEFAULT 72.8777000;
            """)

            cur.execute("""
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
                ALTER TABLE admins ADD COLUMN IF NOT EXISTS admin_level VARCHAR(30) DEFAULT 'CITY';
                ALTER TABLE admins ADD COLUMN IF NOT EXISTS state VARCHAR(100);
                ALTER TABLE admins ADD COLUMN IF NOT EXISTS district VARCHAR(100);
                ALTER TABLE admins ADD COLUMN IF NOT EXISTS city VARCHAR(100);
                ALTER TABLE admins ADD COLUMN IF NOT EXISTS block VARCHAR(100);
                ALTER TABLE admins ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS issues (
                    id SERIAL PRIMARY KEY,
                    tracking_id VARCHAR(20) UNIQUE NOT NULL,
                    title VARCHAR(200) NOT NULL,
                    category VARCHAR(100) NOT NULL,
                    description TEXT NOT NULL,
                    department VARCHAR(120) NOT NULL DEFAULT 'Municipal Corporation',
                    photo_url TEXT,
                    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    is_anonymous BOOLEAN DEFAULT FALSE,
                    status VARCHAR(30) NOT NULL DEFAULT 'Pending'
                        CHECK (status IN ('Pending', 'In Progress', 'Resolved')),
                    latitude NUMERIC(10, 7),
                    longitude NUMERIC(10, 7),
                    state VARCHAR(100) DEFAULT 'Maharashtra',
                    district VARCHAR(100) DEFAULT 'Mumbai Suburban',
                    city VARCHAR(100) DEFAULT 'Mumbai',
                    block VARCHAR(100) DEFAULT 'Powai',
                    pincode VARCHAR(10),
                    upvotes_count INTEGER NOT NULL DEFAULT 0,
                    downvotes_count INTEGER NOT NULL DEFAULT 0,
                    comments_count INTEGER NOT NULL DEFAULT 0,
                    is_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
                    duplicate_of_id INTEGER REFERENCES issues(id) ON DELETE SET NULL,
                    resolved_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                ALTER TABLE issues ADD COLUMN IF NOT EXISTS upvotes_count INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE issues ADD COLUMN IF NOT EXISTS downvotes_count INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE issues ADD COLUMN IF NOT EXISTS comments_count INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE issues ADD COLUMN IF NOT EXISTS is_duplicate BOOLEAN NOT NULL DEFAULT FALSE;
                ALTER TABLE issues ADD COLUMN IF NOT EXISTS duplicate_of_id INTEGER REFERENCES issues(id) ON DELETE SET NULL;
                ALTER TABLE issues ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS notifications (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
                    title VARCHAR(200) NOT NULL,
                    message TEXT,
                    distance_km NUMERIC(6, 2),
                    is_read BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS issue_votes (
                    id SERIAL PRIMARY KEY,
                    issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    vote_type VARCHAR(10) NOT NULL CHECK (vote_type IN ('upvote', 'downvote')),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(issue_id, user_id)
                );
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS issue_comments (
                    id SERIAL PRIMARY KEY,
                    issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    comment TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)

            cur.execute("SELECT COUNT(*)::int as count FROM admins")
            cnt_row = cur.fetchone()
            if cnt_row and cnt_row["count"] == 0:
                default_pwd = os.getenv("ADMIN_PASSWORD", "Admin@12345678")
                pwd_hash = bcrypt.hashpw(default_pwd.encode("utf-8"), bcrypt.gensalt(10)).decode("utf-8")
                demo_admins = [
                    ("System Administrator", "admin@civicwatch.gov.in", "NATIONAL", None, None, None, None),
                    ("National Nodal Officer (MoHUA)", "national@civicwatch.gov.in", "NATIONAL", None, None, None, None),
                    ("Maharashtra Urban Development", "state.mh@civicwatch.gov.in", "STATE", "Maharashtra", None, None, None),
                    ("Municipal Corp of Greater Mumbai", "admin.mumbai@civicwatch.gov.in", "CITY", "Maharashtra", "Mumbai Suburban", "Mumbai", None),
                    ("Powai Ward-S Officer", "ward.powai@civicwatch.gov.in", "BLOCK", "Maharashtra", "Mumbai Suburban", "Mumbai", "Powai"),
                ]
                for a_name, a_email, a_lvl, a_state, a_dist, a_city, a_block in demo_admins:
                    cur.execute("""
                        INSERT INTO admins (name, email, password_hash, admin_level, state, district, city, block)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (email) DO NOTHING
                    """, (a_name, a_email, pwd_hash, a_lvl, a_state, a_dist, a_city, a_block))

            cur.execute("SELECT COUNT(*)::int as count FROM issues")
            cnt_issues = cur.fetchone()
            if cnt_issues and cnt_issues["count"] == 0:
                cur.execute("""
                    INSERT INTO issues (tracking_id, title, category, description, department, status, latitude, longitude, state, district, city, block)
                    VALUES
                    ('CW-DEMO01', 'Pothole near main road', 'Road', 'Pothole reported near the main road', 'Public Works Department (PWD)', 'Pending', 19.0760000, 72.8777000, 'Maharashtra', 'Mumbai Suburban', 'Mumbai', 'Powai'),
                    ('CW-DEMO02', 'Garbage collection delayed', 'Garbage', 'Garbage collection is delayed in the residential lane', 'Sanitation and Waste Management', 'In Progress', 19.0900000, 72.8650000, 'Maharashtra', 'Mumbai Suburban', 'Mumbai', 'Powai'),
                    ('CW-DEMO03', 'Streetlight not working', 'Streetlight', 'Streetlight fixture blinking and off for 3 days', 'Street Lighting Department', 'Resolved', 19.1170000, 72.9050000, 'Maharashtra', 'Mumbai Suburban', 'Mumbai', 'Powai')
                    ON CONFLICT (tracking_id) DO NOTHING
                """)

        print("✓ Database tables verified for Flask backend")
    except Exception as err:
        print("Database initialization notice:", str(err))

if __name__ == "__main__":
    init_database()
    print(f"CivicWatch Flask API running at http://0.0.0.0:{PORT}")
    app.run(host="0.0.0.0", port=PORT, debug=False)
