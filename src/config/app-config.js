const defaults = {
  googleDrive: {
    folderId: null,
    apiKey: null,
  },
  /**
   * Planet interior mailing list. Set `enabled: true` and a valid `api.baseUrl` to show signup again.
   * While disabled, {@link songPromotion} is shown inside the planet instead.
   * @type {{ enabled?: boolean, formAction: string | null, emailFieldName: string, mailtoFallback: string | null }}
   */
  mailingList: {
    enabled: false,
    formAction: null,
    emailFieldName: "EMAIL",
    mailtoFallback: null,
  },
  /**
   * Shown inside the planet when mailing list is disabled. Replace `hypedditUrl` with your track link.
   * @type {{ hypedditUrl: string, title?: string, buttonLabel?: string }}
   */
  songPromotion: {
    hypedditUrl: "https://hypeddit.com/nxgrxvity/planetcool",
    title: "stream planet cool",
    buttonLabel: "teleport",
  },
  /**
   * Backend API — required for the mailing panel and optional auth UI.
   * Override in app-config.local.json for local dev (e.g. http://127.0.0.1:8787).
   * @type {{ baseUrl: string | null }}
   */
  api: {
    baseUrl: "https://api.nxgrxvity.com",
  },
  /**
   * Magic-link sign-in pill inside the planet HUD. Off by default; set `enabled: true` in app-config.local.json to show.
   * @type {{ enabled: boolean }}
   */
  authUi: {
    enabled: false,
  },
};

async function tryLoadLocalJson() {
  try {
    const res = await fetch(new URL("app-config.local.json", import.meta.url));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function buildConfig() {
  const raw = await tryLoadLocalJson();
  const gd =
    raw?.googleDrive && typeof raw.googleDrive === "object"
      ? { ...defaults.googleDrive, ...raw.googleDrive }
      : { ...defaults.googleDrive };
  const mailingList =
    raw?.mailingList && typeof raw.mailingList === "object"
      ? { ...defaults.mailingList, ...raw.mailingList }
      : { ...defaults.mailingList };
  const songPromotion =
    raw?.songPromotion && typeof raw.songPromotion === "object"
      ? { ...defaults.songPromotion, ...raw.songPromotion }
      : { ...defaults.songPromotion };
  const api =
    raw?.api && typeof raw.api === "object"
      ? { ...defaults.api, ...raw.api }
      : { ...defaults.api };
  const authUi =
    raw?.authUi && typeof raw.authUi === "object"
      ? { ...defaults.authUi, ...raw.authUi }
      : { ...defaults.authUi };
  return {
    googleDrive: gd,
    mailingList,
    songPromotion,
    api,
    authUi,
  };
}

export default await buildConfig();
