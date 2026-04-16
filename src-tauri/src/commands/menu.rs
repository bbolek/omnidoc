//! Build and install the native application menu from a definition supplied
//! by the frontend.
//!
//! The frontend serializes its `APP_MENU` tree (resolving command labels,
//! shortcuts, and `when` gates) and calls `set_app_menu`. We translate that
//! tree into Tauri's menu primitives and attach a single click handler that
//! emits the original command id back to the frontend via the `menu:invoke`
//! event. The frontend then dispatches through its registry, so the round
//! trip stays narrow and stateless on the Rust side.
//!
//! Used on macOS only — Windows/Linux render an in-window menu bar from
//! the same definition.

use serde::Deserialize;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Wry};

use crate::{log_debug, log_error};

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SerializedNode {
    Command {
        id: String,
        label: String,
        accelerator: Option<String>,
        enabled: bool,
    },
    Submenu {
        label: String,
        items: Vec<SerializedNode>,
    },
    Separator,
}

#[derive(Debug, Deserialize)]
pub struct SerializedSubmenu {
    pub label: String,
    pub items: Vec<SerializedNode>,
}

#[derive(Debug, Deserialize)]
pub struct SerializedMenu {
    pub menus: Vec<SerializedSubmenu>,
}

/// Build and install the menu. The click handler that emits `menu:invoke`
/// is registered once at app startup in `lib.rs` (via `Builder::on_menu_event`)
/// — this command only swaps the visible menu definition.
#[tauri::command]
pub async fn set_app_menu(app: AppHandle, menu: SerializedMenu) -> Result<(), String> {
    log_debug!(
        "menu::set_app_menu",
        "installing menu with {} top-level submenus",
        menu.menus.len()
    );
    let mut top = MenuBuilder::new(&app);

    for sub in &menu.menus {
        let submenu = build_submenu(&app, &sub.label, &sub.items).map_err(|e| {
            log_error!("menu::set_app_menu", "build submenu {}: {}", sub.label, e);
            format!("build submenu '{}': {e}", sub.label)
        })?;
        top = top.item(&submenu);
    }

    let built = top.build().map_err(|e| {
        log_error!("menu::set_app_menu", "build menu: {}", e);
        format!("build menu: {e}")
    })?;

    app.set_menu(built).map_err(|e| {
        log_error!("menu::set_app_menu", "install menu: {}", e);
        format!("install menu: {e}")
    })?;

    Ok(())
}

fn build_submenu(
    app: &AppHandle,
    label: &str,
    items: &[SerializedNode],
) -> Result<tauri::menu::Submenu<Wry>, tauri::Error> {
    let mut sb = SubmenuBuilder::new(app, label);
    for node in items {
        match node {
            SerializedNode::Command {
                id,
                label,
                accelerator,
                enabled,
            } => {
                let mut item = MenuItemBuilder::with_id(id.clone(), label).enabled(*enabled);
                if let Some(acc) = accelerator {
                    item = item.accelerator(acc);
                }
                let built = item.build(app)?;
                sb = sb.item(&built);
            }
            SerializedNode::Submenu { label, items } => {
                let nested = build_submenu(app, label, items)?;
                sb = sb.item(&nested);
            }
            SerializedNode::Separator => {
                let sep = PredefinedMenuItem::separator(app)?;
                sb = sb.item(&sep);
            }
        }
    }
    sb.build()
}
