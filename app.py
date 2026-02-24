from flask import Flask, render_template, request, jsonify, g
import sqlite3
import os
import uuid
import random
import joblib

model = joblib.load("sentiment_model.pkl")
from datetime import datetime, timedelta

app = Flask(__name__)
DATABASE = 'hospital.db'

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    with app.app_context():
        db = get_db()
        db.executescript('''
            CREATE TABLE IF NOT EXISTS patients (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                age INTEGER NOT NULL,
                gender TEXT NOT NULL,
                phone TEXT NOT NULL,
                department TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS complaints (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                patient_name TEXT NOT NULL,
                department TEXT NOT NULL,
                severity TEXT NOT NULL,
                description TEXT NOT NULL,
                status TEXT DEFAULT 'Open',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (patient_id) REFERENCES patients(id)
            );

            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                message TEXT NOT NULL,
                type TEXT NOT NULL,
                read INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        ''')
        # Seed default settings
        existing = db.execute("SELECT key FROM settings WHERE key='alerts_enabled'").fetchone()
        if not existing:
            db.executemany("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", [
                ('alerts_enabled', '1'),
                ('ai_monitoring', '1'),
                ('theme', 'dark'),
                ('auto_escalate', '1'),
            ])
        # Seed some demo data if empty
        pt_count = db.execute("SELECT COUNT(*) as c FROM patients").fetchone()['c']
        if pt_count == 0:
            seed_demo_data(db)
        db.commit()

def seed_demo_data(db):
    departments = ['Emergency', 'Cardiology', 'Neurology', 'Orthopedics', 'Pediatrics', 'Oncology', 'Radiology']
    genders = ['Male', 'Female', 'Other']
    severities = ['Low', 'Medium', 'High', 'Critical']
    statuses = ['Open', 'In Progress', 'Resolved']
    names = [
        ('Alice', 'Female'), ('Bob', 'Male'), ('Carol', 'Female'), ('David', 'Male'),
        ('Eve', 'Female'), ('Frank', 'Male'), ('Grace', 'Female'), ('Henry', 'Male'),
        ('Iris', 'Female'), ('Jack', 'Male'), ('Karen', 'Female'), ('Leo', 'Male')
    ]
    patient_ids = []
    for (name, gender) in names:
        pid = 'PX-' + str(random.randint(10000, 99999))
        patient_ids.append((pid, name))
        db.execute("INSERT INTO patients (id, name, age, gender, phone, department) VALUES (?,?,?,?,?,?)",
            (pid, name, random.randint(18, 80), gender,
             f'+1-555-{random.randint(1000,9999)}', random.choice(departments)))

    complaint_msgs = [
        'Long wait times in the waiting area.',
        'Staff was unresponsive to call button.',
        'Medication was administered incorrectly.',
        'Billing discrepancy noticed on invoice.',
        'Room cleanliness is below standard.',
        'Difficulty scheduling follow-up appointment.',
        'Equipment malfunction during procedure.',
        'Communication gap between departments.',
    ]
    for i in range(20):
        pid, pname = random.choice(patient_ids)
        sev = random.choice(severities)
        status = random.choice(statuses)
        cid = 'CMP-' + str(random.randint(10000, 99999))
        ts = datetime.now() - timedelta(days=random.randint(0, 30), hours=random.randint(0, 23))
        db.execute(
            "INSERT INTO complaints (id, patient_id, patient_name, department, severity, description, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (cid, pid, pname, random.choice(departments), sev, random.choice(complaint_msgs), status, ts, ts)
        )
        if sev == 'Critical':
            nid = 'N-' + str(uuid.uuid4())[:8]
            db.execute("INSERT INTO notifications (id, message, type) VALUES (?,?,?)",
                (nid, f'🚨 Critical complaint #{cid} from {pname} requires immediate attention!', 'critical'))

# ─── Routes ───────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')

