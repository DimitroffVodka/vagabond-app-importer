// Vagabond PDF Exporter — ported from vagabond-pdf-importer, adapted for vgbnd-importer.
console.log("[VGBND Export] export.mjs loading...");

// ── Foundry Skill Key → PDF Field Names ──────────────────────────────────────

const SKILL_PDF_MAP = {
  arcana:      { dc: "Arcana Skill Difficulty",        trained: "Arcana Trained" },
  brawl:       { dc: "Brawn Skill Difficulty",         trained: "Brawn Trained" },
  craft:       { dc: "Craft Skill Difficulty",         trained: "Craft Trained" },
  detect:      { dc: "Detect Skill Difficulty",        trained: "Detect Trained" },
  finesse:     { dc: "Finesse Skill Difficulty",       trained: "Finesse Trained" },
  influence:   { dc: "Influence Skill Difficulty",     trained: "Influence Trained" },
  leadership:  { dc: "Leadership Skill Difficulty",    trained: "Leadership Trained" },
  medicine:    { dc: "Medicine Skill Difficulty",      trained: "Medicine Trained" },
  melee:       { dc: "Melee Attack Check Difficulty",  trained: "Melee Weapons Trained" },
  mysticism:   { dc: "Mysticism Skill Difficulty",     trained: "Mysticism Trained" },
  performance: { dc: "Performance Skill Difficulty",   trained: "Performance Trained" },
  ranged:      { dc: "Ranged Attack Difficulty",       trained: "Ranged Weapons Trained" },
  sneak:       { dc: "Sneak Skill Difficulty",         trained: "Sneak Trained" },
  survival:    { dc: "Survival Skill Difficulty",      trained: "Survival Trained" },
};

const STAT_PDF_MAP = {
  awareness: "AWR",
  dexterity: "DEX",
  reason:    "LOG",
  luck:      "LUK",
  might:     "MIT",
  presence:  "PRS",
};

// ── PDF Field Helpers ────────────────────────────────────────────────────────

function _setText(form, fieldName, value) {
  try { form.getTextField(fieldName).setText(_sanitizeWinAnsi(String(value ?? ""))); }
  catch { /* field not found */ }
}

function _setCheck(form, fieldName, checked) {
  try { const f = form.getCheckBox(fieldName); if (checked) f.check(); else f.uncheck(); }
  catch { /* field not found */ }
}

function _setDropdown(form, fieldName, value) {
  try { form.getDropdown(fieldName).select(value); }
  catch { /* field not found */ }
}

function _stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const _TRANSLIT = {
  "\u0100":"A","\u0101":"a","\u0102":"A","\u0103":"a","\u0104":"A","\u0105":"a",
  "\u0106":"C","\u0107":"c","\u0108":"C","\u0109":"c","\u010A":"C","\u010B":"c",
  "\u010C":"C","\u010D":"c","\u010E":"D","\u010F":"d","\u0110":"D","\u0111":"d",
  "\u0112":"E","\u0113":"e","\u0114":"E","\u0115":"e","\u0116":"E","\u0117":"e",
  "\u0118":"E","\u0119":"e","\u011A":"E","\u011B":"e","\u011C":"G","\u011D":"g",
  "\u011E":"G","\u011F":"g","\u0120":"G","\u0121":"g","\u0122":"G","\u0123":"g",
  "\u0124":"H","\u0125":"h","\u0126":"H","\u0127":"h","\u0128":"I","\u0129":"i",
  "\u012A":"I","\u012B":"i","\u012C":"I","\u012D":"i","\u012E":"I","\u012F":"i",
  "\u0130":"I","\u0131":"i","\u0134":"J","\u0135":"j","\u0136":"K","\u0137":"k",
  "\u0139":"L","\u013A":"l","\u013B":"L","\u013C":"l","\u013D":"L","\u013E":"l",
  "\u0141":"\u004C","\u0142":"\u006C",
  "\u0143":"N","\u0144":"n","\u0145":"N","\u0146":"n","\u0147":"N","\u0148":"n",
  "\u014C":"O","\u014D":"o","\u014E":"O","\u014F":"o","\u0150":"O","\u0151":"o",
  "\u0152":"OE","\u0153":"oe",
  "\u0154":"R","\u0155":"r","\u0156":"R","\u0157":"r","\u0158":"R","\u0159":"r",
  "\u015A":"S","\u015B":"s","\u015C":"S","\u015D":"s","\u015E":"S","\u015F":"s",
  "\u0160":"S","\u0161":"s","\u0162":"T","\u0163":"t","\u0164":"T","\u0165":"t",
  "\u0166":"T","\u0167":"t","\u0168":"U","\u0169":"u","\u016A":"U","\u016B":"u",
  "\u016C":"U","\u016D":"u","\u016E":"U","\u016F":"u","\u0170":"U","\u0171":"u",
  "\u0172":"U","\u0173":"u","\u0174":"W","\u0175":"w","\u0176":"Y","\u0177":"y",
  "\u0178":"Y","\u0179":"Z","\u017A":"z","\u017B":"Z","\u017C":"z","\u017D":"Z",
  "\u017E":"z",
  "\u2013":"-","\u2014":"--","\u2018":"'","\u2019":"'","\u201A":"'",
  "\u201C":'"',"\u201D":'"',"\u201E":'"',"\u2026":"...","\u2032":"'","\u2033":'"',
};

