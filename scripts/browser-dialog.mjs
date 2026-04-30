import { VgbndFirebase }        from "./firebase.mjs";
import { VgbndMapper }          from "./mapper.mjs";
import { VgbndUnresolvedDialog } from "./unresolved-dialog.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class VgbndBrowserDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id:      "vgbnd-browser-dialog",
    tag:     "div",
    classes: ["vgbnd-browser-dialog"],
    window:  { title: "VGBND.BrowserTitle", icon: "fa-solid fa-users", resizable: true },
    position: { width: 760, height: 560 },
    actions: {
      signIn:      VgbndBrowserDialog.#onSignIn,
      signOut:     VgbndBrowserDialog.#onSignOut,
      refresh:     VgbndBrowserDialog.#onRefresh,
      switchTab:   VgbndBrowserDialog.#onSwitchTab,
      selectGroup: VgbndBrowserDialog.#onSelectGroup,
      importChar:     VgbndBrowserDialog.#onImportChar,
      importGroup:    VgbndBrowserDialog.#onImportGroup,
      importSelected: VgbndBrowserDialog.#onImportSelected,
      urlOpenTab:  VgbndBrowserDialog.#onUrlOpenTab,
      urlImport:   VgbndBrowserDialog.#onUrlImport,
    },
  };

  static PARTS = {
    main: { template: "modules/vgbnd-importer/templates/browser-dialog.hbs" },
  };

  // ── State ──────────────────────────────────────────────────────────────────

  #view             = "login"; // "login" | "browser"
  #tab              = "mine";  // "mine"  | "group" | "url"
  #characters       = [];
  #groups           = [];
  #selectedGrpId    = null;
  #groupChars       = [];
  #error            = "";
  #loading          = false;
  #initDone         = false;   // guard so _onRender only auto-loads once
  #selectedCharIds  = new Set();
  #urlState         = { uuidInput: "", jsonText: "", fallbackVisible: false };

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async _prepareContext() {
    const isSignedIn = VgbndFirebase.isSignedIn();
    if (isSignedIn && this.#view === "login") this.#view = "browser";

    const selGroup = this.#groups.find(g => g.id === this.#selectedGrpId) ?? null;

    const fmtChars = this.#fmt(this.#characters).map(c => ({
      ...c,
      selected: this.#selectedCharIds.has(c.id),
    }));

    return {
      isSignedIn,
      isLogin:   this.#view === "login",
      isBrowser: this.#view === "browser",
      isMine:    this.#tab === "mine",
      isGroup:   this.#tab === "group",
      isUrl:     this.#tab === "url",
      loading:   this.#loading,
      error:     this.#error,
      characters:    fmtChars,
      groups:        this.#groups.map(g => ({ ...g, isSelected: g.id === this.#selectedGrpId })),
      selectedGroup: selGroup,
      groupChars:    this.#fmt(this.#groupChars),
      isGM:          game.user?.isGM ?? false,
      anySelected:   this.#selectedCharIds.size > 0,
      allSelected:   this.#selectedCharIds.size > 0 && this.#selectedCharIds.size === this.#characters.length,
      selectedCount: this.#selectedCharIds.size,
      urlInput:            this.#urlState.uuidInput,
      jsonInput:           this.#urlState.jsonText,
      jsonFallbackVisible: this.#urlState.fallbackVisible,
    };
  }

  _onRender(_ctx, _opts) {
    if (!this.#initDone && this.#view === "browser" && !this.#loading) {
      this.#initDone = true;
      this.#loadMyData();
    }

    // Card checkboxes
    this.element.querySelectorAll(".vgbnd-card-check").forEach(cb => {
      cb.addEventListener("change", e => {
        const uuid = e.currentTarget.dataset.uuid;
        if (e.currentTarget.checked) this.#selectedCharIds.add(uuid);
        else this.#selectedCharIds.delete(uuid);
        this.#captureUrlState();
        this.render();
      });
    });

    // Select-all checkbox
    const selectAll = this.element.querySelector(".vgbnd-select-all");
    if (selectAll) {
      selectAll.indeterminate = this.#selectedCharIds.size > 0 && this.#selectedCharIds.size < this.#characters.length;
      selectAll.addEventListener("change", e => {
        if (e.currentTarget.checked) this.#characters.forEach(c => this.#selectedCharIds.add(c.id));
        else this.#selectedCharIds.clear();
        this.#captureUrlState();
        this.render();
      });
    }
  }

  // Save in-flight URL-tab DOM values into #urlState so re-renders triggered by
  // tab switches, sign-in/out, refresh, etc. don't blank the user's typed input.
  #captureUrlState() {
    if (this.#tab !== "url") return;
    const uuidEl    = this.element?.querySelector("#vgbnd-uuid-input");
    const jsonEl    = this.element?.querySelector("#vgbnd-json-input");
    const sectionEl = this.element?.querySelector(".vgbnd-json-section");
    if (uuidEl)    this.#urlState.uuidInput       = uuidEl.value ?? "";
    if (jsonEl)    this.#urlState.jsonText        = jsonEl.value ?? "";
    if (sectionEl) this.#urlState.fallbackVisible = sectionEl.classList.contains("visible");
  }

  #showJsonFallback() {
    const section = this.element.querySelector(".vgbnd-json-section");
    section?.classList.add("visible");
    section?.querySelector("textarea")?.focus();
    this.#urlState.fallbackVisible = true;
    this.setPosition({ height: "auto" });
  }

  static extractUUID(input) {
    const match = input?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return match ? match[0] : null;
  }

  // ── Formatting ─────────────────────────────────────────────────────────────

  #fmt(chars) {
    return chars.map(c => {
      const level    = c.level ?? c.system?.attributes?.level?.value ?? "";
      const ancestry = c.ancestry ?? c.ancestryName ?? "";
      const cls      = c["class"] ?? c.className ?? "";
      const parts    = [level ? `Level ${level}` : null, ancestry, cls].filter(Boolean);
      const updated  = c._updateTime
        ? new Date(c._updateTime).toLocaleDateString() : "";
      const playerName = c.displayName ?? c.userName ?? c.userDisplayName ?? "";
      return {
        ...c,
        portrait: c.img || c.character_image_base64 || "icons/svg/mystery-man.svg",
        summary:  parts.join(" ") || "",
        updated,
        playerName,
      };
    });
  }

  // ── Data loading ───────────────────────────────────────────────────────────

  async #loadMyData() {
    this.#loading = true;
    this.#error   = "";
    this.#captureUrlState();
    this.render();
    try {
      const tok = await VgbndFirebase.getToken();
      if (!tok) { this.#view = "login"; return; }
      const [chars, groups] = await Promise.all([
        VgbndFirebase.listCharacters(tok.idToken, tok.uid),
        VgbndFirebase.listGroups(tok.idToken, tok.uid),
      ]);
      this.#characters = chars.sort((a, b) => (b._updateTime > a._updateTime ? 1 : -1));
      this.#groups     = groups;
    } catch (err) {
      this.#error = err.message;
      console.error("vgbnd-importer | list error", err);
    } finally {
      this.#loading = false;
      this.#captureUrlState();
      this.render();
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  static async #onSignIn() {
    const email    = this.element.querySelector("#vgbnd-email")?.value?.trim();
    const password = this.element.querySelector("#vgbnd-password")?.value;
    if (!email || !password) {
      this.#error = game.i18n.localize("VGBND.ErrorLoginMissing");
      this.#captureUrlState();
      this.render();
      return;
    }
    this.#error   = "";
    this.#loading = true;
    this.#captureUrlState();
    this.render();
    try {
      await VgbndFirebase.signIn(email, password);
      this.#view     = "browser";
      this.#initDone = true;
      await this.#loadMyData();
    } catch (err) {
      this.#error   = err.message;
      this.#loading = false;
      this.#captureUrlState();
      this.render();
    }
  }

  static #onSignOut() {
    this.#captureUrlState();
    VgbndFirebase.signOut();
    this.#view            = "login";
    this.#tab             = "mine";
    this.#characters      = [];
    this.#groups          = [];
    this.#selectedGrpId   = null;
    this.#groupChars      = [];
    this.#error           = "";
    this.#loading         = false;
    this.#initDone        = false;
    this.#selectedCharIds.clear();
    this.render();
  }

  static #onSwitchTab(_e, target) {
    this.#captureUrlState();
    this.#tab = target.dataset.tab;
    this.render();
  }

  static async #onRefresh() {
    this.#captureUrlState();
    this.#characters      = [];
    this.#groups          = [];
    this.#groupChars      = [];
    this.#selectedGrpId   = null;
    this.#error           = "";
    this.#initDone        = false;
    this.#selectedCharIds.clear();
    await this.#loadMyData();
  }

  static async #onSelectGroup(_e, target) {
    const groupId = target.dataset.groupId;
    this.#selectedGrpId = groupId;
    const group = this.#groups.find(g => g.id === groupId);
    if (!group?.members?.length) { this.#captureUrlState(); this.render(); return; }
    this.#loading = true;
    this.#captureUrlState();
    this.render();
    try {
      const tok = await VgbndFirebase.getToken();
      if (!tok) return;
      // memberCharacters = { uid: [charId, ...], ... } — flatten to charId array
      const memberChars = group.memberCharacters ?? {};
      const charIds = Object.values(memberChars).flat();
      const charToUid = Object.fromEntries(
        Object.entries(memberChars).flatMap(([uid, ids]) => ids.map(id => [id, uid]))
      );

      // Resolve display names for all member UIDs in parallel
      const allUids = Object.keys(memberChars);
      const nameEntries = await Promise.all(
        allUids.map(async uid => {
          if (uid === tok.uid) return [uid, tok.displayName ?? ""];
          const name = await VgbndFirebase.getUserDisplayName(tok.idToken, uid);
          return [uid, name ?? ""];
        })
      );
      const uidToName = Object.fromEntries(nameEntries);

      const chars = await VgbndFirebase.getGroupCharacters(tok.idToken, charIds);
      this.#groupChars = chars.map(c => {
        const ownerUid = charToUid[c.id] ?? c.userId ?? "";
        return { ...c, displayName: uidToName[ownerUid] ?? "" };
      });
    } catch (err) {
      this.#error = err.message;
    } finally {
      this.#loading = false;
      this.#captureUrlState();
      this.render();
    }
  }

  static async #onImportChar(_e, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid ?? target.dataset.uuid;
    if (!uuid) return;
    const btn = target.closest("button") ?? target;
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
    try {
      await VgbndBrowserDialog.#importByUuid(uuid);
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  }

  static async #onImportGroup() {
    if (!game.user?.isGM) return;
    const chars = this.#groupChars;
    if (!chars.length) return;
    for (const c of chars) await VgbndBrowserDialog.#importByUuid(c.id);
  }

  static async #onImportSelected() {
    const ids = [...this.#selectedCharIds];
    if (!ids.length) return;
    this.#selectedCharIds.clear();
    this.#captureUrlState();
    this.render();
    for (const id of ids) await VgbndBrowserDialog.#importByUuid(id);
  }

  // ── URL tab actions ─────────────────────────────────────────────────────────

  static #onUrlOpenTab() {
    const input = this.element.querySelector("#vgbnd-uuid-input")?.value?.trim() ?? "";
    const uuid  = VgbndBrowserDialog.extractUUID(input);
    if (!uuid) {
      ui.notifications.warn(game.i18n.localize("VGBND.ErrorInvalidUUID"));
      return;
    }
    window.open(`https://www.vgbnd.app/api/characters/${uuid}?format=foundry`, "_blank");
  }

  static async #onUrlImport() {
    const uuidInput = this.element.querySelector("#vgbnd-uuid-input")?.value?.trim() ?? "";
    const jsonText  = this.element.querySelector("#vgbnd-json-input")?.value?.trim() ?? "";
    const statusEl  = this.element.querySelector(".vgbnd-url-status");
    const importBtn = this.element.querySelector("[data-action='urlImport']");

    // Paste-JSON path wins if both are provided
    if (jsonText) {
      let raw;
      try {
        raw = JSON.parse(jsonText);
      } catch (err) {
        ui.notifications.error(game.i18n.format("VGBND.ErrorBadJSON", { error: err.message }));
        return;
      }
      if (importBtn) importBtn.disabled = true;
      if (statusEl)  statusEl.textContent = game.i18n.localize("VGBND.Importing");
      try {
        await VgbndBrowserDialog.#createActor(raw);
      } finally {
        if (importBtn) importBtn.disabled = false;
        if (statusEl)  statusEl.textContent = "";
      }
      return;
    }

    const uuid = VgbndBrowserDialog.extractUUID(uuidInput);
    if (!uuid) {
      ui.notifications.warn(game.i18n.localize("VGBND.ErrorNoInput"));
      return;
    }

    if (importBtn) importBtn.disabled = true;
    if (statusEl)  statusEl.textContent = game.i18n.localize("VGBND.Fetching");

    // Primary path: read the full Firestore document (auth or anonymous).
    // The public ?format=foundry endpoint strips portraits and spells; the
    // Firestore document keeps both. Anonymous sign-up requires no user
    // account and is enough to read public characters.
    try {
      let tok = await VgbndFirebase.getToken();
      if (!tok) tok = await VgbndFirebase.signInAnonymously();
      const fsData = await VgbndFirebase.getCharacter(tok.idToken, uuid);
      if (fsData.ancestry || fsData.class || fsData.inventory?.length) {
        const raw = await VgbndBrowserDialog.#fromFirestore(uuid, fsData);
        if (statusEl) statusEl.textContent = game.i18n.localize("VGBND.Importing");
        await VgbndBrowserDialog.#createActor(raw, uuid, fsData.selected_perks ?? []);
        if (statusEl) statusEl.textContent = "";
        if (importBtn) importBtn.disabled = false;
        return;
      }
    } catch (err) {
      // 403 (private character), network, or other — fall through to
      // ?format=foundry which doesn't need auth.
      console.warn("vgbnd-importer | Firestore URL import failed, falling back to ?format=foundry:", err.message);
    }

    // Fallback: ?format=foundry (no portrait, but spells get merged from native).
    try {
      const apiUrl     = `https://www.vgbnd.app/api/characters/${uuid}?format=foundry`;
      const useProxy   = game.settings.get("vgbnd-importer", "use-cors-proxy");
      const proxyPref  = (game.settings.get("vgbnd-importer", "cors-proxy-url") ?? "").trim();
      const fetchUrl   = (useProxy && proxyPref) ? `${proxyPref}${encodeURIComponent(apiUrl)}` : apiUrl;
      const res = await fetch(fetchUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      const spellNames = await VgbndBrowserDialog.#fetchSpellNames(uuid, useProxy, proxyPref);
      if (spellNames.length) {
        raw.items = raw.items ?? [];
        for (const name of spellNames) raw.items.push({ name, type: "spell" });
      }
      if (statusEl) statusEl.textContent = game.i18n.localize("VGBND.Importing");
      await VgbndBrowserDialog.#createActor(raw);
      if (statusEl) statusEl.textContent = "";
    } catch {
      // CORS, network, parse, or non-2xx — surface the paste-JSON fallback
      this.#showJsonFallback();
      if (statusEl) statusEl.textContent = game.i18n.localize("VGBND.CORSHint");
    } finally {
      if (importBtn) importBtn.disabled = false;
    }
  }

  // ── Core import ─────────────────────────────────────────────────────────────

  static async #importByUuid(uuid) {
    // Firestore is already authenticated — no CORS issues. Transform the raw document.
    const tok = await VgbndFirebase.getToken();
    if (tok) {
      try {
        const fsData = await VgbndFirebase.getCharacter(tok.idToken, uuid);
        if (fsData.ancestry || fsData.class || fsData.inventory?.length) {
          const raw = await VgbndBrowserDialog.#fromFirestore(uuid, fsData);
          return await VgbndBrowserDialog.#createActor(raw, uuid, fsData.selected_perks ?? []);
        }
      } catch (err) {
        console.warn("vgbnd-importer | Firestore import error:", err.message);
      }
    }

    // Fallback: vgbd.app API (blocked by CORS in browser context, opens new tab).
    let raw;
    try {
      const useProxy   = game.settings.get("vgbnd-importer", "use-cors-proxy");
      const proxyPref  = (game.settings.get("vgbnd-importer", "cors-proxy-url") ?? "").trim();
      const apiUrl     = `https://www.vgbnd.app/api/characters/${uuid}?format=foundry`;
      const fetchUrl   = (useProxy && proxyPref) ? `${proxyPref}${encodeURIComponent(apiUrl)}` : apiUrl;
      const res = await fetch(fetchUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.json();
      // Merge spell names from native shape — ?format=foundry strips them.
      const spellNames = await VgbndBrowserDialog.#fetchSpellNames(uuid, useProxy, proxyPref);
      if (spellNames.length) {
        raw.items = raw.items ?? [];
        for (const name of spellNames) raw.items.push({ name, type: "spell" });
      }
    } catch {
      ui.notifications.warn(game.i18n.localize("VGBND.ErrorCORSFallback"));
      window.open(`https://www.vgbnd.app/api/characters/${uuid}?format=foundry`, "_blank");
      return;
    }

    await VgbndBrowserDialog.#createActor(raw);
  }

  // Fetch the native (non-foundry-shape) character document and pull spell
  // names. Best-effort — if the proxy is off or the request fails we just
  // return [] and the caller proceeds without spell items.
  static async #fetchSpellNames(uuid, useProxy, proxyPref) {
    try {
      const nativeUrl  = `https://www.vgbnd.app/api/characters/${uuid}`;
      const fetchUrl   = (useProxy && proxyPref) ? `${proxyPref}${encodeURIComponent(nativeUrl)}` : nativeUrl;
      const res = await fetch(fetchUrl);
      if (!res.ok) return [];
      const data = await res.json();
      const c = data?.character ?? data ?? {};
      const names = [];
      for (const sp of (c.known_spells ?? [])) {
        if (!sp) continue;
        const n = typeof sp === "string" ? sp : (sp.name ?? sp.id ?? null);
        if (n) names.push(n);
      }
      if (c.ancestry_bonus_spell) names.push(c.ancestry_bonus_spell);
      return names;
    } catch (err) {
      console.warn("vgbnd-importer | spell-merge fetch failed:", err.message);
      return [];
    }
  }

  // ── Firestore → mapper-compatible format ────────────────────────────────────

  static async #fromFirestore(uuid, fs) {
    // console.log("vgbnd-importer | raw Firestore document:", JSON.parse(JSON.stringify(fs)));
    const items = [];

    // Ancestry & class resolved by name from compendiums.
    // Homebrew class/ancestry are stored as UUIDs referencing homebrew_content;
    // resolve those to the human name so the mapper can find them in the
    // appropriate compendium (typically vagabond-character-enhancer.vce-*).
    const ancestryName = await VgbndBrowserDialog.#resolveHomebrewName(fs.ancestry, "ancestry");
    if (ancestryName) items.push({ name: ancestryName, type: "ancestry" });

    const className = await VgbndBrowserDialog.#resolveHomebrewName(fs.class, "class");
    if (className) items.push({ name: className, type: "class" });

    // Perks (includes ancestry + class source perks)
    for (const p of (fs.selected_perks ?? [])) {
      if (p.name) items.push({ name: p.name, type: "perk" });
    }

    // Known spells + ancestry bonus spell
    for (const spellName of (fs.known_spells ?? [])) {
      if (spellName) items.push({ name: spellName, type: "spell" });
    }
    if (fs.ancestry_bonus_spell) items.push({ name: fs.ancestry_bonus_spell, type: "spell" });

    // Inventory → equipment (mapper resolves from weapon/armor/gear packs).
    // If the item has relic_powers or a material, stash that data in a
    // flag and tag the item as "pending forge" — the forge step runs
    // post-actor-create (relic-forge needs a real Item document, not raw data).
    for (const inv of (fs.inventory ?? [])) {
      if (!inv.name) continue;
      const itemData = {
        name:   inv.name,
        type:   "equipment",
        system: {
          quantity: inv.quantity ?? 1,
          ...(inv.is_equipped && { equipped: true }),
        },
      };
      const metalKey = VgbndBrowserDialog.#mapMetalKey(inv.material);
      if (metalKey) itemData.system.metal = metalKey;
      const hasRelicPowers = Array.isArray(inv.relic_powers) && inv.relic_powers.length > 0;
      if (hasRelicPowers) {
        itemData.flags ??= {};
        itemData.flags["vgbnd-importer"] = {
          pendingRelic: {
            relic_powers: inv.relic_powers,
            material:     inv.material ?? null,
          },
        };
      }
      items.push(itemData);
    }

    // Portrait — upload to Foundry's file system so it's a proper URL, not a db blob
    const charName = VgbndBrowserDialog.#sanitizeFilename(fs.name);
    const img = await VgbndBrowserDialog.#uploadPortrait(charName, fs.character_image_base64)
              ?? "icons/svg/mystery-man.svg";

    // Stats: assignedStats + levelStats bonuses + strongPotentialStat
    //   - levelStats: stat points gained on level-up
    //   - strongPotentialStat: Human ancestry's "Strong Potential" trait grants
    //     +1 to whichever stat the player chose. vgbnd.app stores the chosen
    //     stat name as a string; non-Human characters just don't have this set.
    const statsObj = {};
    const src      = fs.assignedStats ?? {};
    const lvlStats = fs.levelStats    ?? {};
    const sps      = String(fs.strongPotentialStat ?? "").toLowerCase();
    for (const stat of ["might", "dexterity", "awareness", "reason", "presence", "luck"]) {
      const base  = src[stat]      ?? null;
      const bonus = lvlStats[stat] ?? 0;
      const sp    = sps === stat ? 1 : 0;
      if (base != null) statsObj[stat] = { value: base + bonus + sp };
    }

    // Skills: trained_skills + ancestry_bonus_skill
    const skillsObj = {};
    for (const sk of (fs.trained_skills ?? [])) {
      const name = (typeof sk === "string" ? sk : (sk?.name ?? sk?.skill ?? null))?.toLowerCase();
      if (name) skillsObj[name] = { trained: true };
    }
    if (fs.ancestry_bonus_skill) skillsObj[fs.ancestry_bonus_skill.toLowerCase()] = { trained: true };

    // Currency — current_wealth uses {g,s,c} short keys or {gold,silver,copper} long keys
    const currency = {};
    const cw = fs.current_wealth;
    if (cw != null && typeof cw === "object") {
      const g = cw.gold   ?? cw.g;
      const s = cw.silver ?? cw.s;
      const c = cw.copper ?? cw.c;
      if (g != null) currency.gold   = g;
      if (s != null) currency.silver = s;
      if (c != null) currency.copper = c;
    } else {
      if (fs.gold   != null) currency.gold   = fs.gold;
      if (fs.silver != null) currency.silver = fs.silver;
      if (fs.copper != null) currency.copper = fs.copper;
    }

    const system = {
      attributes: {
        level: { value: fs.level ?? 1 },
        ...(fs.xp != null && { xp: fs.xp }),
      },
      details:    { builderDismissed: true },
      ...(Object.keys(statsObj).length  && { stats:    statsObj }),
      ...(Object.keys(skillsObj).length && { skills:   skillsObj }),
      ...(Object.keys(currency).length  && { currency: currency }),
      ...(fs.current_hp   != null && { health:      { value: fs.current_hp } }),
      ...(fs.current_mana != null && { mana:        { current: fs.current_mana } }),
      ...(fs.current_luck != null && { currentLuck: fs.current_luck }),
    };

    let subjectTexture = null;
    if (game.settings.get("vgbnd-importer", "dynamic-token-rings")) {
      const subjectScale = game.settings.get("vgbnd-importer", "dtr-subject-scale");
      subjectTexture = await VgbndBrowserDialog.#createSubjectTexture(charName, fs.character_image_base64, subjectScale);
    }

    return { name: fs.name ?? "Unknown", type: "character", img, items, system, subjectTexture };
  }

  // ── Link & refresh (existing actor → vgbnd.app) ─────────────────────────────

  /**
   * Public entry point for the actor-sheet "Sync from vgbnd.app" button and
   * the Browser Dialog's "Refresh" action on already-linked characters.
   *
   * If the actor already has a firestoreId flag, fetches fresh data and runs
   * a nuclear refresh (delete all items, recreate from vgbnd.app, update
   * system fields).
   *
   * If not yet linked, prompts the user for a URL or UUID, sets the flag,
   * and refreshes in one motion.
   *
   * @param {Actor} actor                    Foundry character actor
   * @param {string} [urlOrUuidOverride]     If provided, skips the prompt
   *                                         (used by the dialog's import flow
   *                                         when the user picked a card that
   *                                         matches an existing actor).
   */
  static async syncFromVgbnd(actor, urlOrUuidOverride = null) {
    if (!actor || actor.type !== "character") {
      ui.notifications.warn("vgbnd-importer | Sync requires a character actor.");
      return;
    }

    const existingFid = actor.getFlag("vgbnd-importer", "firestoreId");
    let uuid = existingFid ?? null;

    // Determine the UUID to fetch. Priority: explicit override → existing flag → prompt.
    if (urlOrUuidOverride) {
      uuid = VgbndBrowserDialog.extractUUID(urlOrUuidOverride);
      if (!uuid) {
        ui.notifications.error("vgbnd-importer | Could not extract a valid UUID from the input.");
        return;
      }
    } else if (!uuid) {
      const input = await VgbndBrowserDialog.#promptForUuid();
      if (!input) return;
      uuid = VgbndBrowserDialog.extractUUID(input);
      if (!uuid) {
        ui.notifications.error("vgbnd-importer | Could not extract a valid UUID from the input.");
        return;
      }
    }

    // Fetch fresh data (auth or anon)
    let fsData;
    try {
      const tok = (await VgbndFirebase.getToken()) ?? (await VgbndFirebase.signInAnonymously());
      fsData = await VgbndFirebase.getCharacter(tok.idToken, uuid);
    } catch (err) {
      ui.notifications.error(`vgbnd-importer | Could not fetch character: ${err.message}`);
      return;
    }
    if (!fsData?.ancestry && !fsData?.class && !fsData?.inventory?.length) {
      ui.notifications.error("vgbnd-importer | Character data is empty or inaccessible.");
      return;
    }

    // Link the actor (sets firestoreId for future refreshes)
    if (existingFid !== uuid) {
      await actor.setFlag("vgbnd-importer", "firestoreId", uuid);
    }

    await VgbndBrowserDialog.#refreshActor(actor, uuid, fsData);
  }

  /** Open a small DialogV2 prompting for a URL or UUID. Returns the trimmed
   *  input string, or null if the user cancelled. */
  static async #promptForUuid() {
    const placeholder = "https://www.vgbnd.app/character/... or 38008c0c-555c-...";
    const content = `<p style="margin: 0 0 8px;">Paste a vgbnd.app URL or character UUID:</p>
                     <input name="input" type="text" placeholder="${placeholder}"
                            style="width: 100%" autofocus />`;
    try {
      const result = await foundry.applications.api.DialogV2.prompt({
        window: { title: "Link to vgbnd.app" },
        content,
        ok: { label: "Link & Refresh", callback: (_e, btn) => btn.form.elements.input?.value?.trim() ?? "" },
        rejectClose: false,
      });
      return result || null;
    } catch {
      return null;
    }
  }

  /**
   * Nuclear refresh: replace all of the actor's items with what vgbnd.app
   * currently has, update system fields (stats, currency, HP/mana/luck/level/xp),
   * re-attach perk firestoreData, and re-apply the relic forge step.
   *
   * Does NOT touch the actor's portrait, prototype-token customizations,
   * sheet position, ownership, or any non-vgbnd-managed flags.
   */
  static async #refreshActor(actor, firestoreId, fsData) {
    // Build the fresh raw payload using the same path imports use.
    const raw = await VgbndBrowserDialog.#fromFirestore(firestoreId, fsData);
    let actorData, unresolved;
    try {
      ({ actorData, unresolved } = await VgbndMapper.toActor(raw));
    } catch (err) {
      ui.notifications.error(`vgbnd-importer | Refresh failed during mapping: ${err.message}`);
      return;
    }

    // 1. Delete every existing item on the actor (nuclear). User-added
    //    Foundry-only items will be lost on refresh — documented behaviour.
    const existingIds = actor.items.map(i => i.id);
    if (existingIds.length) {
      await actor.deleteEmbeddedDocuments("Item", existingIds);
    }

    // 2. Update system + name. We deliberately skip img + prototypeToken so
    //    the user's customizations stick.
    await actor.update({
      "name":   actorData.name,
      "system": actorData.system,
    });

    // 3. Recreate items from fresh data
    if (actorData.items?.length) {
      await actor.createEmbeddedDocuments("Item", actorData.items);
    }

    // 4. Re-attach Firestore perk metadata for round-trip sync
    if (fsData.selected_perks?.length) {
      const perkMap   = new Map(fsData.selected_perks.map(p => [p.name?.toLowerCase(), p]));
      const perkItems = actor.items.filter(i => i.type === "perk");
      for (const item of perkItems) {
        const fsPerk = perkMap.get(item.name.toLowerCase());
        if (fsPerk) await item.setFlag("vgbnd-importer", "firestoreData", fsPerk);
      }
    }

    // 5. Apply relic forge to any items with pendingRelic flag
    await VgbndBrowserDialog.#applyRelicForge(actor);

    // 6. Surface unresolved (compendium-miss) items if any
    if (unresolved?.length) {
      const dlg = new VgbndUnresolvedDialog(actor, unresolved);
      dlg.render(true);
    }

    ui.notifications.info(`vgbnd-importer | Refreshed ${actor.name} from vgbnd.app.`);
  }

  // ── Homebrew resolution (class / ancestry / perk by UUID) ───────────────────

  /**
   * vgbnd.app stores homebrew classes/ancestries on characters as their
   * Firestore document UUID (e.g. "5bb32641-2134-4bf8-a91f-e7468c1ed4e4")
   * instead of the stable slug ("sorcerer"). Detect that pattern and resolve
   * to the human-readable name from `homebrew_content/<uuid>` so the mapper
   * can find it in vagabond-character-enhancer.vce-* compendiums (or
   * wherever the matching item lives).
   *
   * Falls back to the title-cased input if it's a regular slug or if the
   * homebrew fetch fails — that mirrors the previous behaviour.
   */
  static async #resolveHomebrewName(value, _type) {
    if (!value) return null;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(value)) return VgbndBrowserDialog.#titleCase(value);
    // It's a UUID → fetch the homebrew document
    try {
      const tok = (await VgbndFirebase.getToken()) ?? (await VgbndFirebase.signInAnonymously());
      const FS_BASE = "https://firestore.googleapis.com/v1/projects/vagabond-tag-along/databases/(default)/documents";
      const res = await fetch(`${FS_BASE}/homebrew_content/${value}`, {
        headers: { "Authorization": `Bearer ${tok.idToken}` },
      });
      if (!res.ok) {
        console.warn(`vgbnd-importer | homebrew_content/${value} → HTTP ${res.status}; falling back to UUID`);
        return value;
      }
      const data = await res.json();
      const name = data?.fields?.data?.mapValue?.fields?.name?.stringValue
                ?? data?.fields?.collection?.stringValue
                ?? null;
      if (name) return name;
      console.warn(`vgbnd-importer | homebrew_content/${value} has no data.name; falling back to UUID`);
      return value;
    } catch (err) {
      console.warn(`vgbnd-importer | homebrew lookup failed for ${value}:`, err.message);
      return value;
    }
  }

  // ── Relic forge integration (vagabond-crawler) ──────────────────────────────

  /**
   * Map vgbnd.app's material string to vagabond-crawler's `system.metal` key.
   * Returns null if no mapping is known (item gets no metal — base name only).
   */
  static #mapMetalKey(material) {
    if (!material || typeof material !== "string") return null;
    const m = material.toLowerCase().trim();
    const map = {
      "silver":     "silver",
      "mythral":    "mythral",
      "mithral":    "mythral",
      "orichalum":  "orichalcum",
      "orichalcum": "orichalcum",
      "adamant":    "adamant",
      "adamantine": "adamant",
      "cold-iron":  "coldIron",
      "cold iron":  "coldIron",
      "magical":    "magical",
    };
    return map[m] ?? null;
  }

  /**
   * Normalize a vgbnd.app relic-power id to the format vagabond-crawler uses.
   * vgbnd.app: `strike-i`, `strike-ii`, `strike-iii`
   * crawler:   `strike-1`, `strike-2`, `strike-3`
   */
  static #normalizeRelicPowerId(id) {
    if (!id || typeof id !== "string") return id;
    return id.replace(/-(i{1,3})$/i, (_, roman) => {
      const a = { i: "1", ii: "2", iii: "3" }[roman.toLowerCase()];
      return a ? `-${a}` : `-${roman}`;
    });
  }

  /**
   * Resolve a single vgbnd.app relic_power entry to a vagabond-crawler power
   * definition. Handles three cases:
   *   - Standard ids → direct lookup after roman→arabic normalization
   *   - id === 'special' → fuzzy match on display_name against power.name
   *   - Unknown → returns null, caller logs and skips
   */
  static #resolveRelicPower(rawPower, getRelicPower, RELIC_POWERS) {
    if (!rawPower) return null;
    if (rawPower.id && rawPower.id !== "special") {
      const normId = VgbndBrowserDialog.#normalizeRelicPowerId(rawPower.id);
      const found = getRelicPower(normId);
      if (found) return { ...found, _userInput: "" };
      console.warn(`vgbnd-importer | relic id "${rawPower.id}" → "${normId}" not found in RELIC_POWERS`);
      return null;
    }
    // Custom 'special' powers — fuzzy match on display_name
    const display = (rawPower.display_name ?? rawPower.vars?.display_name ?? "").trim();
    if (!display) return null;
    const needle = display.toLowerCase();
    const match = RELIC_POWERS.find(p => p.name.toLowerCase().includes(needle))
              ?? RELIC_POWERS.find(p => needle.includes(p.name.toLowerCase()));
    if (match) return { ...match, _userInput: "" };
    console.warn(`vgbnd-importer | relic special "${display}" — no fuzzy match`);
    return null;
  }

  /**
   * After actor creation, scan its items for the pendingRelic flag (set by
   * #fromFirestore) and forge each one via vagabond-crawler's public API.
   * Silently no-ops if vagabond-crawler isn't active — items remain unforged
   * but keep the flag, so a future install + retry could pick them up.
   */
  static async #applyRelicForge(actor) {
    const crawler = game.modules.get("vagabond-crawler");
    if (!crawler?.active || !crawler.api?.forgeItem) return;
    const { forgeItem, getRelicPower, RELIC_POWERS } = crawler.api;

    const pendingItems = actor.items.filter(i => i.getFlag("vgbnd-importer", "pendingRelic"));
    if (!pendingItems.length) return;

    for (const item of pendingItems) {
      const pending = item.getFlag("vgbnd-importer", "pendingRelic");
      const rawPowers = pending?.relic_powers ?? [];
      const powers = rawPowers
        .map(rp => VgbndBrowserDialog.#resolveRelicPower(rp, getRelicPower, RELIC_POWERS))
        .filter(Boolean);
      if (!powers.length) {
        await item.unsetFlag("vgbnd-importer", "pendingRelic");
        continue;
      }
      try {
        await forgeItem(item, powers);
      } catch (err) {
        console.warn(`vgbnd-importer | forgeItem failed for "${item.name}":`, err.message);
      }
      await item.unsetFlag("vgbnd-importer", "pendingRelic");
    }
  }

  static async #uploadPortrait(charName, base64) {
    if (!base64?.startsWith("data:")) return null;
    try {
      const folder = "assets/vagabond/portraits";
      const FP = foundry.applications.apps.FilePicker.implementation;
      for (const path of ["assets", "assets/vagabond", folder]) {
        try { await FP.createDirectory("data", path, {}); } catch { /* exists */ }
      }
      const [header, data] = base64.split(",");
      const mime = header.match(/:(.*?);/)?.[1] ?? "image/webp";
      const ext  = mime.split("/")[1] ?? "webp";
      const bytes = atob(data);
      const arr   = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const file = new File([arr], `${charName}.${ext}`, { type: mime });
      const res  = await FP.upload("data", folder, file, {}, { notify: false });
      return res?.path ?? null;
    } catch (err) {
      console.warn("vgbnd-importer | Portrait upload failed:", err.message);
      return null;
    }
  }

  // Produces a 512×512 WebP with the portrait circle-cropped so that after DTR
  // applies subject.scale the portrait edge aligns exactly with the ring boundary.
  static async #createSubjectTexture(charName, base64, scale = 1) {
    if (!base64?.startsWith("data:")) return null;
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload  = () => resolve(el);
        el.onerror = reject;
        el.src = base64;
      });

      const size   = 512;
      const cx     = size / 2;
      // Ring starts at ⅔ of the token radius. DTR will scale the texture by `scale`,
      // so we pre-compensate: make the crop circle larger so scale × cropRadius = ⅔ × cx.
      const radius = Math.min(cx, cx * (2 / 3) / scale);

      const canvas = document.createElement("canvas");
      canvas.width  = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");

      ctx.beginPath();
      ctx.arc(cx, cx, radius, 0, Math.PI * 2);
      ctx.clip();

      // Cover: scale portrait to fill the circle, centred
      const d         = radius * 2;
      const drawScale = Math.max(d / img.width, d / img.height);
      const sw        = img.width  * drawScale;
      const sh        = img.height * drawScale;
      ctx.drawImage(img, cx - sw / 2, cx - sh / 2, sw, sh);

      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.9));
      const file = new File([blob], `${charName}_subject.webp`, { type: "image/webp" });

      const folder = "assets/vagabond/portraits";
      const FP  = foundry.applications.apps.FilePicker.implementation;
      const res = await FP.upload("data", folder, file, {}, { notify: false });
      return res?.path ?? null;
    } catch (err) {
      console.warn("vgbnd-importer | Subject texture creation failed:", err.message);
      return null;
    }
  }

  static #titleCase(str) {
    return str?.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()) ?? str;
  }

  static #sanitizeFilename(name) {
    return (name ?? "unknown").trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "_") || "unknown";
  }

  static async #createActor(raw, firestoreId = null, fsPerks = []) {
    let actorData, unresolved;
    try {
      ({ actorData, unresolved } = await VgbndMapper.toActor(raw));
    } catch (err) {
      ui.notifications.error(game.i18n.format("VGBND.ErrorCreate", { error: err.message }));
      return;
    }

    let actor;
    try {
      actor = await Actor.create(actorData);
    } catch (err) {
      ui.notifications.error(game.i18n.format("VGBND.ErrorCreate", { error: err.message }));
      return;
    }

    // Store Firestore link so we can sync back later
    if (firestoreId) {
      await actor.setFlag("vgbnd-importer", "firestoreId", firestoreId);
    }

    // Store original Firestore perk data on each perk item for round-trip sync
    if (fsPerks.length) {
      const perkMap = new Map(fsPerks.map(p => [p.name?.toLowerCase(), p]));
      const perkItems = actor.items.filter(i => i.type === "perk");
      for (const item of perkItems) {
        const fsData = perkMap.get(item.name.toLowerCase());
        if (fsData) await item.setFlag("vgbnd-importer", "firestoreData", fsData);
      }
    }

    // Forge any items tagged with pendingRelic (from #fromFirestore). Silently
    // no-ops if vagabond-crawler isn't active.
    await VgbndBrowserDialog.#applyRelicForge(actor);

    if (unresolved.length) {
      const dlg = new VgbndUnresolvedDialog(actor, unresolved);
      dlg.render(true);
      await dlg.closed;
    }
  }
}