# Dashboard stats
@app.route('/api/dashboard')
def dashboard():
    db = get_db()
    total_patients = db.execute("SELECT COUNT(*) as c FROM patients").fetchone()['c']
    total_complaints = db.execute("SELECT COUNT(*) as c FROM complaints").fetchone()['c']
    critical_cases = db.execute("SELECT COUNT(*) as c FROM complaints WHERE severity='Critical' AND status != 'Resolved'").fetchone()['c']
    resolved = db.execute("SELECT COUNT(*) as c FROM complaints WHERE status='Resolved'").fetchone()['c']
    resolution_rate = round((resolved / total_complaints * 100) if total_complaints > 0 else 0, 1)

    recent_activity = db.execute("""
        SELECT 'complaint' as type, id, patient_name as actor, severity, status, created_at
        FROM complaints ORDER BY created_at DESC LIMIT 5
    """).fetchall()

    dept_stats = db.execute("""
        SELECT department, COUNT(*) as count FROM complaints GROUP BY department
    """).fetchall()

    severity_stats = db.execute("""
        SELECT severity, COUNT(*) as count FROM complaints GROUP BY severity
    """).fetchall()

    weekly = []
    for i in range(7):
        day = datetime.now() - timedelta(days=6-i)
        day_str = day.strftime('%Y-%m-%d')
        count = db.execute("SELECT COUNT(*) as c FROM complaints WHERE DATE(created_at) = ?", (day_str,)).fetchone()['c']
        weekly.append({'day': day.strftime('%a'), 'count': count})

    return jsonify({
        'total_patients': total_patients,
        'total_complaints': total_complaints,
        'critical_cases': critical_cases,
        'resolution_rate': resolution_rate,
        'recent_activity': [dict(r) for r in recent_activity],
        'dept_stats': [dict(r) for r in dept_stats],
        'severity_stats': [dict(r) for r in severity_stats],
        'weekly': weekly,
    })

# Patients
@app.route('/api/patients', methods=['GET'])
def get_patients():
    db = get_db()
    search = request.args.get('search', '')
    dept = request.args.get('department', '')
    query = "SELECT * FROM patients WHERE 1=1"
    params = []
    if search:
        query += " AND (name LIKE ? OR id LIKE ? OR phone LIKE ?)"
        params += [f'%{search}%', f'%{search}%', f'%{search}%']
    if dept:
        query += " AND department = ?"
        params.append(dept)
    query += " ORDER BY created_at DESC"
    patients = db.execute(query, params).fetchall()
    return jsonify([dict(p) for p in patients])

@app.route('/api/patients', methods=['POST'])
def add_patient():
    db = get_db()
    data = request.json
    pid = 'PX-' + str(random.randint(10000, 99999))
    # ensure unique
    while db.execute("SELECT id FROM patients WHERE id=?", (pid,)).fetchone():
        pid = 'PX-' + str(random.randint(10000, 99999))
    db.execute("INSERT INTO patients (id, name, age, gender, phone, department) VALUES (?,?,?,?,?,?)",
        (pid, data['name'], data['age'], data['gender'], data['phone'], data['department']))
    nid = 'N-' + str(uuid.uuid4())[:8]
    db.execute("INSERT INTO notifications (id, message, type) VALUES (?,?,?)",
        (nid, f"✅ New patient registered: {data['name']} ({pid})", 'info'))
    db.commit()
    return jsonify({'success': True, 'patient_id': pid})

@app.route('/api/patients/<pid>', methods=['GET'])
def get_patient(pid):
    db = get_db()
    patient = db.execute("SELECT * FROM patients WHERE id=?", (pid,)).fetchone()
    if not patient:
        return jsonify({'error': 'Not found'}), 404
    complaints = db.execute("SELECT * FROM complaints WHERE patient_id=? ORDER BY created_at DESC", (pid,)).fetchall()
    return jsonify({'patient': dict(patient), 'complaints': [dict(c) for c in complaints]})

# Complaints
@app.route('/api/complaints', methods=['GET'])
def get_complaints():
    db = get_db()
    severity = request.args.get('severity', '')
    status = request.args.get('status', '')
    query = "SELECT * FROM complaints WHERE 1=1"
    params = []
    if severity:
        query += " AND severity=?"
        params.append(severity)
    if status:
        query += " AND status=?"
        params.append(status)
    query += " ORDER BY created_at DESC"
    complaints = db.execute(query, params).fetchall()
    return jsonify([dict(c) for c in complaints])

