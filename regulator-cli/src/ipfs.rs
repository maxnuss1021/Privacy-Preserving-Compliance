use anyhow::{Context, Result};
use reqwest::multipart;
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct AddResponse {
    pub name: String,
    pub hash: String,
    pub size: String,
}

/// Upload multiple files to IPFS wrapped in a directory.
///
/// Returns the `AddResponse` for the wrapping directory (whose CID covers all
/// the files).  The individual file responses are discarded.
pub async fn add_directory(ipfs_rpc_url: &str, files: &[&Path]) -> Result<AddResponse> {
    let mut form = multipart::Form::new();

    for file_path in files {
        let file_name = file_path
            .file_name()
            .context("file path has no file name")?
            .to_string_lossy()
            .to_string();

        let file_bytes = tokio::fs::read(file_path)
            .await
            .with_context(|| format!("failed to read file: {}", file_path.display()))?;

        let part = multipart::Part::bytes(file_bytes).file_name(file_name);
        form = form.part("file", part);
    }

    let url = format!(
        "{}/api/v0/add?wrap-with-directory=true",
        ipfs_rpc_url.trim_end_matches('/')
    );

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .multipart(form)
        .send()
        .await
        .with_context(|| format!("failed to upload files to IPFS at {url}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        anyhow::bail!("IPFS add failed (HTTP {status} from {url}): {body}");
    }

    // The response is newline-delimited JSON: one object per file, then one
    // for the wrapping directory (Name == "").
    let body = response
        .text()
        .await
        .context("failed to read IPFS add response body")?;

    let mut dir_entry: Option<AddResponse> = None;
    for line in body.lines() {
        let entry: AddResponse =
            serde_json::from_str(line).with_context(|| format!("bad IPFS JSON line: {line}"))?;
        if entry.name.is_empty() {
            dir_entry = Some(entry);
        }
    }

    dir_entry.context("IPFS response did not include a directory wrapper entry")
}

/// Upload a single file to IPFS (no directory wrapping).
///
/// Returns the `AddResponse` for the uploaded file.
pub async fn add_file(ipfs_rpc_url: &str, file_path: &Path) -> Result<AddResponse> {
    let file_name = file_path
        .file_name()
        .context("file path has no file name")?
        .to_string_lossy()
        .to_string();

    let file_bytes = tokio::fs::read(file_path)
        .await
        .with_context(|| format!("failed to read file: {}", file_path.display()))?;

    let part = multipart::Part::bytes(file_bytes).file_name(file_name);
    let form = multipart::Form::new().part("file", part);

    let url = format!(
        "{}/api/v0/add",
        ipfs_rpc_url.trim_end_matches('/')
    );

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .multipart(form)
        .send()
        .await
        .with_context(|| format!("failed to upload file to IPFS at {url}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        anyhow::bail!("IPFS add failed (HTTP {status} from {url}): {body}");
    }

    let body = response
        .text()
        .await
        .context("failed to read IPFS add response body")?;

    serde_json::from_str(body.trim()).context("failed to parse IPFS add response")
}
