import { invoke } from "@tauri-apps/api/core";

export async function exportToHtml(contentHtml: string, destPath: string): Promise<void> {
  await invoke("export_html", { html: contentHtml, path: destPath });
}

export function printToPdf(): void {
  window.print();
}