@app.route('/api/complaints', methods=['POST'])
def add_complaint():
    db = get_db()
    data = request.json
    cid = 'CMP-' + str(random.randint(10000, 99999))
    patient = db.execute("SELECT name FROM patients WHERE id=?", (data['patient_id'],)).fetchone()
    pname = patient['name'] if patient else 'Unknown'
    now = datetime.now()
    db.execute(
        "INSERT INTO complaints (id, patient_id, patient_name, department, severity, description, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (cid, data['patient_id'], pname, data['department'], data['severity'], data['description'], 'Open', now, now)
    )
    ntype = 'critical' if data['severity'] == 'Critical' else 'warning' if data['severity'] == 'High' else 'info'
    msg = f"🚨 CRITICAL: Complaint {cid} from {pname} requires immediate attention!" if data['severity'] == 'Critical' else f"📋 New {data['severity']} complaint {cid} submitted by {pname}"
    nid = 'N-' + str(uuid.uuid4())[:8]
    db.execute("INSERT INTO notifications (id, message, type) VALUES (?,?,?)", (nid, msg, ntype))
    db.commit()
    return jsonify({'success': True, 'complaint_id': cid})

@app.route('/api/complaints/<cid>', methods=['PATCH'])
def update_complaint(cid):
    db = get_db()
    data = request.json
    db.execute("UPDATE complaints SET status=?, updated_at=? WHERE id=?",
        (data['status'], datetime.now(), cid))
    if data['status'] == 'Resolved':
        complaint = db.execute("SELECT patient_name FROM complaints WHERE id=?", (cid,)).fetchone()
        nid = 'N-' + str(uuid.uuid4())[:8]
        db.execute("INSERT INTO notifications (id, message, type) VALUES (?,?,?)",
            (nid, f"✅ Complaint {cid} resolved for patient {complaint['patient_name']}", 'success'))
    db.commit()
    return jsonify({'success': True})

# Analytics
@app.route('/api/analytics')
def analytics():
    db = get_db()
    dept_complaints = db.execute("SELECT department, COUNT(*) as count FROM complaints GROUP BY department").fetchall()
    severity_dist = db.execute("SELECT severity, COUNT(*) as count FROM complaints GROUP BY severity").fetchall()
    status_dist = db.execute("SELECT status, COUNT(*) as count FROM complaints GROUP BY status").fetchall()
    monthly = []
    for i in range(6):
        d = datetime.now() - timedelta(days=30*(5-i))
        yr, mo = d.year, d.month
        count = db.execute("SELECT COUNT(*) as c FROM complaints WHERE strftime('%Y', created_at)=? AND strftime('%m', created_at)=?",
            (str(yr), f'{mo:02d}')).fetchone()['c']
        monthly.append({'month': d.strftime('%b'), 'count': count})
    avg_res_time = db.execute("""
        SELECT AVG((julianday(updated_at) - julianday(created_at)) * 24) as avg_hours
        FROM complaints WHERE status='Resolved'
    """).fetchone()
    avg_h = round(avg_res_time['avg_hours'] or 0, 1)
    return jsonify({
        'dept_complaints': [dict(r) for r in dept_complaints],
        'severity_dist': [dict(r) for r in severity_dist],
        'status_dist': [dict(r) for r in status_dist],
        'monthly': monthly,
        'avg_resolution_hours': avg_h,
    })

# Notifications
@app.route('/api/notifications')
def get_notifications():
    db = get_db()
    notifs = db.execute("SELECT * FROM notifications ORDER BY created_at DESC LIMIT 20").fetchall()
    unread = db.execute("SELECT COUNT(*) as c FROM notifications WHERE read=0").fetchone()['c']
    return jsonify({'notifications': [dict(n) for n in notifs], 'unread': unread})

@app.route('/api/notifications/read', methods=['POST'])
def mark_read():
    db = get_db()
    db.execute("UPDATE notifications SET read=1")
    db.commit()
    return jsonify({'success': True})

# Settings
@app.route('/api/settings', methods=['GET'])
def get_settings():
    db = get_db()
    rows = db.execute("SELECT * FROM settings").fetchall()
    return jsonify({r['key']: r['value'] for r in rows})

@app.route('/api/settings', methods=['POST'])
def update_settings():
    db = get_db()
    data = request.json
    for key, val in data.items():
        db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)", (key, str(val)))
    db.commit()
    return jsonify({'success': True})

# Admin
@app.route('/api/admin/clear', methods=['POST'])
def clear_data():
    db = get_db()
    data = request.json
    target = data.get('target', '')
    if target == 'complaints':
        db.execute("DELETE FROM complaints")
        db.execute("DELETE FROM notifications")
    elif target == 'patients':
        db.execute("DELETE FROM patients")
        db.execute("DELETE FROM complaints")
        db.execute("DELETE FROM notifications")
    elif target == 'notifications':
        db.execute("DELETE FROM notifications")
    db.commit()
    return jsonify({'success': True})

