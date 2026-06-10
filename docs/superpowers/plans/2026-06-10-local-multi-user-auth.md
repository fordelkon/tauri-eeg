# Local Multi-User Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local multi-user registration and login backed by SQLite, then show the active username at the bottom of the sidebar.

**Architecture:** Tauri Rust owns database access, password hashing, and authentication commands. React calls Tauri commands through a small auth API and keeps only the public active-user profile in context plus `localStorage` for first-version refresh persistence.

**Tech Stack:** Tauri 2, Rust, `rusqlite`, `argon2`, `uuid`, `chrono`, React 18, React Router 7, MUI.

---

## File Structure

- Modify `src-tauri/Cargo.toml`: add SQLite, hashing, UUID, time, and app-data path dependencies.
- Create `src-tauri/src/auth.rs`: testable auth service, user schema, password hashing, command payload types.
- Create `src-tauri/src/db.rs`: app data database path, SQLite initialization, table creation.
- Modify `src-tauri/src/lib.rs`: initialize database state and expose auth commands.
- Create `src/auth/types.ts`: shared frontend auth types.
- Create `src/auth/api.ts`: typed wrappers around Tauri `invoke`.
- Create `src/auth/AuthContext.tsx`: current-user state, sign in, sign up, sign out.
- Create `src/auth/ProtectedRoute.tsx`: route guard for authenticated pages.
- Modify `src/App.tsx`: wrap routes with `AuthProvider` and protect app routes.
- Modify `src/pages/Login.tsx`: replace hardcoded login with auth context calls.
- Modify `src/pages/Home.tsx`: read current user and add sidebar footer sign-out UI.
- Modify `src/pages/Home.module.css`: style sidebar footer.

---

### Task 1: Add Backend Dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add dependencies**

Add these lines under `[dependencies]`:

```toml
argon2 = "0.5"
chrono = { version = "0.4", features = ["serde"] }
dirs = "6"
rand_core = { version = "0.6", features = ["std"] }
rusqlite = { version = "0.32", features = ["bundled"] }
uuid = { version = "1", features = ["v4", "serde"] }
```

- [ ] **Step 2: Verify dependency resolution**

Run:

```bash
cd src-tauri
cargo check
```

Expected: it may fail because the code does not use the dependencies yet only if dependency resolution fails. If dependency resolution succeeds, continue.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(auth): add local auth dependencies"
```

---

### Task 2: Build Testable Auth Service

**Files:**
- Create: `src-tauri/src/auth.rs`

- [ ] **Step 1: Create failing backend tests and service shell**

Create `src-tauri/src/auth.rs`:

```rust
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::Utc;
use rand_core::OsRng;
use rusqlite::{params, Connection, Error as SqlError};
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub id: String,
    pub username: String,
}

pub fn register_user_record(
    conn: &Connection,
    username: &str,
    password: &str,
) -> Result<UserProfile, String> {
    let username = normalize_username(username)?;
    validate_password(password)?;

    let existing = find_user_by_username(conn, &username)?;
    if existing.is_some() {
        return Err("Username is already registered.".to_string());
    }

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let password_hash = hash_password(password)?;

    conn.execute(
        "INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, username, password_hash, now, now],
    )
    .map_err(|_| "Failed to register user.".to_string())?;

    Ok(UserProfile { id, username })
}

pub fn login_user_record(
    conn: &Connection,
    username: &str,
    password: &str,
) -> Result<UserProfile, String> {
    let username = normalize_username(username)?;
    let Some(user) = find_user_by_username(conn, &username)? else {
        return Err("Account or password is incorrect.".to_string());
    };

    if verify_password(password, &user.password_hash)? {
        return Ok(UserProfile {
            id: user.id,
            username: user.username,
        });
    }

    Err("Account or password is incorrect.".to_string())
}

struct StoredUser {
    id: String,
    username: String,
    password_hash: String,
}

fn normalize_username(username: &str) -> Result<String, String> {
    let username = username.trim().to_string();

    if username.is_empty() {
        return Err("Username and password are required.".to_string());
    }

    Ok(username)
}

