use crate::{db::AppDb, storage_paths::safe_username_dir_segment};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};
use tauri::State;
use uuid::Uuid;

pub fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS bdf_reservations (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subject_id TEXT NOT NULL,
        session INTEGER NOT NULL,
        task TEXT NOT NULL,
        run_index INTEGER NOT NULL,
        path TEXT NOT NULL UNIQUE,
        PRIMARY KEY(user_id, subject_id, session, task, run_index)
    );",
    )
    .map_err(|_| "无法初始化 BDF 路径预留表。".into())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReservationInput {
    user_id: String,
    subject_id: String,
    kind: String,
    condition: Option<String>,
    method: Option<String>,
    session: Option<u16>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Destination {
    path: String,
    file_name: String,
    run_index: u32,
}

impl ReservationInput {
    fn task(&self) -> Result<&'static str, String> {
        match (
            self.kind.as_str(),
            self.condition.as_deref(),
            self.method.as_deref(),
        ) {
            ("personal_calibration", _, _) => Ok("calibration"),
            ("held_out_generation", _, _) => Ok("induction"),
            ("effect_evaluation", Some("natural_recovery"), _) => Ok("effectbaseline"),
            ("effect_evaluation", Some("regulation"), Some("music")) => Ok("effectmusic"),
            ("effect_evaluation", Some("regulation"), Some("video")) => Ok("effectvideo"),
            _ => Err("请先选择有效的实验范式、条件和调控方式。".into()),
        }
    }
}

fn subject_label(subject: &str) -> Result<String, String> {
    let label = subject.strip_prefix("sub-").unwrap_or(subject);
    if label.is_empty()
        || label.len() > 64
        || !label
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Err("被试编号仅支持字母、数字、中文、短横线或下划线，且不能超过 64 字节。".into());
    }
    // BIDS labels are ASCII alphanumeric. Escape labels outside that alphabet
    // losslessly so punctuation and non-ASCII identifiers cannot collapse.
    if label.bytes().all(|b| b.is_ascii_alphanumeric()) && !label.starts_with("x0") {
        Ok(label.into())
    } else {
        let hex: String = label
            .as_bytes()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        Ok(format!("x0{hex}"))
    }
}

fn ensure_directory(parent: &Path, name: &str) -> Result<PathBuf, String> {
    let path = parent.join(name);
    match fs::create_dir(&path) {
        Ok(()) => {}
        Err(e) if e.kind() == ErrorKind::AlreadyExists => {}
        Err(_) => return Err("无法在桌面创建数据目录，请检查文件夹权限。".into()),
    }
    let meta = fs::symlink_metadata(&path).map_err(|_| "无法读取数据目录。")?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err("数据目录不能是链接或联接点。".into());
        }
    }
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("数据目录不存在或是链接。".into());
    }
    Ok(path)
}

fn reserve(
    conn: &Connection,
    desktop: &Path,
    input: ReservationInput,
) -> Result<Destination, String> {
    let owner = Uuid::parse_str(&input.user_id).map_err(|_| "请重新登录后预留保存位置。")?;
    let subject = input.subject_id.trim();
    let label = subject_label(subject)?;
    let task = input.task()?;
    let session = input.session.unwrap_or(1);
    if session == 0 || !desktop.is_absolute() {
        return Err("无效的场次或桌面路径。".into());
    }
    let tx = rusqlite::Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Immediate)
        .map_err(|_| "无法开始预留记录。")?;
    let username: String = tx
        .query_row(
            "SELECT username FROM users WHERE id=?1",
            [&input.user_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|_| "无法读取账号信息。")?
        .ok_or("账号不存在，请重新登录。")?;
    // Established lab accounts already have Desktop/EEG数据集/sub-001.
    // Only this case-sensitive canonical spelling uses the short directory;
    // e.g. "SUB-001" still gets its own UUID-qualified directory on Windows.
    let account = if username.strip_prefix("sub-").is_some_and(|code| {
        !code.is_empty() && code.len() <= 32 && code.bytes().all(|c| c.is_ascii_digit())
    }) {
        username
    } else {
        let display = safe_username_dir_segment(&username).unwrap_or_else(|_| "account".into());
        format!("{}_{owner}", display.chars().take(24).collect::<String>())
    };
    let dataset = ensure_directory(desktop, "EEG数据集")?;
    let account_dir = ensure_directory(&dataset, &account)?;
    let subject_segment = format!("sub-{label}");
    let subject_dir = if account == subject_segment {
        account_dir
    } else {
        ensure_directory(&account_dir, &subject_segment)?
    };
    let session_dir = ensure_directory(&subject_dir, &format!("ses-{session:02}"))?;
    let eeg = ensure_directory(&session_dir, "eeg")?;

    // SQLite remembers previous reservations even if their folders were moved.
    // Atomic directory creation also protects files created outside the app.
    let previous: u32 = tx
        .query_row(
            "SELECT COALESCE(MAX(run_index),0) FROM bdf_reservations
        WHERE user_id=? AND subject_id=? AND session=? AND task=?",
            params![input.user_id, subject, session, task],
            |r| r.get(0),
        )
        .map_err(|_| "无法读取上次记录编号。")?;
    let mut run_index = previous;
    loop {
        run_index = run_index.checked_add(1).ok_or("记录编号已超过上限。")?;
        let run = format!("task-{task}_run-{run_index:02}");
        let dir = eeg.join(&run);
        let file_name = format!("sub-{label}_ses-{session:02}_{run}_eeg.bdf");
        let path = dir
            .join(&file_name)
            .to_str()
            .ok_or("无法显示录制路径。")?
            .to_owned();
        if cfg!(windows) && path.encode_utf16().count() >= 260 {
            return Err(
                "录制路径超过 ActiView 可用的常规 Windows 路径长度，请缩短被试编号。".into(),
            );
        }
        match fs::create_dir(&dir) {
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("无法预留本次录制目录。".into()),
            Ok(()) => {}
        }
        let result = tx.execute("INSERT INTO bdf_reservations (user_id,subject_id,session,task,run_index,path) VALUES (?,?,?,?,?,?)",
            params![input.user_id, subject, session, task, run_index, path])
            .and_then(|_| tx.commit());
        if result.is_err() {
            // Remove only our empty directory. Never remove an ActiView file.
            let _ = fs::remove_dir(&dir);
            return Err("无法保存路径预留，请重试。".into());
        }
        return Ok(Destination {
            path,
            file_name,
            run_index,
        });
    }
}

