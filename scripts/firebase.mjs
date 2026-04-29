const API_KEY  = "AIzaSyAX0K_GzIlY_26QK5EMvpvBKpFbA791jT0";
const PROJECT  = "vagabond-tag-along";
const FS_BASE  = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

// ── Firestore value deserialiser ──────────────────────────────────────────────

function fsVal(v) {
  if ("stringValue"    in v) return v.stringValue;
  if ("integerValue"   in v) return Number(v.integerValue);
  if ("doubleValue"    in v) return v.doubleValue;
  if ("booleanValue"   in v) return v.booleanValue;
  if ("nullValue"      in v) return null;
  if ("timestampValue" in v) return new Date(v.timestampValue);
  if ("arrayValue"     in v) return (v.arrayValue.values ?? []).map(fsVal);
  if ("mapValue"       in v) return fsFields(v.mapValue.fields ?? {});
  return undefined;
}

function fsFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fsVal(v)]));
}

// ── Public API ────────────────────────────────────────────────────────────────

export class VgbndFirebase {
  static #SETTING = "firebase-session";

  /** Anonymous Firebase sign-up — returns a transient { idToken, uid } without
   *  storing a session. Used by URL-tab imports so we can read the full
   *  Firestore document of public characters (which includes the portrait
   *  and spells, both of which the public ?format=foundry endpoint strips). */
  static async signInAnonymously() {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ returnSecureToken: true }),
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
    return { idToken: data.idToken, uid: data.localId };
  }

  /** Email + password sign-in; stores session in client game settings. */
  static async signIn(email, password) {
    const res  = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email, password, returnSecureToken: true }),
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
    const expiresAt = Date.now() + Number(data.expiresIn) * 1000 - 60_000;
    const displayName = data.displayName ?? data.email ?? "";
    this.#save({ idToken: data.idToken, refreshToken: data.refreshToken, uid: data.localId, expiresAt, displayName });
    return { idToken: data.idToken, uid: data.localId, displayName };
  }

  static signOut() {
    game.settings.set("vgbnd-importer", this.#SETTING, "");
  }

  static isSignedIn() { return Boolean(this.#load()); }

  /** Returns a valid { idToken, uid }, auto-refreshing if expired. Null if not signed in. */
  static async getToken() {
    const s = this.#load();
    if (!s) return null;
    if (Date.now() < s.expiresAt) return s;
    try {
      const res  = await fetch(
        `https://securetoken.googleapis.com/v1/token?key=${API_KEY}`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body:    `grant_type=refresh_token&refresh_token=${encodeURIComponent(s.refreshToken)}`,
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const expiresAt = Date.now() + Number(data.expires_in) * 1000 - 60_000;
      const updated   = { ...s, idToken: data.id_token, refreshToken: data.refresh_token, expiresAt };
      this.#save(updated);
      return updated;
    } catch {
      this.signOut();
      return null;
    }
  }

  // ── Firestore queries ───────────────────────────────────────────────────────

  static listCharacters(idToken, uid) {
    return this.#query(idToken, {
      from:  [{ collectionId: "characters" }],
      where: { fieldFilter: { field: { fieldPath: "userId" }, op: "EQUAL", value: { stringValue: uid } } },
    });
  }

  static listGroups(idToken, uid) {
    return this.#query(idToken, {
      from:  [{ collectionId: "groups" }],
      where: { fieldFilter: { field: { fieldPath: "members" }, op: "ARRAY_CONTAINS", value: { stringValue: uid } } },
    });
  }

  /** Fetch a single character document by Firestore document ID (= the UUID). */
  static async getCharacter(idToken, charId) {
    const res = await fetch(`${FS_BASE}/characters/${charId}`, {
      headers: { "Authorization": `Bearer ${idToken}` },
    });
    if (!res.ok) throw new Error(`Firestore error: HTTP ${res.status}`);
    const data = await res.json();
    return { id: charId, _updateTime: data.updateTime, ...fsFields(data.fields ?? {}) };
  }

  /** Try to GET a single user profile document. Returns display name string or null. */
  static async getUserDisplayName(idToken, uid) {
    try {
      const res = await fetch(`${FS_BASE}/users/${uid}`, {
        headers: { "Authorization": `Bearer ${idToken}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      const f = fsFields(data.fields ?? {});
      return f.displayName ?? f.name ?? f.username ?? f.email ?? null;
    } catch {
      return null;
    }
  }

  /** Fetch individual character documents by ID — uses GET not query, so group rules may apply. */
  static async patchCharacter(idToken, charId, fields) {
    const mask = Object.keys(fields).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
    const res = await fetch(`${FS_BASE}/characters/${charId}?${mask}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
      body:    JSON.stringify({ fields }),
    });
    if (!res.ok) throw new Error(`Firestore PATCH error: HTTP ${res.status}`);
    return res.json();
  }

  static async getGroupCharacters(idToken, characterIds) {
    if (!characterIds?.length) return [];
    const results = await Promise.allSettled(
      characterIds.map(id => this.getCharacter(idToken, id))
    );
    return results.flatMap((r, i) => {
      if (r.status === "fulfilled") return [r.value];
      console.warn("vgbnd-importer | getGroupCharacters failed for", characterIds[i], r.reason?.message);
      return [];
    });
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  static async #query(idToken, structuredQuery) {
    const res = await fetch(`${FS_BASE}:runQuery`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
      body:    JSON.stringify({ structuredQuery }),
    });
    if (!res.ok) throw new Error(`Firestore error: HTTP ${res.status}`);
    const rows = await res.json();
    return rows
      .filter(r => r.document)
      .map(r => ({
        id: r.document.name.split("/").pop(),
        _updateTime: r.document.updateTime,
        ...fsFields(r.document.fields ?? {}),
      }));
  }

  static #save(session) {
    game.settings.set("vgbnd-importer", this.#SETTING, JSON.stringify(session));
  }

  static #load() {
    try { return JSON.parse(game.settings.get("vgbnd-importer", this.#SETTING) || "null"); }
    catch { return null; }
  }
}