fn validate_password(password: &str) -> Result<(), String> {
    if password.len() < 6 {
        return Err("Password must be at least 6 characters.".to_string());
    }

    Ok(())
}

fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| "Failed to secure password.".to_string())
}

fn verify_password(password: &str, password_hash: &str) -> Result<bool, String> {
    let parsed_hash = PasswordHash::new(password_hash)
        .map_err(|_| "Failed to verify password.".to_string())?;

    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

fn find_user_by_username(
    conn: &Connection,
    username: &str,
) -> Result<Option<StoredUser>, String> {
    let result = conn.query_row(
        "SELECT id, username, password_hash FROM users WHERE username = ?1",
        params![username],
        |row| {
            Ok(StoredUser {
                id: row.get(0)?,
                username: row.get(1)?,
                password_hash: row.get(2)?,
            })
        },
    );

    match result {
        Ok(user) => Ok(Some(user)),
        Err(SqlError::QueryReturnedNoRows) => Ok(None),
        Err(_) => Err("Failed to load user.".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory sqlite");
        conn.execute(
            "CREATE TABLE users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )
        .expect("create users table");
        conn
    }

    #[test]
    fn registers_multiple_users_with_unique_ids() {
        let conn = setup_conn();

        let alice = register_user_record(&conn, "alice", "123456").expect("register alice");
        let bob = register_user_record(&conn, "bob", "123456").expect("register bob");

        assert_eq!(alice.username, "alice");
        assert_eq!(bob.username, "bob");
        assert_ne!(alice.id, bob.id);
    }

    #[test]
    fn rejects_duplicate_usernames() {
        let conn = setup_conn();

        register_user_record(&conn, "alice", "123456").expect("register alice");
        let result = register_user_record(&conn, "alice", "123456");

        assert_eq!(result.unwrap_err(), "Username is already registered.");
    }

    #[test]
    fn logs_in_with_correct_password() {
        let conn = setup_conn();
        let created = register_user_record(&conn, "alice", "123456").expect("register alice");

        let logged_in = login_user_record(&conn, "alice", "123456").expect("login alice");

        assert_eq!(logged_in, created);
    }

    #[test]
    fn rejects_wrong_password() {
        let conn = setup_conn();
        register_user_record(&conn, "alice", "123456").expect("register alice");

        let result = login_user_record(&conn, "alice", "wrong-password");

        assert_eq!(result.unwrap_err(), "Account or password is incorrect.");
    }

    #[test]
    fn stores_password_hash_instead_of_plaintext() {
        let conn = setup_conn();
        register_user_record(&conn, "alice", "123456").expect("register alice");

        let stored: String = conn
            .query_row(
                "SELECT password_hash FROM users WHERE username = ?1",
                params!["alice"],
                |row| row.get(0),
            )
            .expect("load hash");

        assert_ne!(stored, "123456");
        assert!(stored.starts_with("$argon2"));
    }
}
```

- [ ] **Step 2: Run tests**

Run:

```bash
cd src-tauri
cargo test auth
```

Expected: PASS for all `auth` tests.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/auth.rs
git commit -m "feat(auth): add local user auth service"
```

---

### Task 3: Initialize SQLite Database and Commands

**Files:**
- Create: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create database module**

Create `src-tauri/src/db.rs`:

```rust
use rusqlite::Connection;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

pub struct AppDb {
    pub conn: Mutex<Connection>,
}

pub fn init_app_db() -> Result<AppDb, String> {
    let db_path = app_db_path()?;
    let parent = db_path
        .parent()
        .ok_or_else(|| "Failed to resolve database directory.".to_string())?;

    fs::create_dir_all(parent)
        .map_err(|_| "Failed to create database directory.".to_string())?;

    let conn = Connection::open(db_path)
        .map_err(|_| "Failed to open database.".to_string())?;

    init_schema(&conn)?;

    Ok(AppDb {
        conn: Mutex::new(conn),
    })
}

fn app_db_path() -> Result<PathBuf, String> {
    let base = dirs::data_local_dir()
        .ok_or_else(|| "Failed to resolve local app data directory.".to_string())?;

    Ok(base.join("tauri-eeg").join("users.sqlite3"))
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )
    .map_err(|_| "Failed to initialize database schema.".to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_users_table() {
        let conn = Connection::open_in_memory().expect("open in-memory sqlite");

        init_schema(&conn).expect("init schema");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'users'",
                [],
                |row| row.get(0),
            )
            .expect("query sqlite schema");

        assert_eq!(count, 1);
    }

    #[test]
    fn app_db_path_uses_local_app_directory() {
        let path = app_db_path().expect("resolve db path");

        assert!(path.ends_with(Path::new("tauri-eeg").join("users.sqlite3")));
    }
}
```

- [ ] **Step 2: Wire commands in `lib.rs`**

Replace `src-tauri/src/lib.rs` with:

```rust
mod auth;
mod db;

use auth::UserProfile;
use db::AppDb;
use tauri::State;

#[tauri::command]
fn register_user(
    state: State<'_, AppDb>,
    username: String,
    password: String,
) -> Result<UserProfile, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable.".to_string())?;

    auth::register_user_record(&conn, &username, &password)
}

#[tauri::command]
fn login_user(
    state: State<'_, AppDb>,
    username: String,
    password: String,
) -> Result<UserProfile, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "Database is unavailable.".to_string())?;

    auth::login_user_record(&conn, &username, &password)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_db = db::init_app_db().expect("failed to initialize app database");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(app_db)
        .invoke_handler(tauri::generate_handler![register_user, login_user])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Run backend tests**

Run:

```bash
cd src-tauri
cargo test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/lib.rs
git commit -m "feat(auth): initialize local user database"
```

---

### Task 4: Add Frontend Auth API and Context

**Files:**
- Create: `src/auth/types.ts`
- Create: `src/auth/api.ts`
- Create: `src/auth/AuthContext.tsx`

- [ ] **Step 1: Create frontend auth types**

Create `src/auth/types.ts`:

```ts
export type UserProfile = {
  id: string;
  username: string;
};
```

- [ ] **Step 2: Create Tauri command wrappers**

Create `src/auth/api.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';
import type { UserProfile } from './types';

export async function loginUser(username: string, password: string): Promise<UserProfile> {
  return invoke<UserProfile>('login_user', { username, password });
}

export async function registerUser(username: string, password: string): Promise<UserProfile> {
  return invoke<UserProfile>('register_user', { username, password });
}
```

- [ ] **Step 3: Create auth context**

Create `src/auth/AuthContext.tsx`:

```tsx
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from 'react';
import { loginUser, registerUser } from './api';
import type { UserProfile } from './types';

type AuthContextValue = {
  currentUser: UserProfile | null;
  signIn: (username: string, password: string) => Promise<UserProfile>;
  signOut: () => void;
  signUp: (username: string, password: string) => Promise<UserProfile>;
};

const STORAGE_KEY = 'tauri-eeg.currentUser';

const AuthContext = createContext<AuthContextValue | null>(null);

const loadStoredUser = (): UserProfile | null => {
  const value = window.localStorage.getItem(STORAGE_KEY);

  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as UserProfile;

    if (typeof parsed.id === 'string' && typeof parsed.username === 'string') {
      return parsed;
    }
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
  }

  return null;
};

const storeUser = (user: UserProfile) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() => loadStoredUser());

  const value = useMemo<AuthContextValue>(() => ({
    currentUser,
    signIn: async (username, password) => {
      const user = await loginUser(username, password);

      setCurrentUser(user);
      storeUser(user);

      return user;
    },
    signOut: () => {
      setCurrentUser(null);
      window.localStorage.removeItem(STORAGE_KEY);
    },
    signUp: async (username, password) => {
      const user = await registerUser(username, password);

      setCurrentUser(user);
      storeUser(user);

      return user;
    },
  }), [currentUser]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return value;
}
```

- [ ] **Step 4: Type-check**

Run:

```bash
npm run build
```

Expected: TypeScript build succeeds or fails only because routes are not wired yet. Fix type errors before continuing.

- [ ] **Step 5: Commit**

```bash
git add src/auth/types.ts src/auth/api.ts src/auth/AuthContext.tsx
git commit -m "feat(auth): add frontend auth context"
```

---

### Task 5: Protect Routes

**Files:**
- Create: `src/auth/ProtectedRoute.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create protected route component**

Create `src/auth/ProtectedRoute.tsx`:

```tsx
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';

export default function ProtectedRoute() {
  const { currentUser } = useAuth();

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
```

- [ ] **Step 2: Wrap app routes**

Update `src/App.tsx` to:

```tsx
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import Login from './pages/Login';
import Home from './pages/Home';
import NotFound from './pages/NotFound';
import EegAcquisition from './pages/home/EegAcquisition';
import GameRegulation from './pages/home/GameRegulation';
import HomeOverview from './pages/home/HomeOverview';
import MusicRegulation from './pages/home/MusicRegulation';
import VideoRegulation from './pages/home/VideoRegulation';

function LoginRoute() {
  const { currentUser } = useAuth();

  if (currentUser) {
    return <Navigate to="/home" replace />;
  }

  return <Login />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Home />}>
          <Route path="/home" element={<HomeOverview />} />
          <Route path="/eeg-acquisition" element={<EegAcquisition />} />
          <Route path="/video-regulation" element={<VideoRegulation />} />
          <Route path="/game-regulation" element={<GameRegulation />} />
          <Route path="/music-regulation" element={<MusicRegulation />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppRoutes />
      </Router>
    </AuthProvider>
  );
}

export default App;
```

- [ ] **Step 3: Build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/auth/ProtectedRoute.tsx src/App.tsx
git commit -m "feat(auth): protect authenticated routes"
```

---

### Task 6: Connect Login and Registration UI

**Files:**
- Modify: `src/pages/Login.tsx`

- [ ] **Step 1: Import auth context**

Add this import:

```ts
import { useAuth } from '../auth/AuthContext';
```

Inside `Login`, add:

```ts
const { signIn, signUp } = useAuth();
const [errorMessage, setErrorMessage] = useState('Account or password is incorrect.');
const [isSubmitting, setIsSubmitting] = useState(false);
```

- [ ] **Step 2: Replace submit handler**

Replace `handleAuthSubmit` with:

```ts
const handleAuthSubmit = async (e: React.FormEvent) => {
  e.preventDefault();

  if (isSubmitting) {
    return;
  }

  const username = account.trim();

  if (!username || !password || (isSignup && password !== confirmPassword)) {
    setErrorMessage(
      isSignup && password !== confirmPassword
        ? 'Passwords do not match.'
        : 'Username and password are required.',
    );
    setHasError(true);
    return;
  }

  setIsSubmitting(true);

  try {
    const user = isSignup
      ? await signUp(username, password)
      : await signIn(username, password);
    const bounds = leftPanelRef.current?.getBoundingClientRect();

    if (bounds) {
      setExitStyle({
        '--exit-height': `${bounds.height}px`,
        '--exit-left': `${bounds.left}px`,
        '--exit-top': `${bounds.top}px`,
        '--exit-width': `${bounds.width}px`,
      } as CSSProperties);
    }

    setHasError(false);
    setIsExiting(true);
    window.setTimeout(() => {
      navigate('/home');
    }, 940);
  } catch (error) {
    setErrorMessage(typeof error === 'string' ? error : 'Account or password is incorrect.');
    setHasError(true);
    setIsShaking(false);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setIsShaking(true);
      });
    });
  } finally {
    setIsSubmitting(false);
  }
};
```

Remove any unused `user` variable if TypeScript reports it. The successful auth call updates context before navigation.

- [ ] **Step 3: Reset error message on mode change**

In `handleModeChange`, add:

```ts
setErrorMessage('Account or password is incorrect.');
```

- [ ] **Step 4: Update error text and submit disabled state**

Change the login-only error paragraph to render for both modes:

```tsx
<p className={`${styles.errorMsg} pl-2px`}>{errorMessage}</p>
```

Set the submit button disabled state:

```tsx
disabled={isSubmitting}
```

Use the button label:

```tsx
{isSubmitting ? 'Please wait...' : isSignup ? 'Sign Up' : 'Sign In'}
```

- [ ] **Step 5: Build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Login.tsx
git commit -m "feat(auth): connect login form to local auth"
```