function _sanitizeWinAnsi(str) {
  let result = "";
  let dropped = false;
  for (const ch of str) {
    if (_TRANSLIT[ch] !== undefined) {
      result += _TRANSLIT[ch];
    } else if (ch.codePointAt(0) <= 0xFF) {
      result += ch;
    } else {
      dropped = true;
    }
  }
  if (dropped) {
    console.warn("[VGBND Export] Some characters could not be encoded for PDF and were removed.");
  }
  return result;
}

// ── Lazy-load pdf-lib from module bundle ─────────────────────────────────────

let _pdfLibCache = null;
async function _getPdfLib() {
  if (_pdfLibCache) return _pdfLibCache;
  if (typeof PDFLib !== "undefined") { _pdfLibCache = PDFLib; return _pdfLibCache; }
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "modules/vgbnd-importer/scripts/lib/pdf-lib.min.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Failed to load pdf-lib"));
    document.head.appendChild(script);
  });
  _pdfLibCache = PDFLib;
  return _pdfLibCache;
}

// ── Main Export Function ─────────────────────────────────────────────────────

export async function exportActorToPdf(actor) {
  if (!actor || actor.type !== "character") {
    ui.notifications.warn(game.i18n.localize("VGBND.ExportErrorNotCharacter"));
    return;
  }

  ui.notifications.info(game.i18n.format("VGBND.ExportStarting", { name: actor.name }));

  try {
    const PDFLib = await _getPdfLib();
    if (!PDFLib) throw new Error("pdf-lib could not be loaded");

    const choice = game.settings.get("vgbnd-importer", "export-template");
    const templateUrl = `modules/vgbnd-importer/pdf/vagabond-hero-record-${choice}.pdf`;

    const response = await fetch(templateUrl);
    if (!response.ok) throw new Error(`Failed to load PDF template: ${response.status}`);
    const pdfDoc = await PDFLib.PDFDocument.load(await response.arrayBuffer());
    const form = pdfDoc.getForm();
    const sys = actor.system;

    // ── Character Info ──
    _setText(form, "Name", actor.name);
    _setText(form, "Level", sys.attributes?.level?.value ?? 0);
    _setText(form, "XP", sys.attributes?.xp ?? 0);

    const ancestryItem = actor.items.find(i => i.type === "ancestry");
    const classItem = actor.items.find(i => i.type === "class");
    _setText(form, "Ancestry", ancestryItem?.name ?? "");
    _setText(form, "Class", classItem?.name ?? "");

    const beingType = sys.ancestryData?.beingType ?? ancestryItem?.system?.ancestryType ?? "Humanlike";
    const size = sys.ancestryData?.size ?? ancestryItem?.system?.size ?? "medium";
    const sizeMap = { tiny: "T", small: "S", medium: "M", large: "L", huge: "H", gargantuan: "G" };
    _setDropdown(form, "Being Type", beingType);
    _setDropdown(form, "Size", sizeMap[size] ?? "M");

    // ── Stats (derived .total) ──
    for (const [statKey, pdfField] of Object.entries(STAT_PDF_MAP)) {
      const val = sys.stats?.[statKey]?.total ?? sys.stats?.[statKey]?.value ?? 0;
      _setText(form, pdfField, val);
    }

    // ── HP / Mana / Luck / Fatigue / Casting Max ──
    _setText(form, "Max HP", sys.health?.max ?? "");
    _setText(form, "Current HP", sys.health?.value ?? "");
    _setText(form, "Max Mana", sys.mana?.max || "");
    _setText(form, "Current Mana", sys.mana?.current || "");
    _setText(form, "Current Luck", sys.currentLuck ?? "");
    _setText(form, "Fatigue", sys.fatigue ?? 0);
    _setText(form, "Casting Maximum", sys.mana?.castingMax || "");

    // ── Armor ──
    _setText(form, "Armor Rating", sys.armor ?? "");

    // ── Saves ──
    _setText(form, "Endure Save Difficulty", sys.saves?.endure?.difficulty ?? "");
    _setText(form, "Reflex Save Difficulty", sys.saves?.reflex?.difficulty ?? "");
    _setText(form, "Will Save Difficulty",   sys.saves?.will?.difficulty ?? "");

    // ── Skills ──
    for (const [skillKey, info] of Object.entries(SKILL_PDF_MAP)) {
      const skill = sys.skills?.[skillKey];
      _setText(form, info.dc, skill?.difficulty ?? "");
      _setCheck(form, info.trained, skill?.trained ?? false);
    }

    // ── Speed ──
    _setText(form, "Speed", sys.speed?.base ?? "");
    _setText(form, "Speed Bonus", "");
    _setText(form, "Crawl Speed", sys.speed?.crawl ?? "");
    _setText(form, "Travel Speed", sys.speed?.travel ?? "");

    // ── Wealth ──
    _setText(form, "Wealth (g)", sys.currency?.gold ?? "");
    _setText(form, "Wealth (s)", sys.currency?.silver ?? "");
    _setText(form, "Wealth (c)", sys.currency?.copper ?? "");

    // ── Weapons (up to 3 equipped) ──
    const equippedWeapons = actor.items.filter(
      i => i.type === "equipment" && i.system?.equipmentType === "weapon" && i.system?.equipped
    );
    for (let w = 0; w < 3; w++) {
      const idx = w + 1;
      const weapon = equippedWeapons[w];
      if (weapon) {
        _setText(form, `Weapon ${idx}`, weapon.name);
        const isTwoHand = weapon.system.equipmentState === "twoHands";
        const dmg = isTwoHand ? weapon.system.damageTwoHands : weapon.system.damageOneHand;
        _setText(form, `Weapon Damage ${idx}`, dmg || "");
        const props = Array.isArray(weapon.system.properties) ? weapon.system.properties.join(", ") : "";
        _setText(form, `Weapon Properties ${idx}`, props);
        _setDropdown(form, `Grip ${idx}`, isTwoHand ? "2H" : "1H");
      } else {
        _setText(form, `Weapon ${idx}`, "");
        _setText(form, `Weapon Damage ${idx}`, "");
        _setText(form, `Weapon Properties ${idx}`, "");
        _setDropdown(form, `Grip ${idx}`, "F");
      }
    }

    // ── Inventory (stacked — duplicates merged into "Name x N") ──
    const equipment = actor.items.filter(i => i.type === "equipment");
    const groupMap = new Map();
    for (const item of equipment) {
      const bs = item.system?.baseSlots;
      const key = `${item.name}::${bs ?? ""}`;
      let g = groupMap.get(key);
      if (!g) {
        g = { name: item.name, baseSlots: bs, total: 0, anyEquipped: false };
        groupMap.set(key, g);
      }
      const qty = Number(item.system?.quantity ?? 1);
      g.total += Number.isFinite(qty) ? qty : 1;
      if (item.system?.equipped) g.anyEquipped = true;
    }
    const stackedInventory = [...groupMap.values()].sort((a, b) => {
      const aEq = a.anyEquipped ? 0 : 1;
      const bEq = b.anyEquipped ? 0 : 1;
      return aEq !== bEq ? aEq - bEq : a.name.localeCompare(b.name);
    });

    for (let i = 0; i < 14; i++) {
      const idx = i + 1;
      const g = stackedInventory[i];
      if (g) {
        const displayName = g.total > 1 ? `${g.name} x ${g.total}` : g.name;
        _setText(form, `Inventory ${idx}`, displayName);
        const slotValue = (typeof g.baseSlots === "number" && Number.isFinite(g.baseSlots))
          ? (g.baseSlots * g.total)
          : (g.baseSlots ?? "");
        _setText(form, `Item Slot ${idx}`, slotValue);
      } else {
        _setText(form, `Inventory ${idx}`, "");
        _setText(form, `Item Slot ${idx}`, "");
      }
    }

    _setText(form, "Maximum Item Slots", sys.inventory?.baseMaxSlots ?? sys.inventory?.maxSlots ?? "");
    _setText(form, "Occupied Item Slots", sys.inventory?.occupiedSlots ?? "");
    _setText(form, "Bonus Item Slots", "0");

    // ── Magic (split across 2 fields) ──
    const spells = actor.items
      .filter(i => i.type === "spell")
      .sort((a, b) => a.name.localeCompare(b.name));

    const spellEntries = spells.map(spell => {
      const s = spell.system;
      const dmgType = s.damageType
        ? (s.damageType === "-" ? "-" : s.damageType.charAt(0).toUpperCase() + s.damageType.slice(1))
        : "-";
      const desc = _stripHtml(s.description || "");
      let entry = `${spell.name} [Damage Base: ${dmgType}]: ${desc}`;
      const critText = s.critContinual ? "Duration is continual." : (s.crit || "").trim();
      if (critText) entry += `\rCrit: ${critText}`;
      return entry;
    });

    const half = Math.ceil(spellEntries.length / 2);
    _setText(form, "Magic 1", spellEntries.slice(0, half).join("\r\r"));
    _setText(form, "Magic 2", spellEntries.slice(half).join("\r\r"));

    // ── Abilities ──
    const level = sys.attributes?.level?.value ?? 1;
    const abilityLines = [];

    if (ancestryItem?.system?.traits) {
      for (const trait of ancestryItem.system.traits) {
        if (trait.name) abilityLines.push(`${trait.name}: ${_stripHtml(trait.description)}`);
      }
    }
    if (classItem?.system?.levelFeatures) {
      for (const feat of classItem.system.levelFeatures) {
        if (feat.level <= level && feat.name !== "Perk") {
          abilityLines.push(`${feat.name}: ${_stripHtml(feat.description)}`);
        }
      }
    }
    for (const perk of actor.items.filter(i => i.type === "perk")) {
      abilityLines.push(`${perk.name}: ${_stripHtml(perk.system?.description || "")}`);
    }

    _setText(form, "Abilities", abilityLines.join("\r\r"));

    // ── Save & Download ──
    const pdfBytes = await pdfDoc.save();
    console.log(`[VGBND Export] PDF size: ${pdfBytes.length} bytes`);

    const safeName = actor.name.replace(/[\\/:*?"<>|]/g, "_");
    const filename = `${safeName} - Vagabond.pdf`;

    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    ui.notifications.info(game.i18n.format("VGBND.ExportSuccess", { name: actor.name, filename }));
    console.log(`[VGBND Export] Downloaded as: ${filename}`);

  } catch (err) {
    console.error("[VGBND Export] Error:", err);
    ui.notifications.error(game.i18n.format("VGBND.ExportErrorFailed", { error: err.message }));
  }
}

// ── Register Export Button on Character Sheet Header (AppV2) ─────────────────

Hooks.on("renderVagabondCharacterSheet", (app, html) => {
  const actor = app.actor ?? app.document;
  if (actor?.type !== "character") return;

  const appEl = app.element instanceof HTMLElement
    ? app.element
    : (app.element?.[0] ?? (html instanceof HTMLElement ? html : html[0])?.closest?.(".application,.window-app"));

  if (!appEl) return;
  if (appEl.querySelector(".vgbnd-export-pdf")) return;

  const controls = appEl.querySelector(".window-controls")
    ?? appEl.querySelector(".window-header");
  if (!controls) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "header-control vgbnd-export-pdf";
  const tooltip = game.i18n.localize("VGBND.ExportButtonTooltip");
  btn.title = tooltip;
  btn.setAttribute("aria-label", tooltip);
  btn.innerHTML = '<i class="fas fa-file-export"></i>';
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    exportActorToPdf(actor);
  });

  controls.insertBefore(btn, controls.firstChild);
});

// ── Expose globally for macros ──
window.VgbndExport = { exportActorToPdf };
console.log("[VGBND Export] export.mjs loaded. VgbndExport =", window.VgbndExport);
