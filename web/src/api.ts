/**
 * Nous Cloud API client for the web viewer.
 * Adapted from src/cloud/api.ts — read-only operations only.
 */

const API_BASE = "https://api.nous.page";

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; email: string };
}

export interface EncryptionParams {
  salt: string | null;
  iterations: number;
  hash: string;
}

export interface CloudNotebook {
  id: string;
  localNotebookId: string | null;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastSyncAt: string | null;
  encryptedNotebookKey: string | null;
}

class CloudAPIError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "CloudAPIError";
  }
}

async function parseError(res: Response): Promise<CloudAPIError> {
  let message: string;
  try {
    const body = await res.json();
    message = (body as { message?: string }).message ?? res.statusText;
  } catch {
    message = res.statusText;
  }
  return new CloudAPIError(res.status, message);
}

export class CloudAPI {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private onTokensChanged:
    | ((tokens: { accessToken: string; refreshToken: string } | null) => void)
    | null = null;

  constructor(options?: {
    accessToken?: string;
    refreshToken?: string;
    onTokensChanged?: (
      tokens: { accessToken: string; refreshToken: string } | null,
    ) => void;
  }) {
    this.accessToken = options?.accessToken ?? null;
    this.refreshToken = options?.refreshToken ?? null;
    this.onTokensChanged = options?.onTokensChanged ?? null;
  }

  updateTokens(accessToken: string | null, refreshToken: string | null) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw await parseError(res);
    const data: AuthResponse = await res.json();
    this.setTokens(data.accessToken, data.refreshToken);
    return data;
  }

  async logout(): Promise<void> {
    if (this.refreshToken) {
      await fetch(`${API_BASE}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      }).catch(() => {});
    }
    this.clearTokens();
  }

  async getEncryptionParams(): Promise<EncryptionParams> {
    const res = await this.authedFetch(`${API_BASE}/me/encryption`);
    if (!res.ok) throw await parseError(res);
    return res.json();
  }

  async listNotebooks(): Promise<CloudNotebook[]> {
    const res = await this.authedFetch(`${API_BASE}/notebooks`);
    if (!res.ok) throw await parseError(res);
    return res.json();
  }

  async listPageIds(notebookId: string): Promise<string[]> {
    const res = await this.authedFetch(
      `${API_BASE}/notebooks/${notebookId}/pages`,
    );
    if (!res.ok) throw await parseError(res);
    const data: { pageIds: string[] } = await res.json();
    return data.pageIds;
  }

  async downloadPage(
    notebookId: string,
    pageId: string,
  ): Promise<ArrayBuffer | null> {
    const res = await this.authedFetch(
      `${API_BASE}/notebooks/${notebookId}/pages/${pageId}`,
    );
    if (res.status === 404) return null;
    if (!res.ok) throw await parseError(res);
    return res.arrayBuffer();
  }

  async downloadMeta(notebookId: string): Promise<ArrayBuffer | null> {
    const res = await this.authedFetch(
      `${API_BASE}/notebooks/${notebookId}/meta`,
    );
    if (res.status === 404) return null;
    if (!res.ok) throw await parseError(res);
    return res.arrayBuffer();
  }

  private setTokens(accessToken: string, refreshToken: string) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.onTokensChanged?.({ accessToken, refreshToken });
  }

  private clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    this.onTokensChanged?.(null);
  }

  private async authedFetch(
    url: string,
    init?: RequestInit,
  ): Promise<Response> {
    if (!this.accessToken) {
      throw new CloudAPIError(401, "Not authenticated");
    }

    const doFetch = (token: string) =>
      fetch(url, {
        ...init,
        headers: {
          ...((init?.headers as Record<string, string>) ?? {}),
          Authorization: `Bearer ${token}`,
        },
      });

    let res = await doFetch(this.accessToken);

    if (res.status === 401 && this.refreshToken) {
      const refreshed = await this.tryRefresh();
      if (refreshed) {
        res = await doFetch(this.accessToken!);
      }
    }

    return res;
  }

  private async tryRefresh(): Promise<boolean> {
    if (!this.refreshToken) return false;

    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });

      if (!res.ok) {
        this.clearTokens();
        return false;
      }

      const data: AuthResponse = await res.json();
      this.setTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      this.clearTokens();
      return false;
    }
  }
}