---

### Task 7: Add Sidebar User Footer

**Files:**
- Modify: `src/pages/Home.tsx`
- Modify: `src/pages/Home.module.css`

- [ ] **Step 1: Import logout icon and auth context**

In `src/pages/Home.tsx`, add:

```ts
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import { useAuth } from '../auth/AuthContext';
```

Inside `Home`, add:

```ts
const { currentUser, signOut } = useAuth();
```

Add a sign-out handler:

```ts
const handleSignOut = () => {
  signOut();
  navigate('/login', { replace: true });
};
```

- [ ] **Step 2: Add sidebar footer JSX**

Inside the `<aside>` after `</List>` and before `</aside>`, add:

```tsx
<div className={styles.userFooter}>
  <div className={styles.userAvatar} aria-hidden="true">
    {currentUser?.username.charAt(0).toUpperCase() ?? 'U'}
  </div>
  <div className={styles.userMeta}>
    <span className={styles.userLabel}>Signed in</span>
    <span className={styles.userName}>{currentUser?.username ?? 'User'}</span>
  </div>
  <IconButton
    className={styles.signOutButton}
    aria-label="Sign out"
    size="small"
    onClick={handleSignOut}
  >
    <LogoutRoundedIcon fontSize="small" />
  </IconButton>
</div>
```

