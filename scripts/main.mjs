import { VgbndBrowserDialog }    from "./browser-dialog.mjs";
import { VgbndUnresolvedDialog } from "./unresolved-dialog.mjs";
import { VgbndSpellDialog }      from "./spell-dialog.mjs";
import { VgbndMapper }           from "./mapper.mjs";
import { VgbndFirebase }         from "./firebase.mjs";
import { exportActorToPdf }      from "./export.mjs";

// Re-export for external use / debugging
export { VgbndBrowserDialog, VgbndUnresolvedDialog, VgbndSpellDialog, VgbndMapper, VgbndFirebase, exportActorToPdf };

Hooks.once("init", () => {
  console.log("vgbnd-importer | Initialised");

  // Store Firebase session per-client (not synced to other players)
  game.settings.register("vgbnd-importer", "firebase-session", {
    scope:   "client",
    config:  false,
    type:    String,
    default: "",
  });

  game.settings.register("vgbnd-importer", "export-template", {
    name:    "VGBND.SettingExportTemplateName",
    hint:    "VGBND.SettingExportTemplateHint",
    scope:   "client",
    config:  true,
    type:    String,
    choices: {
      "interactive":       "VGBND.SettingExportTemplateInteractive",
      "interactive-light": "VGBND.SettingExportTemplateInteractiveLight",
    },
    default: "interactive",
  });
});

Hooks.on("renderActorDirectory", (_app, html, _data) => {
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root) return;

  const target = root.querySelector(".directory-footer")
    ?? root.querySelector("footer")
    ?? root.querySelector(".header-actions");
  if (!target) return;

  const browseBtn = document.createElement("button");
  browseBtn.type = "button";
  browseBtn.classList.add("vgbnd-import-btn");
  browseBtn.innerHTML = `<i class="fa-solid fa-users"></i> ${game.i18n.localize("VGBND.SidebarBrowseButton")}`;
  browseBtn.addEventListener("click", () => new VgbndBrowserDialog().render(true));
  target.prepend(browseBtn);
});
