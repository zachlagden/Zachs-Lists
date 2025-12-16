# lists.zachlagden.uk - Development Setup

## Prerequisites

- Python 3.10+
- Node.js 18+
- MongoDB 6+
- Git

---

## 1. MongoDB Setup

### Start MongoDB (if not running)
```bash
sudo systemctl start mongod
```

### Create Database and User
```bash
mongosh
```

```javascript
// Switch to the database
use pihole_lists

// Create user with readWrite permissions
db.createUser({
  user: "pihole_lists_user",
  pwd: "your_secure_password_here",
  roles: [
    { role: "readWrite", db: "pihole_lists" }
  ]
})

// Create indexes for better performance
db.users.createIndex({ "github_id": 1 }, { unique: true })
db.users.createIndex({ "username": 1 }, { unique: true })
db.jobs.createIndex({ "job_id": 1 }, { unique: true })
db.jobs.createIndex({ "user_id": 1, "created_at": -1 })
db.cache_metadata.createIndex({ "url_hash": 1 }, { unique: true })
db.analytics.createIndex({ "list_type": 1, "list_name": 1, "date": 1 })
db.analytics.createIndex({ "username": 1, "date": 1 })
db.featured_lists.createIndex({ "display_order": 1 })

// Verify
show collections
exit
```

### Test Connection
```bash
mongosh "mongodb://pihole_lists_user:your_secure_password_here@localhost:27017/pihole_lists"
```

---

## 2. Backend Setup

### Create Virtual Environment
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
```

### Install Dependencies
```bash
pip install -r requirements.txt
```

### Configure Environment
```bash
cp .env.example .env
```

Edit `.env`:
```env
SECRET_KEY=generate-a-random-secret-key-here
MONGO_URI=mongodb://pihole_lists_user:your_secure_password_here@localhost:27017/pihole_lists
GITHUB_CLIENT_ID=your_github_oauth_client_id
GITHUB_CLIENT_SECRET=your_github_oauth_client_secret
GITHUB_REDIRECT_URI=http://localhost:5173/api/auth/callback
ADMIN_USERNAME=your_github_username
DATA_DIR=/opt/webapps/zml/lists.zachlagden.uk/data
FRONTEND_URL=http://localhost:5173
```

### Create Data Directories
```bash
sudo mkdir -p /opt/webapps/zml/lists.zachlagden.uk/data/{cache,users,default/config,default/output}
sudo chown -R $USER:$USER /opt/webapps/zml/lists.zachlagden.uk/data
```

### Run Backend
```bash
source venv/bin/activate
flask run --debug --port 5000
```

---

## 3. Frontend Setup

### Install Dependencies
```bash
cd frontend
npm install
```

### Configure Environment (optional)
```bash
cp .env.example .env
```

The default config proxies API requests to `localhost:5000`, so no changes needed for dev.

### Run Frontend
```bash
npm run dev
```

Frontend runs at: http://localhost:5173

---

## 4. GitHub OAuth App Setup

1. Go to https://github.com/settings/developers
2. Click "New OAuth App"
3. Fill in:
   - **Application name**: Pi-hole Lists (Dev)
   - **Homepage URL**: `http://localhost:5173`
   - **Authorization callback URL**: `http://localhost:5173/api/auth/callback`
4. Copy Client ID and Client Secret to your `.env`

---

## 5. Quick Start Commands

### Terminal 1 - Backend
```bash
cd /opt/webapps/zml/lists.zachlagden.uk/backend
source venv/bin/activate
flask run --debug --port 5000
```

### Terminal 2 - Frontend
```bash
cd /opt/webapps/zml/lists.zachlagden.uk/frontend
npm run dev
```

### Open Browser
http://localhost:5173

---

## 6. Useful Commands

### Reset Database
```bash
mongosh pihole_lists --eval "db.dropDatabase()"
```

### View Logs
```bash
# Backend logs appear in terminal
# MongoDB logs
sudo journalctl -u mongod -f
```

### Run Backend with Gunicorn (production-like)
```bash
gunicorn -w 4 -b 0.0.0.0:5000 wsgi:app
```

### Build Frontend for Production
```bash
cd frontend
npm run build
# Output in dist/
```

---

## Project Structure

```
lists.zachlagden.uk/
├── backend/
│   ├── app/
│   │   ├── blueprints/    # API routes
│   │   ├── models/        # MongoDB models
│   │   ├── services/      # Business logic
│   │   ├── scheduler/     # APScheduler tasks
│   │   └── utils/         # Validators, security
│   ├── requirements.txt
│   ├── wsgi.py
│   └── .env
├── frontend/
│   ├── src/
│   │   ├── pages/         # React pages
│   │   ├── components/    # Reusable components
│   │   ├── store/         # Zustand state
│   │   └── api/           # API client
│   └── package.json
└── data/
    ├── cache/             # Shared blocklist cache
    ├── users/             # Per-user data
    └── default/           # Default lists
```
