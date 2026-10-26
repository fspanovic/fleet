use std::time::Duration;

use serde_json::{Value, json};

use crate::cli::brief::local_web_base;
use crate::core::hosts;
use crate::error::{Error, Result};

fn curl(base: &str, method: &str, path: &str, body: bool) -> std::process::Command {
    let mut c = std::process::Command::new("curl");
    c.args(["-sS", "--max-time", "20", "-X", method]);
    if body {
        c.args([
            "-H",
            "Content-Type: application/json",
            "--data-binary",
            "@-",
        ]);
    }
    c.args(["-w", "\n%{http_code}", &format!("{base}{path}")]);
    c
}

fn call(method: &str, path: &str, body: Option<Value>) -> Result<Option<Value>> {
    let base = local_web_base();
    let c = curl(&base, method, path, body.is_some());
    if hosts::dry_run() {
        println!("{}", hosts::display_command(&c));
        return Ok(None);
    }
    let input = body.map(|b| b.to_string());
    let got = hosts::capture_input(c, input.as_deref().map(str::as_bytes), Duration::from_secs(25))
        .map_err(|e| Error::Other(format!("{e} — curl is needed for fleet scratch")))?;
    let unreachable = || {
        Error::Other(format!(
            "cannot reach the web server at {base} — the scratchpad lives there (start it: fleet web serve)"
        ))
    };
    if got.code != Some(0) {
        return Err(unreachable());
    }
    let (text, status) = got
        .stdout
        .rsplit_once('\n')
        .map(|(b, s)| (b.to_string(), s.trim().to_string()))
        .unwrap_or_else(|| (String::new(), got.stdout.trim().to_string()));
    if status == "000" {
        return Err(unreachable());
    }
    let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if status != "200" {
        let msg = v["error"].as_str().unwrap_or(text.trim()).to_string();
        return Err(Error::Other(format!("scratchpad: {msg} (HTTP {status})")));
    }
    Ok(Some(v))
}

pub fn show(json: bool) -> Result<()> {
    let Some(v) = call("GET", "/api/scratchpad", None)? else {
        return Ok(());
    };
    if json {
        println!("{}", serde_json::to_string_pretty(&v)?);
        return Ok(());
    }
    let text = v["text"].as_str().unwrap_or("");
    if text.is_empty() {
        eprintln!("the scratchpad is empty");
    } else if text.ends_with('\n') {
        print!("{text}");
    } else {
        println!("{text}");
    }
    Ok(())
}

pub fn add(text: &str, json: bool) -> Result<()> {
    if text.trim().is_empty() {
        return Err(Error::Other("nothing to add: the text is blank".into()));
    }
    let Some(v) = call(
        "POST",
        "/api/scratchpad/append",
        Some(json!({ "text": text })),
    )?
    else {
        return Ok(());
    };
    if json {
        println!("{}", serde_json::to_string_pretty(&v)?);
    } else {
        println!("added to the scratchpad");
    }
    Ok(())
}
