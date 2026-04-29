/**
 * VgbndMapper
 *
 * Converts a Vagabond API response (format=foundry) into a valid
 * Actor.create() payload, resolving all items from system compendiums.
 *
 * Features:
 *  - Compendium lookup by name (case-insensitive)
 *  - Automatic equip of weapons, armor, and focus spells
 *  - Portrait + token image from API `img` field
 *  - Duplicate detection within the same pack (picks first, warns)
 *  - Unresolved item report returned alongside actor data
 */
export class VgbndMapper {

  // ──────────────────────────────────────────────────────────
  //  Compendium config
  // ──────────────────────────────────────────────────────────

  static #SINGLE_PACK = {
    ancestry: "vagabond.ancestries",
    class:    "vagabond.classes",
    perk:     "vagabond.perks",
    spell:    "vagabond.spells",
  };

  // Tried in order for type "equipment"
  static #EQUIPMENT_PACKS = [
    "vagabond.weapons",
    "vagabond.armor",
    "vagabond.gear",
    "vagabond.alchemical-items",
    "vagabond.relics",
  ];

  // equipmentType values that should be auto-equipped on import
  static #AUTO_EQUIP_TYPES = new Set(["weapon", "armor"]);

  // Category words the compendium uses as a comma-prefix.
  // vgbnd.app emits "Healing I Potion"; the compendium calls it "Potion, Healing I".
  static #COMMA_PREFIX_TOKENS = ["potion", "oil", "acid", "torch", "candle", "poison", "lantern", "book", "scroll"];

  // Direct name aliases for cases where no general rule fits.
  // Keys must be lowercased + whitespace-collapsed (i.e. post-#normalizeName).
  // Values are the compendium-side normalized name.
  static #STATIC_ALIASES = {
    // Cards: compendium uses "Cards - deck, X" pattern. vgbnd.app variously
    // emits "Tarot Cards", "Deck Tarot Cards", "Playing Cards", etc.
    "tarot cards":        "cards - deck, tarot",
    "deck tarot cards":   "cards - deck, tarot",
    "playing cards":      "cards - deck, playing",
    "deck playing cards": "cards - deck, playing",
    "marked cards":       "cards - deck, marked",
    "deck marked cards":  "cards - deck, marked",
    // Materials/Ingredients: compendium has price tiers as parentheticals
    // — default to the cheaper tier; GM can swap to (50s) manually if needed
    "materials":          "materials (1g)",
    "ingredients":        "ingredients (1g)",
  };

  // ──────────────────────────────────────────────────────────
  //  Public API
  // ──────────────────────────────────────────────────────────

  /**
   * Convert a raw vgbnd API payload to an Actor creation object.
   *
   * @param {object} raw  Parsed JSON from the API
   * @returns {Promise<{ actorData: object, unresolved: string[] }>}
   *   actorData  → pass directly to Actor.create()
   *   unresolved → array of "Name (type)" strings that had no compendium match
   */
  static async toActor(raw) {
    const unresolved = [];
    const items = await this.#resolveItems(raw.items ?? [], raw.system?.focus?.spellIds ?? [], unresolved);

    const img = raw.img ?? "icons/svg/mystery-man.svg";

    const prototypeToken = { texture: { src: img } };
    if (game.settings.get("vgbnd-importer", "dynamic-token-rings")) {
      const ringColor    = game.user.color?.toString() ?? "#ffffff";
      const subjectScale = game.settings.get("vgbnd-importer", "dtr-subject-scale");
      prototypeToken.ring = {
        enabled: true,
        subject: { texture: raw.subjectTexture ?? img, scale: subjectScale },
        colors:  { ring: ringColor },
      };
    }

    const actorData = {
      name:   raw.name ?? "Unnamed Character",
      type:   raw.type ?? "character",
      img,
      prototypeToken,
      system: this.#mapSystem(raw.system ?? {}),
      items,
    };

    return { actorData, unresolved };
  }

  // ──────────────────────────────────────────────────────────
  //  Item resolution
  // ──────────────────────────────────────────────────────────

  static async #resolveItems(apiItems, focusSpellIds, unresolved) {
    const resolved = [];

    for (const apiItem of apiItems) {
      const doc = await this.#lookupItem(apiItem);

      if (doc) {
        const itemData = doc.toObject();
        this.#applyOverrides(itemData, apiItem, focusSpellIds);
        resolved.push(itemData);
      } else {
        unresolved.push({ name: apiItem.name, type: apiItem.type, system: apiItem.system });
        console.warn(`vgbnd-importer | "${apiItem.name}" (${apiItem.type}) — no compendium match, skipping.`);
        // We intentionally do NOT push a fallback item — unresolved are reported to the GM
      }
    }

    return resolved;
  }

  /**
   * Look up an item across the relevant packs.
   * Tries the original name first, then falls back to known naming-convention
   * permutations (e.g. "Healing I Potion" → "Potion, Healing I").
   * Warns if a pack contains duplicates.
   */
  static async #lookupItem(apiItem) {
    if (!apiItem.name) return null;
    const variants = this.#nameVariants(apiItem.name);

    for (const packId of this.#packsForType(apiItem.type)) {
      const pack = game.packs.get(packId);
      if (!pack) {
        console.warn(`vgbnd-importer | Pack not found: ${packId}`);
        continue;
      }

      await pack.getIndex();

      for (const variant of variants) {
        const matches = pack.index.filter(e => this.#normalizeName(e.name) === variant);
        if (matches.length === 0) continue;

        if (matches.length > 1) {
          console.warn(
            `vgbnd-importer | "${apiItem.name}" has ${matches.length} entries in ${packId} — using the first one.`
          );
        }

        if (variant !== variants[0]) {
          console.info(
            `vgbnd-importer | "${apiItem.name}" matched as "${matches[0].name}" via name-permutation rule.`
          );
        }

        return await pack.getDocument(matches[0]._id);
      }
    }

    return null;
  }

  /**
   * Normalize a name for comparison: lowercase, trim, collapse whitespace,
   * fold smart quotes to straight quotes.
   */
  static #normalizeName(name) {
    return String(name)
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  /**
   * Build the ordered list of normalized name candidates to try when looking
   * up `apiName` in the compendium. The first entry is always the exact
   * (normalized) input; later entries are permutations driven by known
   * conventions in the Vagabond compendium.
   */
  static #nameVariants(apiName) {
    const base = this.#normalizeName(apiName);
    const variants = [base];
    const seen = new Set(variants);
    const push = v => { if (v && !seen.has(v)) { seen.add(v); variants.push(v); } };

    // Static alias takes precedence over any rule (covers irregular cases
    // like "Tarot Cards" → "Cards - deck, tarot" that don't fit any pattern).
    if (this.#STATIC_ALIASES[base]) push(this.#STATIC_ALIASES[base]);

    // Strip a trailing parenthetical qualifier: "Trinket (magic)" → "trinket".
    // The compendium often has a bare name where vgbnd.app adds a clarifier.
    const noParen = base.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (noParen && noParen !== base) {
      push(noParen);
      if (this.#STATIC_ALIASES[noParen]) push(this.#STATIC_ALIASES[noParen]);
    }

    // Try both the original and singular form (strip trailing "s").
    // The compendium uses singular forms ("Lantern, hooded"), but the API
    // sometimes emits plurals ("Hooded Lanterns").
    const forms = [base];
    if (base.endsWith("s") && base.length > 3) forms.push(base.slice(0, -1));

    for (const form of forms) {
      if (form !== base) push(form);

      // "X Spell Scroll" / "Scroll of X" → "Scroll, Spell"
      if (/\bspell\sscroll$/.test(form) || /^scroll of\s+/.test(form)) {
        push("scroll, spell");
      }

      // Generalized comma-prefix swap: "A B C ... Y" → "Y, a b c" for any
      // multi-word name. Tries the LAST word as the comma-prefix pivot. Most
      // compendium entries that swap pivot use this pattern: "Whip, leather",
      // "Crossbow, light", "Pants, casual", "Spikes, iron (10)", etc.
      const lastWordMatch = form.match(/^(.+)\s+(\S+)$/);
      if (lastWordMatch) {
        const [, prefix, pivot] = lastWordMatch;
        push(`${pivot}, ${prefix}`);
      }
    }

    return variants;
  }

  static #packsForType(type) {
    if (type in this.#SINGLE_PACK) return [this.#SINGLE_PACK[type]];
    if (type === "equipment")      return this.#EQUIPMENT_PACKS;
    return [...Object.values(this.#SINGLE_PACK), ...this.#EQUIPMENT_PACKS];
  }

  /**
   * Partial case-insensitive search across all relevant packs for a given type.
   * @param {string} query
   * @param {string} type  Vagabond item type
   * @returns {Promise<Array<{name:string, packId:string, packLabel:string, id:string}>>}
   */
  static async searchByName(query, type) {
    const needle = this.#normalizeName(query);
    if (!needle) return [];
    const words = needle.split(/\W+/).filter(Boolean);

    const results = [];
    const seen = new Set();

    for (const packId of this.#packsForType(type)) {
      const pack = game.packs.get(packId);
      if (!pack) continue;
      await pack.getIndex();

      for (const entry of pack.index) {
        const haystack = this.#normalizeName(entry.name);
        const matches = haystack.includes(needle)
          || needle.includes(haystack)
          || words.every(w => haystack.includes(w));
        if (!matches) continue;
        const key = `${packId}:${entry._id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ name: entry.name, packId, packLabel: pack.metadata.label, id: entry._id });
      }
    }

    return results;
  }

  // ──────────────────────────────────────────────────────────
  //  System data
  // ──────────────────────────────────────────────────────────

  // The API already sends system data in Foundry format via ?format=foundry,
  // so we pass it through directly. Foundry fills in any missing fields with defaults.
  static #mapSystem(apiSystem) {
    foundry.utils.setProperty(apiSystem, "details.builderDismissed", true);
    return apiSystem;
  }

  // ──────────────────────────────────────────────────────────
  //  Overrides applied on top of the compendium clone
  // ──────────────────────────────────────────────────────────

  static #applyOverrides(itemData, apiItem, focusSpellIds) {
    const sys = itemData.system ?? {};

    // ── Quantity ───────────────────────────────────────────
    if (apiItem.system?.quantity !== undefined) {
      foundry.utils.setProperty(itemData, "system.quantity", apiItem.system.quantity);
    }

    // ── Equip: honour explicit flag from source data, fall back to type heuristic ──
    if (apiItem.type === "equipment") {
      const shouldEquip = apiItem.system?.equipped
        ?? this.#AUTO_EQUIP_TYPES.has(sys.equipmentType ?? "");
      if (shouldEquip) foundry.utils.setProperty(itemData, "system.equipped", true);
    }

    // ── Metal (relic-forge integration) — vgbnd.app's `material` field ────────
    if (apiItem.system?.metal) {
      foundry.utils.setProperty(itemData, "system.metal", apiItem.system.metal);
    }

    // ── Preserve incoming flags (e.g. pendingRelic from Firestore inventory) ──
    // The compendium clone has its own flags namespace; we merge any input
    // module-flags on top so the post-create relic-forge step can find them.
    if (apiItem.flags) {
      itemData.flags = foundry.utils.mergeObject(itemData.flags ?? {}, apiItem.flags, { inplace: false });
    }

    // ── Spells: favorite so they appear on the front of the sheet ──────────────
    if (apiItem.type === "spell") {
      foundry.utils.setProperty(itemData, "system.favorite", true);
    }

    // ── Auto-equip focus spells ────────────────────────────────────────────────
    if (apiItem.type === "spell" && focusSpellIds.includes(apiItem.id)) {
      foundry.utils.setProperty(itemData, "system.focus", true);
    }
  }
}