- [ ] **Step 3: Add footer CSS**

Add to `src/pages/Home.module.css` after `.navList`:

```css
.userFooter {
  align-items: center;
  border-top: 1px solid rgba(44, 34, 24, 0.1);
  display: flex;
  gap: 10px;
  margin-top: auto;
  min-height: 64px;
  padding-top: 16px;
}

.userAvatar {
  align-items: center;
  background: #2c2218;
  border-radius: 999px;
  color: #f5f0eb;
  display: inline-flex;
  flex: 0 0 auto;
  font-size: 14px;
  font-weight: 760;
  height: 38px;
  justify-content: center;
  text-transform: uppercase;
  width: 38px;
}

.userMeta {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
}

.userLabel {
  color: rgba(44, 34, 24, 0.5);
  font-size: 11px;
  font-weight: 680;
  letter-spacing: 0.04em;
  line-height: 1.2;
  text-transform: uppercase;
}

.userName {
  color: #2c2218;
  font-size: 14px;
  font-weight: 720;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.signOutButton {
  border-radius: 8px;
  color: rgba(44, 34, 24, 0.7);
  flex: 0 0 auto;
  height: 36px;
  width: 36px;
}

.signOutButton:hover {
  background: rgba(44, 34, 24, 0.08);
  color: #2c2218;
}
```

