use super::{records, store, types::*};
use rusqlite::Connection;
use serde_json::Value;
use std::{
    io::Write,
    sync::{
        mpsc::{self, SyncSender},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

type Db = Arc<Mutex<Connection>>;
type Job = Box<dyn FnOnce(&mut Worker) -> Result<Value, String> + Send>;
pub fn write_code<W: Write + ?Sized>(writer: &mut W, code: u8) -> std::io::Result<()> {
    // Windows FlushFileBuffers ignores serial write timeouts. A completed write
    // means the driver accepted the byte; receipt must still be checked in BDF.
    writer.write_all(&[code])
}
fn connection_error(name: &str, error: serialport::Error) -> String {
    if error.kind == serialport::ErrorKind::Io(std::io::ErrorKind::PermissionDenied) {
        format!("无法打开 {name}：访问被拒绝。请关闭其他 tauri-eeg 窗口和串口测试程序，仅保留一个应用后重试。若仍失败，请重新插拔触发盒并刷新端口。")
    } else {
        format!("连接 {name} 失败：{error}")
    }
}
#[derive(Clone)]
pub struct Service {
    tx: SyncSender<(Job, mpsc::Sender<Result<Value, String>>)>,
}
impl Service {
    pub fn new(db: Db) -> Self {
        let (tx, rx) = mpsc::sync_channel::<(Job, mpsc::Sender<Result<Value, String>>)>(64);
        std::thread::spawn(move || {
            let mut worker = Worker {
                db,
                port: None,
                status: Status::default(),
                active: None,
                last_write: None,
                received: None,
            };
            while let Ok((job, reply)) = rx.recv() {
                // A panicking job must not unwind the worker thread: the
                // serial port would stay open and every later command would
                // fail until app restart. Catch, reply with an error, and
                // keep serving.
                let result =
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| job(&mut worker)))
                        .unwrap_or_else(|_| {
                            Err(
                                "Trigger command failed unexpectedly; the worker has recovered."
                                    .to_string(),
                            )
                        });
                let _ = reply.send(result);
            }
        });
        Self { tx }
    }
    pub fn call<T: serde::de::DeserializeOwned>(&self, job: Job) -> Result<T, String> {
        let (tx, rx) = mpsc::channel();
        let received = (Instant::now(), now());
        let wrapped: Job = Box::new(move |worker| {
            worker.received = Some(received);
            job(worker)
        });
        self.tx
            .try_send((wrapped, tx))
            .map_err(|_| "Trigger command queue is full or unavailable.".to_string())?;
        let value = rx
            .recv()
            .map_err(|_| "Trigger worker stopped.".to_string())??;
        serde_json::from_value(value).map_err(|e| e.to_string())
    }
}
pub struct Worker {
    db: Db,
    port: Option<Box<dyn serialport::SerialPort>>,
    pub status: Status,
    active: Option<(Run, Instant)>,
    last_write: Option<Instant>,
    received: Option<(Instant, String)>,
}
pub fn value<T: serde::Serialize>(v: T) -> Result<Value, String> {
    serde_json::to_value(v).map_err(|e| e.to_string())
}
impl Worker {
    pub fn list_runs(&self, user_id: Option<String>) -> Result<Value, String> {
        let conn = self.db.lock().map_err(|_| "Database unavailable")?;
        value(records::list(&conn, user_id.as_deref())?)
    }
    pub fn record_detail(&self, run_id: String) -> Result<Value, String> {
        records::detail(
            &*self.db.lock().map_err(|_| "Database unavailable")?,
            &run_id,
        )
    }
    pub fn associate_bdf(&self, run_id: String, bdf_files: Vec<String>) -> Result<Value, String> {
        let conn = self.db.lock().map_err(|_| "Database unavailable")?;
        value(records::associate_bdf(&conn, &run_id, bdf_files)?)
    }
    pub fn save_trial(&self, run_id: String, trial: Value) -> Result<Value, String> {
        records::save_trial(
            &*self.db.lock().map_err(|_| "Database unavailable")?,
            &run_id,
            trial,
        )
    }
    pub fn link_scale(
        &self,
        run_id: String,
        record_id: String,
        measurement_time: String,
    ) -> Result<Value, String> {
        records::link_scale(
            &*self.db.lock().map_err(|_| "Database unavailable")?,
            &run_id,
            &record_id,
            &measurement_time,
        )?;
        Ok(Value::Null)
    }
    #[cfg(test)]
    pub fn set_active_mode_for_test(&mut self) {
        self.active.as_mut().unwrap().0.input.mode = "formal".into();
    }
    pub fn connect(&mut self, name: String) -> Result<Value, String> {
        self.idle()?;
        if name.trim().is_empty() {
            return Err("COM port is required.".into());
        }
        if self.port.is_some() && self.status.port_name.as_deref() == Some(name.as_str()) {
            return value(self.status.clone());
        }
        let port = serialport::new(&name, 115200)
            .data_bits(serialport::DataBits::Eight)
            .parity(serialport::Parity::None)
            .stop_bits(serialport::StopBits::One)
            .flow_control(serialport::FlowControl::None)
            .timeout(Duration::from_millis(500))
            .open()
            .map_err(|error| connection_error(&name, error))?;
        self.port = Some(port);
        self.status = Status {
            connected: true,
            port_name: Some(name),
            ..Status::default()
        };
        value(self.status.clone())
    }
    pub fn idle(&self) -> Result<(), String> {
        if self.active.is_some() {
            Err("Cannot change or test trigger during an experiment.".into())
        } else {
            Ok(())
        }
    }
    pub fn disconnect(&mut self) -> Result<Value, String> {
        self.idle()?;
        self.port = None;
        self.status = Status::default();
        value(self.status.clone())
    }
    pub fn pulse(&mut self, code: u8) -> Result<(), String> {
        if let Some(last) = self.last_write {
            let elapsed = last.elapsed();
            if elapsed < Duration::from_millis(12) {
                std::thread::sleep(Duration::from_millis(12) - elapsed);
            }
        }
        let port = self
            .port
            .as_mut()
            .ok_or("Trigger interface is disconnected.")?;
        let result = write_code(port.as_mut(), code);
        self.last_write = Some(Instant::now());
        if let Err(err) = result {
            self.port = None;
            self.status.connected = false;
            self.status.last_error = Some(err.to_string());
            return Err(err.to_string());
        }
        Ok(())
    }
    pub fn test(&mut self) -> Result<Value, String> {
        self.idle()?;
        self.pulse(254)?;
        value(self.status.clone())
    }
    pub fn start(&mut self, input: StartInput) -> Result<Value, String> {
        self.idle()?;
        if input.user_id.trim().is_empty() || input.subject_id.trim().is_empty() {
            return Err("User and subject are required.".into());
        }
        if ![
            "effect_evaluation",
            "personal_calibration",
            "held_out_generation",
        ]
        .contains(&input.kind.as_str())
        {
            return Err("Unsupported experiment kind.".into());
        }
        if !["formal", "rehearsal"].contains(&input.mode.as_str()) {
            return Err("Invalid experiment mode.".into());
        }
        if input.mode == "formal" && (!self.status.connected || !input.external_recording_confirmed)
        {
            return Err(
                "Connect the trigger interface and confirm external BDF recording first.".into(),
            );
        }
        if input
            .duration_minutes
            .is_some_and(|n| !n.is_finite() || !(1.0..=30.0).contains(&n))
        {
            return Err("Duration must be 1–30 minutes.".into());
        }
        if input.kind == "effect_evaluation"
            && (![Some("anxiety"), Some("depression"), Some("fear")]
                .contains(&input.emotion.as_deref())
                || ![Some("natural_recovery"), Some("regulation")]
                    .contains(&input.condition.as_deref())
                || ![Some("music"), Some("video")].contains(&input.method.as_deref()))
        {
            return Err("Invalid effect evaluation parameters.".into());
        }
        let run = Run {
            run_id: uuid::Uuid::new_v4().to_string(),
            external_recording_confirmed_at: if input.external_recording_confirmed {
                Some(now())
            } else {
                None
            },
            input,
            status: "running".into(),
            started_at: now(),
            ended_at: None,
            protocol_version: "external_bdf_v1".into(),
            event_mapping_version: "biosemi_events_v1".into(),
            bdf_files: vec![],
        };
        store::save_run(&*self.db.lock().map_err(|_| "Database unavailable")?, &run)?;
        self.status.active_run_id = Some(run.run_id.clone());
        self.active = Some((run.clone(), Instant::now()));
        self.emit(self.internal(&run.run_id, "run_start"))?;
        value(run)
    }
    fn internal(&self, run_id: &str, event: &str) -> EventInput {
        EventInput {
            event_id: format!("{run_id}:{event}"),
            run_id: run_id.into(),
            event: event.into(),
            phase_instance_id: format!("{run_id}:lifecycle"),
            trial_id: None,
            media_id: None,
            software_time_ms: None,
            source: Some("backend".into()),
            details: None,
        }
    }
    pub fn emit(&mut self, input: EventInput) -> Result<Value, String> {
        let (received, received_at) = self
            .received
            .clone()
            .unwrap_or_else(|| (Instant::now(), now()));
        let existing = store::event(
            &*self.db.lock().map_err(|_| "Database unavailable")?,
            &input.event_id,
        )?;
        if let Some(existing) = existing {
            if store::json(&existing.input)? != store::json(&input)? {
                return Err("Event ID reused with different contents.".into());
            }
            if ["failed", "unknown", "pending"].contains(&existing.result.as_str()) {
                return Err("Previous send failed or is unknown; it will not be resent.".into());
            }
            return value(existing);
        }
        let (run, origin) = self.active.as_ref().ok_or("No active experiment.")?;
        if run.run_id != input.run_id || run.status != "running" {
            return Err("Experiment is inactive or interrupted.".into());
        }
        if input.event_id.trim().is_empty() || input.phase_instance_id.trim().is_empty() {
            return Err("Event and phase IDs are required.".into());
        }
        if input
            .software_time_ms
            .is_some_and(|t| !t.is_finite() || t < 0.0)
        {
            return Err("Invalid software timestamp.".into());
        }
        let mapped = code(&input.event)?;
        let rehearsal = run.input.mode == "rehearsal";
        super::validation::validate(
            &*self.db.lock().map_err(|_| "Database unavailable")?,
            run,
            &input,
        )?;
        let count: u64 = self
            .db
            .lock()
            .map_err(|_| "Database unavailable")?
            .query_row(
                "SELECT COUNT(*) FROM experiment_events WHERE run_id=?1",
                [&input.run_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        let mut event = Event {
            input,
            sequence: count + 1,
            code: mapped,
            received_at,
            backend_elapsed_ms: origin.elapsed().as_secs_f64() * 1000.0,
            write_started_at: None,
            write_finished_at: None,
            queue_wait_ms: None,
            result: if rehearsal { "rehearsal" } else { "pending" }.into(),
            error: None,
        };
        // Persist the unique intention before any hardware side effect.
        store::save_event(
            &*self.db.lock().map_err(|_| "Database unavailable")?,
            &event,
        )?;
        if !rehearsal {
            if let Some(last) = self.last_write {
                let elapsed = last.elapsed();
                if elapsed < Duration::from_millis(12) {
                    std::thread::sleep(Duration::from_millis(12) - elapsed);
                }
            }
            event.write_started_at = Some(now());
            event.queue_wait_ms = Some(received.elapsed().as_secs_f64() * 1000.0);
            match self.pulse(mapped) {
                Ok(()) => event.result = "written".into(),
                Err(error) => {
                    event.result = "failed".into();
                    event.error = Some(error);
                }
            }
            event.write_finished_at = Some(now());
            let persisted = {
                let conn = self.db.lock().map_err(|_| "Database unavailable")?;
                store::save_event(&conn, &event)
            };
            if let Err(error) = persisted {
                self.interrupt()?;
                return Err(format!("Pulse outcome is unknown: {error}"));
            }
            if event.result == "failed" {
                self.interrupt()?;
                return Err(format!(
                    "Trigger send failed: {}",
                    event.error.as_deref().unwrap_or("unknown")
                ));
            }
        }
        value(event)
    }
    fn interrupt(&mut self) -> Result<(), String> {
        if let Some((mut run, _)) = self.active.take() {
            run.status = "interrupted".into();
            run.ended_at = Some(now());
            store::save_run(&*self.db.lock().map_err(|_| "Database unavailable")?, &run)?;
        }
        self.status.active_run_id = None;
        Ok(())
    }
    pub fn finish(&mut self, id: String, reason: Option<String>) -> Result<Value, String> {
        let saved = store::run(&*self.db.lock().map_err(|_| "Database unavailable")?, &id)?;
        if saved.status != "running" {
            return value(saved);
        }
        let (run, _) = self.active.as_ref().ok_or("No active experiment.")?;
        if run.run_id != id {
            return Err("Run mismatch.".into());
        }
        let aborted = reason.is_some();
        let mut event = self.internal(&id, if aborted { "run_abort" } else { "run_end" });
        event.details = reason.map(|r| serde_json::json!({"reason":r}));
        self.emit(event)?;
        let (mut run, _) = self.active.take().ok_or("Experiment interrupted.")?;
        run.status = if aborted { "aborted" } else { "completed" }.into();
        run.ended_at = Some(now());
        store::save_run(&*self.db.lock().map_err(|_| "Database unavailable")?, &run)?;
        self.status.active_run_id = None;
        value(run)
    }
}

#[cfg(test)]
mod queue_tests {
    use super::*;
    #[test]
    fn denied_port_explains_how_to_release_exclusive_access() {
        let error = connection_error(
            "COM5",
            serialport::Error::new(
                serialport::ErrorKind::Io(std::io::ErrorKind::PermissionDenied),
                "Access is denied.",
            ),
        );
        assert_eq!(error, "无法打开 COM5：访问被拒绝。请关闭其他 tauri-eeg 窗口和串口测试程序，仅保留一个应用后重试。若仍失败，请重新插拔触发盒并刷新端口。");
    }
    #[test]
    fn saturated_queue_returns_error_without_waiting_or_dropping_silently() {
        let (tx, _receiver) = mpsc::sync_channel(1);
        let (reply, _reply_rx) = mpsc::channel();
        tx.send((Box::new(|_: &mut Worker| Ok(Value::Null)) as Job, reply))
            .unwrap();
        let service = Service { tx };
        let result = service.call::<Value>(Box::new(|_| Ok(Value::Null)));
        assert_eq!(
            result.unwrap_err(),
            "Trigger command queue is full or unavailable."
        );
    }
}