@app.route('/api/admin/status')
def system_status():
    db = get_db()
    pt = db.execute("SELECT COUNT(*) as c FROM patients").fetchone()['c']
    cp = db.execute("SELECT COUNT(*) as c FROM complaints").fetchone()['c']
    nt = db.execute("SELECT COUNT(*) as c FROM notifications").fetchone()['c']
    db_size = os.path.getsize(DATABASE) if os.path.exists(DATABASE) else 0
    return jsonify({
        'db_status': 'Online',
        'ai_status': 'Active',
        'api_status': 'Operational',
        'patients': pt, 'complaints': cp, 'notifications': nt,
        'db_size_kb': round(db_size / 1024, 2),
        'uptime': '99.97%',
        'last_backup': (datetime.now() - timedelta(hours=2)).strftime('%Y-%m-%d %H:%M'),
    })

# AI Chatbot
@app.route('/api/chat', methods=['POST'])
def chat():
    data = request.json
    message = data.get('message', '').lower()
    
    responses = {
        'emergency': ("🚨 For emergencies, go directly to our Emergency Department (Level 1). Call 911 immediately for life-threatening situations.", 'critical'),
        'cardio': ("❤️ Our Cardiology Department is on Floor 3. For chest pain or heart concerns, please visit immediately or call ext. 3200.", 'info'),
        'appointment': ("📅 To schedule an appointment, call our central booking at ext. 1000 or use the Patient Portal online. Same-day appointments may be available.", 'info'),
        'pharmacy': ("💊 The hospital pharmacy is located on Level 1, near the main entrance. Hours: 7AM–9PM daily.", 'info'),
        'billing': ("💳 For billing inquiries, visit the Finance Office on Level 2 or call ext. 2500. We accept most major insurance plans.", 'info'),
        'parking': ("🅿️ Patient parking is available in Garage B. First 2 hours free with validation at the information desk.", 'info'),
        'wifi': ("📶 Free WiFi is available hospital-wide. Network: HospitalGuest, Password: Welcome2024", 'info'),
        'visiting': ("👥 Visiting hours are 8AM–8PM daily. ICU visits are limited; please check with the nursing station.", 'info'),
        'pain': ("⚠️ If experiencing pain, please notify the nursing staff immediately via the call button or inform the front desk. Do not ignore severe pain.", 'warning'),
        'children': ("👶 Our Pediatrics Department is on Floor 4, Wing B. We have specialized staff for patients under 18.", 'info'),
        'mental': ("🧠 Mental health support is available through our Psychiatry Department on Floor 5. Crisis support: ext. 5500, 24/7.", 'info'),
    }

    response_text = None
    response_type = 'info'
    
    for keyword, (resp, rtype) in responses.items():
        if keyword in message:
            response_text = resp
            response_type = rtype
            break

    if not response_text:
        if any(w in message for w in ['hello', 'hi', 'hey']):
            response_text = "👋 Hello! I'm MedAssist AI, your hospital virtual assistant. I can help you navigate departments, find services, and answer general questions. How can I assist you today?"
        elif any(w in message for w in ['thank', 'thanks']):
            response_text = "😊 You're welcome! Is there anything else I can help you with? Your health and comfort are our priority."
        elif any(w in message for w in ['help', 'assist']):
            response_text = "🏥 I can help you with: department locations, appointment scheduling, visiting hours, parking, pharmacy, billing, and general hospital navigation. What do you need?"
        elif any(w in message for w in ['doctor', 'physician']):
            response_text = "👨‍⚕️ To reach a specific doctor, please contact the relevant department or call the main switchboard at ext. 0. Attending physicians can be paged through the nursing station."
        elif any(w in message for w in ['wait', 'waiting']):
            response_text = "⏱️ Current average wait time in Emergency is approximately 25–40 minutes. For non-urgent matters, scheduled appointments have priority. Complimentary water and seating available."
        else:
            response_text = f"🤖 I understand you asked about '{data.get('message', '')}'. For detailed assistance, please contact our Patient Services team at ext. 1800 or visit the Information Desk in the main lobby."

    return jsonify({'response': response_text, 'type': response_type, 'timestamp': datetime.now().strftime('%H:%M')})

if __name__ == '__main__':
    init_db()
    app.run(debug=True, port=5000)
