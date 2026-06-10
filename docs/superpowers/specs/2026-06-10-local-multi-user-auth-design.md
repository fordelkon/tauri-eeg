# Local Multi-User Auth Design

## Goal

Build a local multi-user registration and login flow for the Tauri desktop app. User records are stored in a local SQLite database, and the active user's name is shown at the bottom of the sidebar after login.

## Scope

This first version includes:

- Multiple local users.
- User registration with unique usernames.
- User login with password verification.
- Password storage as a hash, not plaintext.
- Frontend current-user state.
- Protected app routes.
- Sidebar footer showing the current username.
- Sign out.

This first version excludes:

- Password recovery.
- Remote sync.
- User roles.
- Avatars.
- Admin user management.
- Long-lived server-style sessions.

## Architecture

Authentication logic lives in the Tauri Rust backend. The React frontend calls Tauri commands and never reads or writes the user database directly.

SQLite stores user records in the app data directory. Rust initializes the database on startup and creates the `users` table if it does not exist. Passwords are hashed with Argon2 before storage and verified with Argon2 during login.

The frontend stores only the active user's public profile in React state and `localStorage` for first-version refresh persistence. The stored frontend profile contains only `id` and `username`.

## Database Schema

Table: `users`

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Public user profile returned to React:

```ts
type UserProfile = {
  id: string;
  username: string;
};
```

## Tauri Commands

The backend exposes these commands:

```rust
register_user(username: String, password: String) -> Result<UserProfile, String>
login_user(username: String, password: String) -> Result<UserProfile, String>
```

Registration behavior:

- Trim username before validation.
- Reject empty usernames.
- Reject passwords shorter than 6 characters.
- Reject duplicate usernames with a user-facing error.
- Hash the password before insert.
- Return the new user's public profile.

Login behavior:

- Trim username before lookup.
- Reject unknown username or wrong password with the same generic error.
- Return the user's public profile on success.

## Frontend Auth State

React owns the active-user state through an `AuthContext`.

The context exposes:

```ts
type AuthContextValue = {
  currentUser: UserProfile | null;
  signIn: (username: string, password: string) => Promise<UserProfile>;
  signUp: (username: string, password: string) => Promise<UserProfile>;
  signOut: () => void;
};
```

On successful sign in or sign up:

- Save the public profile to state.
- Save the public profile to `localStorage`.
- Navigate to `/home`.

On sign out:

- Clear state.
- Remove the saved profile from `localStorage`.
- Navigate to `/login`.

## Routing

Protected routes include:

- `/home`
- `/eeg-acquisition`
- `/video-regulation`
- `/game-regulation`
- `/music-regulation`

If no current user is available, protected routes redirect to `/login`.

If a current user visits `/login`, the page redirects to `/home`.

## Sidebar Display

The sidebar footer shows:

- A compact circular avatar placeholder derived from the username initial.
- The current username.
- A sign-out icon button.

The footer sits inside the existing sidebar and uses `margin-top: auto` so it remains at the bottom below navigation items.

## Error Handling

Frontend errors are shown through the existing login form error styling. The initial copy can stay generic:

- Login: `Account or password is incorrect.`
- Registration duplicate: `Username is already registered.`
- Registration validation: `Username and password are required.`

Backend command errors are converted to stable user-facing strings. Internal database or hashing errors are not exposed in detail.

## Testing

Manual verification for the first version:

- Register user `alice` with password `123456`.
- Register user `bob` with password `123456`.
- Confirm duplicate `alice` registration fails.
- Confirm `alice` can log in.
- Confirm wrong password fails.
- Confirm sidebar footer shows `alice`.
- Sign out and confirm protected routes redirect to `/login`.
- Sign in as `bob` and confirm sidebar footer changes to `bob`.

Automated tests should cover backend registration/login behavior if the Rust command layer is structured for testable service functions.

## Open Decisions

Registration should log the user in immediately after success. This keeps the first version simple and matches the current single-submit flow.
