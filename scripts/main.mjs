import { VgbndBrowserDialog }    from "./browser-dialog.mjs";
import { VgbndUnresolvedDialog } from "./unresolved-dialog.mjs";
import { VgbndMapper }           from "./mapper.mjs";
import { VgbndFirebase }         from "./firebase.mjs";
import { VgbndSync }             from "./sync.mjs";
import { exportActorToPdf }      from "./export.mjs";

// Re-export for external use / debugging
export { VgbndBrowserDialog, VgbndUnresolvedDialog, VgbndMapper, VgbndFirebase, VgbndSync, exportActorToPdf };

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

  game.settings.register("vgbnd-importer", "export-folder", {
    name:    "VGBND.SettingExportFolderName",
    hint:    "VGBND.SettingExportFolderHint",
    scope:   "client",
    config:  true,
    type:    String,
    default: "assets/vagabond/exports",
  });

  game.settings.register("vgbnd-importer", "dynamic-token-rings", {
    name:    "VGBND.SettingDTRName",
    hint:    "VGBND.SettingDTRHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  game.settings.register("vgbnd-importer", "dtr-subject-scale", {
    name:    "VGBND.SettingDTRScaleName",
    hint:    "VGBND.SettingDTRScaleHint",
    scope:   "world",
    config:  true,
    type:    Number,
    range:   { min: 0.5, max: 1.5, step: 0.05 },
    default: 0.8,
  });

  game.settings.register("vgbnd-importer", "use-cors-proxy", {
    name:    "VGBND.SettingUseCorsProxyName",
    hint:    "VGBND.SettingUseCorsProxyHint",
    scope:   "client",
    config:  true,
    type:    Boolean,
    default: false,
  });

  game.settings.register("vgbnd-importer", "cors-proxy-url", {
    name:    "VGBND.SettingCorsProxyUrlName",
    hint:    "VGBND.SettingCorsProxyUrlHint",
    scope:   "client",
    config:  true,
    type:    String,
    default: "https://api.codetabs.com/v1/proxy/?quest=",
  });
});

Hooks.on("updateActor", async (actor, changes) => {
  if (!game.user.isGM) return;
  if (!changes.ownership) return;
  if (!game.settings.get("vgbnd-importer", "dynamic-token-rings")) return;

  // Find the first non-GM user with full ownership after this update
  const owner = Object.entries(actor.ownership)
    .filter(([id, level]) => id !== "default" && level === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)
    .map(([id]) => game.users.get(id))
    .find(u => u && !u.isGM);

  if (!owner) return;

  const ringColor = owner.color?.toString() ?? "#ffffff";

  // Update prototypeToken so future placed tokens get the right color
  await actor.update({ "prototypeToken.ring.colors.ring": ringColor });

  // Update every placed token for this actor across all scenes
  for (const scene of game.scenes) {
    const tokens = scene.tokens.filter(t => t.actorId === actor.id && t.ring?.enabled);
    if (!tokens.length) continue;
    await scene.updateEmbeddedDocuments("Token", tokens.map(t => ({
      _id: t.id,
      "ring.colors.ring": ringColor,
    })));
  }
});

Hooks.on("renderActorDirectory", (_app, html, _data) => {
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root) return;

  const target = root.querySelector(".directory-footer")
    ?? root.querySelector("footer")
    ?? root.querySelector(".header-actions");
  if (!target) return;

  const syncBtn = document.createElement("button");
  syncBtn.type = "button";
  syncBtn.classList.add("vgbnd-sync-btn");
  syncBtn.innerHTML = `<i class="fa-solid fa-rotate-right"></i> ${game.i18n.localize("VGBND.SyncButton")}`;
  syncBtn.addEventListener("click", async () => {
    const actors = game.actors.filter(a => a.getFlag("vgbnd-importer", "firestoreId"));
    if (!actors.length) { ui.notifications.warn(game.i18n.localize("VGBND.SyncNoneFound")); return; }
    syncBtn.disabled = true;
    const orig = syncBtn.innerHTML;
    syncBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
    try {
      for (const a of actors) await VgbndSync.syncActor(a);
    } finally {
      syncBtn.disabled = false;
      syncBtn.innerHTML = orig;
    }
  });

  const browseBtn = document.createElement("button");
  browseBtn.type = "button";
  browseBtn.classList.add("vgbnd-import-btn");
  browseBtn.innerHTML = `<i class="fa-solid fa-users"></i> ${game.i18n.localize("VGBND.SidebarBrowseButton")}`;
  browseBtn.addEventListener("click", () => new VgbndBrowserDialog().render(true));
  target.prepend(browseBtn);
  browseBtn.before(syncBtn);
});

// ── Actor sheet header button: link/refresh from vgbnd.app ───────────────────
Hooks.on("renderActorSheet", (app, html, _data) => {
  if (!game.user.isGM) return;
  const actor = app.actor;
  if (!actor || actor.type !== "character") return;

  const root = html instanceof HTMLElement ? html : html[0];
  if (!root) return;

  // Find the header element. Try v2 ApplicationV2 selectors first, then v1.
  const titleBar = root.closest(".window-app")?.querySelector(".window-header")
                ?? root.querySelector(".window-header");
  if (!titleBar) return;
  if (titleBar.querySelector(".vgbnd-link-btn")) return; // already added

  const linked = !!actor.getFlag("vgbnd-importer", "firestoreId");
  const btn = document.createElement("a");
  btn.classList.add("header-control", "vgbnd-link-btn");
  btn.dataset.tooltip = linked
    ? game.i18n.localize("VGBND.ActorRefreshTooltip")
    : game.i18n.localize("VGBND.ActorLinkTooltip");
  btn.innerHTML = linked
    ? `<i class="fa-solid fa-rotate-right"></i>`
    : `<i class="fa-solid fa-link"></i>`;
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    btn.classList.add("disabled");
    const orig = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
    try {
      await VgbndBrowserDialog.syncFromVgbnd(actor);
    } catch (err) {
      console.warn("vgbnd-importer | Sync failed:", err);
      ui.notifications.error(`vgbnd-importer | Sync failed: ${err.message}`);
    } finally {
      btn.innerHTML = orig;
      btn.classList.remove("disabled");
    }
  });

  // Try to insert before the close button so it sits to the LEFT of the X.
  const closeBtn = titleBar.querySelector("[data-action='close'], .close, .header-control:last-child");
  if (closeBtn?.parentElement) {
    closeBtn.parentElement.insertBefore(btn, closeBtn);
  } else {
    titleBar.appendChild(btn);
  }
});