#[tauri::command]
pub async fn reserve_bdf_destination(
    state: State<'_, AppDb>,
    input: ReservationInput,
) -> Result<Destination, String> {
    let db = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let desktop = dirs::desktop_dir().ok_or("无法定位当前 Windows 桌面。")?;
        db.with_conn(|conn| reserve(conn, &desktop, input))
    })
    .await
    .map_err(|_| "预留 BDF 保存位置失败。")?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    const OWNER: &str = "00000000-0000-4000-8000-000000000001";
    const OTHER: &str = "00000000-0000-4000-8000-000000000002";

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let p = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("target")
                .join(format!("bdf-{}", Uuid::new_v4().as_simple()));
            fs::create_dir(&p).unwrap();
            let fixture = Self(p);
            let conn = fixture.connect();
            conn.execute_batch("CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT NOT NULL)")
                .unwrap();
            init(&conn).unwrap();
            for (id, username) in [(OWNER, "sub-001"), (OTHER, "SUB-001")] {
                conn.execute("INSERT INTO users VALUES(?,?)", params![id, username])
                    .unwrap();
            }
            fixture
        }

        fn connect(&self) -> Connection {
            let db = Connection::open(self.0.join("fixture.sqlite")).unwrap();
            db.busy_timeout(Duration::from_secs(5)).unwrap();
            db
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn input() -> ReservationInput {
        ReservationInput {
            user_id: OWNER.into(),
            subject_id: "sub-001".into(),
            kind: "effect_evaluation".into(),
            condition: Some("natural_recovery".into()),
            method: Some("music".into()),
            session: None,
        }
    }

    #[test]
    fn assigns_contextual_file_names_and_separates_accounts() {
        let f = Fixture::new();
        let db = f.connect();
        for (kind, condition, method, expected) in [
            (
                "effect_evaluation",
                "natural_recovery",
                "music",
                "effectbaseline",
            ),
            ("effect_evaluation", "regulation", "music", "effectmusic"),
            ("effect_evaluation", "regulation", "video", "effectvideo"),
            ("personal_calibration", "", "", "calibration"),
            ("held_out_generation", "", "", "induction"),
        ] {
            let i = ReservationInput {
                kind: kind.into(),
                condition: Some(condition.into()),
                method: Some(method.into()),
                ..input()
            };
            let result = reserve(&db, &f.0, i).unwrap();
            assert_eq!(
                result.file_name,
                format!("sub-001_ses-01_task-{expected}_run-01_eeg.bdf")
            );
            assert!(!Path::new(&result.path).exists());
            assert!(Path::new(&result.path).parent().unwrap().is_dir());
        }
        let second = reserve(&db, &f.0, input()).unwrap();
        assert_eq!(second.run_index, 2);
        fs::remove_dir(Path::new(&second.path).parent().unwrap()).unwrap();
        assert_eq!(reserve(&db, &f.0, input()).unwrap().run_index, 3);
        let other = reserve(
            &db,
            &f.0,
            ReservationInput {
                user_id: OTHER.into(),
                ..input()
            },
        )
        .unwrap();
        assert_eq!(other.run_index, 1);
        assert!(other.path.contains(OTHER));
    }

    #[test]
    fn serializes_two_concurrent_reservations_without_overwriting_existing_folders() {
        let f = Fixture::new();
        let first = reserve(&f.connect(), &f.0, input()).unwrap();
        let eeg_dir = Path::new(&first.path).parent().unwrap().parent().unwrap();
        fs::create_dir(eeg_dir.join("task-effectbaseline_run-02")).unwrap();
        std::thread::scope(|scope| {
            let reserve_next = || reserve(&f.connect(), &f.0, input()).unwrap().run_index;
            let a = scope.spawn(reserve_next);
            let b = scope.spawn(reserve_next);
            let mut indices = [a.join().unwrap(), b.join().unwrap()];
            indices.sort();
            assert_eq!(indices, [3, 4]);
        });
    }

    #[test]
    fn rejects_invalid_inputs_and_unknown_users_before_reserving() {
        let f = Fixture::new();
        let db = f.connect();
        for i in [
            ReservationInput {
                user_id: Uuid::new_v4().to_string(),
                ..input()
            },
            ReservationInput {
                subject_id: "../untrusted".into(),
                ..input()
            },
            ReservationInput {
                session: Some(0),
                ..input()
            },
            ReservationInput {
                condition: Some("regulation".into()),
                method: None,
                ..input()
            },
        ] {
            assert!(reserve(&db, &f.0, i).is_err());
        }
        assert!(!f.0.join("EEG数据集").exists());
        assert_ne!(subject_label("A-B").unwrap(), subject_label("AB").unwrap());
    }
}
