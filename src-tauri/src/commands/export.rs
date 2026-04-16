use tokio::fs;

use crate::{log_error, log_info};

#[tauri::command]
pub async fn export_html(html: String, path: String) -> Result<(), String> {
    log_info!("export::export_html", "path={} html_bytes={}", path, html.len());
    let full_document = format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Exported Document</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css" />
  <style>
    body {{
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.7;
      max-width: 860px;
      margin: 0 auto;
      padding: 2rem;
      color: #1f2328;
      background: #fff;
    }}
    pre {{
      background: #f6f8fa;
      border-radius: 6px;
      padding: 1rem;
      overflow-x: auto;
    }}
    code {{
      font-family: 'Fira Code', 'Consolas', monospace;
      font-size: 0.875em;
    }}
    blockquote {{
      border-left: 4px solid #d0d7de;
      margin: 0;
      padding: 0 1rem;
      color: #57606a;
    }}
    table {{
      border-collapse: collapse;
      width: 100%;
    }}
    th, td {{
      border: 1px solid #d0d7de;
      padding: 6px 13px;
    }}
    th {{
      background: #f6f8fa;
      font-weight: 600;
    }}
    img {{
      max-width: 100%;
    }}
    hr {{
      border: none;
      border-top: 1px solid #d0d7de;
      margin: 2rem 0;
    }}
    a {{
      color: #0969da;
    }}
  </style>
</head>
<body>
{html}
</body>
</html>"#
    );

    fs::write(&path, full_document).await.map_err(|e| {
        log_error!("export::export_html", "write failed path={} err={}", path, e);
        format!("Failed to write file: {e}")
    })?;

    Ok(())
}