- [ ] **Step 4: Build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Home.tsx src/pages/Home.module.css
git commit -m "feat(auth): show current user in sidebar"
```

---

### Task 8: End-to-End Verification

**Files:**
- No file changes expected.

- [ ] **Step 1: Run full frontend build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 2: Run backend tests**

Run:

```bash
cd src-tauri
cargo test
```

Expected: PASS.

- [ ] **Step 3: Run Tauri app**

Run:

```bash
npm run tauri dev
```

Expected: app opens on `/login`.

- [ ] **Step 4: Manual verification**

In the app:

1. Sign up with username `alice` and password `123456`.
2. Confirm navigation to `/home`.
3. Open sidebar and confirm footer shows `alice`.
4. Sign out and confirm app returns to `/login`.
5. Sign up with username `bob` and password `123456`.
6. Confirm sidebar footer shows `bob`.
7. Sign out.
8. Sign in as `alice` with password `wrong-password`.
9. Confirm login fails.
10. Sign in as `alice` with password `123456`.
11. Confirm sidebar footer shows `alice`.
12. Attempt to sign up with username `alice` again.
13. Confirm duplicate registration fails.

- [ ] **Step 5: Final commit if verification fixes were needed**

If verification required fixes:

```bash
git add src src-tauri
git commit -m "fix(auth): polish local auth flow"
```

If no fixes were needed, do not create an empty commit.
