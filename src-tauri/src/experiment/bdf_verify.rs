use std::{fs::OpenOptions, io::Read, path::Path};

fn number(field: &[u8]) -> Result<u64, String> {
    std::str::from_utf8(field)
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .ok_or_else(|| "BDF 文件头尚未完成或格式有误。请先在 ActiView 停止保存。".into())
}

/// Finalized BioSemi BDFs declare their record count; each sample is 24 bits.
pub fn verify(path: &Path) -> Result<(), String> {
    if !path.is_absolute()
        || !path
            .extension()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.eq_ignore_ascii_case("bdf"))
    {
        return Err("请选择完整路径的 BDF 文件。".into());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(1); // FILE_SHARE_READ: reject an existing writable handle.
    }
    let mut file = options
        .open(path)
        .map_err(|_| "无法读取 BDF。请先在 ActiView 停止保存，并核对文件位置。")?;
    let mut base = [0u8; 256];
    file.read_exact(&mut base)
        .map_err(|_| "BDF 文件头不完整。")?;
    if &base[..8] != b"\xffBIOSEMI" {
        return Err("所选文件不是 BioSemi BDF。".into());
    }
    let channels = number(&base[252..256])? as usize;
    let header = number(&base[184..192])?;
    let records = number(&base[236..244])?;
    if channels == 0 || channels > 4096 || header != ((channels + 1) * 256) as u64 || records == 0 {
        return Err("BDF 尚未完成或文件头有误。".into());
    }
    let mut signals = vec![0u8; channels * 256];
    file.read_exact(&mut signals)
        .map_err(|_| "BDF 通道信息不完整。")?;
    let samples = signals[216 * channels..224 * channels]
        .chunks_exact(8)
        .try_fold(0u64, |sum, field| {
            let n = number(field)?;
            if n == 0 {
                return Err("BDF 通道采样数无效。".to_string());
            }
            sum.checked_add(n)
                .ok_or_else(|| "BDF 通道采样数无效。".to_string())
        })?;
    let expected = samples
        .checked_mul(3)
        .and_then(|v| v.checked_mul(records))
        .and_then(|v| v.checked_add(header));
    if expected
        != Some(
            file.metadata()
                .map_err(|_| "无法读取 BDF 文件长度。")?
                .len(),
        )
    {
        return Err("BDF 实际长度与文件头不一致，请确认已正常结束保存。".into());
    }
    Ok(())
}
